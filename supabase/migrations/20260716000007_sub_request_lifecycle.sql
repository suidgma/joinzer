-- Phase 5: substitute-request lifecycle — withdrawal, reclaim, organizer correction, expiration.
-- (docs/phases/substitutions-implementation-plan.md §2.4, §2.5, §2.6.)
--
-- Reversal is the inverse of the Phase-2 placement primitives, and every transition (reverse +
-- status change + audit) happens in ONE transaction, so status and participation can never diverge.
-- No new statuses: withdrawal/reopen/reclaim/replace/expire are transitions + audit events over the
-- existing open|filled|cancelled|expired set. All functions are SECURITY DEFINER, locked search_path,
-- EXECUTE = service_role only (the routes authenticate and pass the verified actor). Additive.

-- ── 0. Notification generation (so a reopened request can re-notify without deleting history) ─────
alter table public.league_sub_requests
  add column if not exists notification_generation integer not null default 0;

-- Dedupe key gains the generation: (request, user, generation) — a new wave after reopen is allowed,
-- prior delivery history is preserved.
alter table public.sub_request_notifications
  add column if not exists generation integer not null default 0;
alter table public.sub_request_notifications drop constraint if exists sub_request_notifications_request_id_user_id_key;
create unique index if not exists sub_request_notifications_req_user_gen_uq
  on public.sub_request_notifications (request_id, user_id, generation);

-- Expiry scan support.
create index if not exists league_sub_requests_expiry_idx
  on public.league_sub_requests (expires_at) where status = 'open';

-- ── 1. Reversal primitives (inverse of place_league_sub_rr / place_league_sub_attendance) ─────────
-- RR: delete the substitute's session-player row, restore the covered roster row from 'has_sub'.
create or replace function public.reverse_league_sub_rr(
  p_session_id uuid, p_covered_session_player_id uuid, p_sub_user_id uuid, p_covered_restore_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Lock the covered row.
  perform 1 from public.league_session_players where id = p_covered_session_player_id for update;
  -- The substitute row exists only because of the placement (the accept path forbids a sub who is
  -- already in the session), so removing it is clean; audit_log is the history.
  delete from public.league_session_players
   where session_id = p_session_id and user_id = p_sub_user_id
     and player_type = 'sub' and sub_for_session_player_id = p_covered_session_player_id;
  update public.league_session_players
     set actual_status = p_covered_restore_status
   where id = p_covered_session_player_id;
end; $$;

-- Box/ladder: remove the substitute's attendance row for the slot, restore the covered ENTRANT.
create or replace function public.reverse_league_sub_attendance(
  p_period_id uuid, p_covered_registration_id uuid, p_slot_registration_id uuid, p_covered_restore_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The row subbing for this slot is the substitute (registered or bare-user) — remove it.
  delete from public.league_attendance
   where period_id = p_period_id and subbing_for_registration_id = p_slot_registration_id;
  update public.league_attendance
     set status = p_covered_restore_status, updated_at = now()
   where period_id = p_period_id and registration_id = p_covered_registration_id and status = 'has_sub';
end; $$;

-- ── Shared internal helper: reverse whatever placement a request has, restoring covered to a state.
create or replace function public._reverse_sub_placement(r public.league_sub_requests, p_covered_restore_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_covered_sp uuid; v_slot uuid; v_partner uuid; v_entrant uuid;
begin
  if r.league_session_id is not null then
    select id into v_covered_sp from public.league_session_players
     where session_id = r.league_session_id and user_id = r.requesting_player_id and player_type = 'roster_player'
     for update;
    if v_covered_sp is null then raise exception 'placement_not_found'; end if;
    perform public.reverse_league_sub_rr(r.league_session_id, v_covered_sp, r.filled_by_user_id, p_covered_restore_status);
  else
    select id, partner_registration_id into v_slot, v_partner from public.league_registrations
     where league_id = r.league_id and user_id = r.requesting_player_id and status = 'registered' limit 1;
    if v_slot is null then raise exception 'placement_not_found'; end if;
    v_entrant := case when v_partner is not null and v_partner < v_slot then v_partner else v_slot end;
    perform public.reverse_league_sub_attendance(r.league_period_id, v_entrant, v_slot, p_covered_restore_status);
  end if;
end; $$;

-- Shared internal guard: occasion must exist, not have started, not be generated.
create or replace function public._sub_occasion_open(r public.league_sub_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session record; v_period record; v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if r.league_session_id is not null then
    select session_date, status into v_session from public.league_sessions where id = r.league_session_id for update;
    if not found then raise exception 'occasion_not_found'; end if;
    if v_session.status in ('completed','cancelled') or v_session.session_date < v_today then raise exception 'occasion_started'; end if;
    if exists (select 1 from public.league_rounds where session_id = r.league_session_id) then raise exception 'generation_started'; end if;
  else
    select status into v_period from public.league_periods where id = r.league_period_id for update;
    if not found then raise exception 'occasion_not_found'; end if;
    if v_period.status <> 'active' then raise exception 'occasion_started'; end if;
    if exists (select 1 from public.league_fixtures where period_id = r.league_period_id) then raise exception 'generation_started'; end if;
  end if;
end; $$;

-- ── 2. withdraw_sub_request — the filled substitute withdraws before start; request reopens ───────
create or replace function public.withdraw_sub_request(p_request_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.league_sub_requests; v_old_sub uuid;
begin
  select * into r from public.league_sub_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status = 'open' then raise exception 'already_reopened'; end if;
  if r.status = 'cancelled' then raise exception 'already_cancelled'; end if;
  if r.status = 'expired' then raise exception 'already_expired'; end if;
  if r.status <> 'filled' then raise exception 'not_filled'; end if;
  if r.filled_by_user_id <> p_user_id then raise exception 'not_current_substitute'; end if;
  perform public._sub_occasion_open(r);
  v_old_sub := r.filled_by_user_id;
  perform public._reverse_sub_placement(r, 'cannot_attend');
  update public.league_sub_requests
     set status = 'open', filled_by_user_id = null, filled_at = null,
         fulfillment_mode = 'open_pool', notification_generation = notification_generation + 1, updated_at = now()
   where id = r.id;
  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_user_id, 'league_sub_request', r.id, 'sub_request_withdrawn',
    jsonb_build_object('status','filled','filled_by_user_id', v_old_sub),
    jsonb_build_object('status','open','league_id', r.league_id, 'requesting_player_id', r.requesting_player_id,
      'withdrawn_by', v_old_sub, 'notification_generation', r.notification_generation + 1));
  return jsonb_build_object('ok', true, 'request_id', r.id, 'status', 'open',
    'notification_generation', r.notification_generation + 1, 'withdrawn_sub', v_old_sub,
    'league_id', r.league_id, 'scope', case when r.league_session_id is not null then 'session' else 'period' end,
    'session_id', r.league_session_id, 'period_id', r.league_period_id);
end; $$;

-- ── 3. reclaim_sub_request — the requester takes their spot back; request cancelled ──────────────
create or replace function public.reclaim_sub_request(p_request_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.league_sub_requests; v_old_sub uuid;
begin
  select * into r from public.league_sub_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status = 'cancelled' then
    if r.cancelled_by_user_id = p_user_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'request_id', r.id, 'status', 'cancelled');
    end if;
    raise exception 'already_cancelled';
  end if;
  if r.status = 'expired' then raise exception 'already_expired'; end if;
  if r.status <> 'filled' then raise exception 'not_filled'; end if;
  if r.requesting_player_id <> p_user_id then raise exception 'not_requester'; end if;
  perform public._sub_occasion_open(r);
  v_old_sub := r.filled_by_user_id;
  perform public._reverse_sub_placement(r, 'coming');
  -- RR: also restore the requester's self-report so "who's coming" reflects it.
  if r.league_session_id is not null then
    insert into public.league_session_attendance (league_session_id, user_id, attendance_status, updated_at, updated_by_user_id)
    values (r.league_session_id, p_user_id, 'planning_to_attend', now(), p_user_id)
    on conflict (league_session_id, user_id) do update set attendance_status = 'planning_to_attend', updated_at = now(), updated_by_user_id = p_user_id;
  end if;
  update public.league_sub_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by_user_id = p_user_id,
         filled_by_user_id = null, filled_at = null, updated_at = now()
   where id = r.id;
  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_user_id, 'league_sub_request', r.id, 'sub_request_reclaimed',
    jsonb_build_object('status','filled','filled_by_user_id', v_old_sub),
    jsonb_build_object('status','cancelled','league_id', r.league_id, 'reclaimed_by', p_user_id, 'removed_sub', v_old_sub));
  return jsonb_build_object('ok', true, 'request_id', r.id, 'status', 'cancelled', 'removed_sub', v_old_sub,
    'league_id', r.league_id, 'scope', case when r.league_session_id is not null then 'session' else 'period' end,
    'session_id', r.league_session_id, 'period_id', r.league_period_id);
end; $$;

-- ── 4. organizer_correct_sub_request — reopen | cancel | replace (before start) ──────────────────
create or replace function public.organizer_correct_sub_request(
  p_actor_id uuid, p_request_id uuid, p_mode text, p_new_sub_user_id uuid default null, p_placed_with_override boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.league_sub_requests; v_old_sub uuid; v_new record; v_gender text; v_league record;
  v_covered_sp uuid; v_slot uuid; v_partner uuid; v_entrant uuid; v_place jsonb;
begin
  if p_mode not in ('reopen','cancel','replace') then raise exception 'bad_request'; end if;
  select * into r from public.league_sub_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'filled' then raise exception 'not_filled'; end if;
  perform public._sub_occasion_open(r);   -- pre-start + not generated (post-start correction is unsafe here)
  v_old_sub := r.filled_by_user_id;

  if p_mode = 'reopen' then
    perform public._reverse_sub_placement(r, 'cannot_attend');
    update public.league_sub_requests set status='open', filled_by_user_id=null, filled_at=null,
      fulfillment_mode='open_pool', notification_generation=notification_generation+1, updated_at=now() where id=r.id;
    insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
    values (p_actor_id, 'league_sub_request', r.id, 'sub_request_reopened',
      jsonb_build_object('status','filled','filled_by_user_id', v_old_sub),
      jsonb_build_object('status','open','removed_sub', v_old_sub, 'notification_generation', r.notification_generation + 1));
    return jsonb_build_object('ok', true, 'request_id', r.id, 'status','open', 'removed_sub', v_old_sub,
      'notification_generation', r.notification_generation + 1, 'league_id', r.league_id,
      'scope', case when r.league_session_id is not null then 'session' else 'period' end,
      'session_id', r.league_session_id, 'period_id', r.league_period_id);

  elsif p_mode = 'cancel' then
    perform public._reverse_sub_placement(r, 'cannot_attend');
    update public.league_sub_requests set status='cancelled', cancelled_at=now(), cancelled_by_user_id=p_actor_id,
      filled_by_user_id=null, filled_at=null, updated_at=now() where id=r.id;
    insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
    values (p_actor_id, 'league_sub_request', r.id, 'sub_request_org_cancelled',
      jsonb_build_object('status','filled','filled_by_user_id', v_old_sub),
      jsonb_build_object('status','cancelled','removed_sub', v_old_sub));
    return jsonb_build_object('ok', true, 'request_id', r.id, 'status','cancelled', 'removed_sub', v_old_sub,
      'league_id', r.league_id, 'scope', case when r.league_session_id is not null then 'session' else 'period' end,
      'session_id', r.league_session_id, 'period_id', r.league_period_id);

  else  -- replace
    if p_new_sub_user_id is null then raise exception 'bad_request'; end if;
    if p_new_sub_user_id = v_old_sub then
      return jsonb_build_object('ok', true, 'idempotent', true, 'request_id', r.id, 'status','filled', 'filled_by_user_id', v_old_sub);
    end if;
    if p_new_sub_user_id = r.requesting_player_id then raise exception 'own_request'; end if;
    select id, gender, is_stub into v_new from public.profiles where id = p_new_sub_user_id;
    if not found then raise exception 'accepter_not_found'; end if;
    if v_new.is_stub then raise exception 'accepter_ineligible'; end if;
    select format into v_league from public.leagues where id = r.league_id;
    v_gender := case when v_league.format like 'mens_%' then 'male' when v_league.format like 'womens_%' then 'female' else null end;
    if v_gender is not null and coalesce(v_new.gender,'') <> v_gender then raise exception 'gender_mismatch'; end if;

    -- Delete only the OLD substitute row (keep covered 'has_sub'), then place the new substitute.
    if r.league_session_id is not null then
      select id into v_covered_sp from public.league_session_players
       where session_id=r.league_session_id and user_id=r.requesting_player_id and player_type='roster_player' for update;
      if v_covered_sp is null then raise exception 'placement_not_found'; end if;
      delete from public.league_session_players where session_id=r.league_session_id and user_id=v_old_sub
        and player_type='sub' and sub_for_session_player_id=v_covered_sp;
      if exists (select 1 from public.league_session_players where session_id=r.league_session_id and user_id=p_new_sub_user_id) then raise exception 'duplicate_participation'; end if;
      v_place := public.place_league_sub_rr(r.league_session_id, v_covered_sp, p_new_sub_user_id, true);
    else
      select id, partner_registration_id into v_slot, v_partner from public.league_registrations
       where league_id=r.league_id and user_id=r.requesting_player_id and status='registered' limit 1;
      if v_slot is null then raise exception 'placement_not_found'; end if;
      v_entrant := case when v_partner is not null and v_partner < v_slot then v_partner else v_slot end;
      delete from public.league_attendance where period_id=r.league_period_id and subbing_for_registration_id=v_slot;
      v_place := public.place_league_sub_attendance(r.league_id, r.league_period_id, v_entrant, r.requesting_player_id, p_new_sub_user_id, v_slot);
    end if;

    update public.league_sub_requests set filled_by_user_id=p_new_sub_user_id, filled_at=now(),
      placed_with_override=p_placed_with_override, updated_at=now() where id=r.id;
    insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
    values (p_actor_id, 'league_sub_request', r.id, 'sub_request_replaced',
      jsonb_build_object('status','filled','filled_by_user_id', v_old_sub),
      jsonb_build_object('status','filled','old_sub', v_old_sub, 'new_sub', p_new_sub_user_id, 'placed_with_override', p_placed_with_override));
    return jsonb_build_object('ok', true, 'request_id', r.id, 'status','filled', 'old_sub', v_old_sub,
      'filled_by_user_id', p_new_sub_user_id, 'league_id', r.league_id,
      'scope', case when r.league_session_id is not null then 'session' else 'period' end,
      'session_id', r.league_session_id, 'period_id', r.league_period_id);
  end if;
end; $$;

-- ── 5. expire_sub_requests — canonical status cleanup for stale open requests (scheduler) ────────
create or replace function public.expire_sub_requests(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare rec record; v_count int := 0; v_today date := (now() at time zone 'America/Los_Angeles')::date; v_upd int;
begin
  for rec in
    select r.id, r.league_id, r.requesting_player_id, r.league_session_id, r.league_period_id, r.expires_at
      from public.league_sub_requests r
      left join public.league_sessions s on s.id = r.league_session_id
      left join public.league_periods p on p.id = r.league_period_id
     where r.status = 'open'
       and ( (r.expires_at is not null and r.expires_at <= now())
          or (r.league_session_id is not null and (s.status in ('completed','cancelled') or s.session_date < v_today))
          or (r.league_period_id is not null and p.status <> 'active') )
     order by r.created_at
     limit greatest(1, least(p_limit, 1000))
     for update of r skip locked
  loop
    -- Conditional transition: a request just filled/cancelled between the scan and now is skipped.
    update public.league_sub_requests set status = 'expired', updated_at = now()
     where id = rec.id and status = 'open';
    get diagnostics v_upd = row_count;
    if v_upd = 1 then
      v_count := v_count + 1;
      insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
      values (null, 'league_sub_request', rec.id, 'sub_request_expired',
        jsonb_build_object('status','open'),
        jsonb_build_object('status','expired','league_id', rec.league_id, 'requesting_player_id', rec.requesting_player_id, 'reason', 'stale_or_started'));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_count);
end; $$;

-- ── 6. Lock down execution — service_role only ───────────────────────────────────────────────────
revoke all on function public.reverse_league_sub_rr(uuid, uuid, uuid, text) from public;
revoke all on function public.reverse_league_sub_attendance(uuid, uuid, uuid, text) from public;
revoke all on function public._reverse_sub_placement(public.league_sub_requests, text) from public;
revoke all on function public._sub_occasion_open(public.league_sub_requests) from public;
revoke all on function public.withdraw_sub_request(uuid, uuid) from public;
revoke all on function public.reclaim_sub_request(uuid, uuid) from public;
revoke all on function public.organizer_correct_sub_request(uuid, uuid, text, uuid, boolean) from public;
revoke all on function public.expire_sub_requests(integer) from public;
grant execute on function public.reverse_league_sub_rr(uuid, uuid, uuid, text) to service_role;
grant execute on function public.reverse_league_sub_attendance(uuid, uuid, uuid, text) to service_role;
grant execute on function public.withdraw_sub_request(uuid, uuid) to service_role;
grant execute on function public.reclaim_sub_request(uuid, uuid) to service_role;
grant execute on function public.organizer_correct_sub_request(uuid, uuid, text, uuid, boolean) to service_role;
grant execute on function public.expire_sub_requests(integer) to service_role;

comment on function public.withdraw_sub_request(uuid, uuid) is 'Phase 5: the filled substitute withdraws before start — atomic reverse + filled->open (reopens to open_pool, +1 notification_generation). service_role only.';
comment on function public.reclaim_sub_request(uuid, uuid) is 'Phase 5: the requester takes their spot back before start — atomic reverse + filled->cancelled + attendance restored to coming. service_role only.';
comment on function public.organizer_correct_sub_request(uuid, uuid, text, uuid, boolean) is 'Phase 5: organizer reopen | cancel | replace (before start), one transaction via the shared reversal + placement primitives. service_role only.';
comment on function public.expire_sub_requests(integer) is 'Phase 5: bounded, idempotent canonical cleanup — stale/started open requests -> expired via a conditional (status=open) transition (FOR UPDATE SKIP LOCKED), so a just-filled request is never overwritten. service_role only.';
