-- Phase 3: player request flows + unified organizer assignment.
-- (docs/phases/substitutions-implementation-plan.md §2.1, §2.6.)
--
-- Two SECURITY DEFINER wrapper RPCs (EXECUTE = service_role only; the API routes are the trust
-- boundary and authorize the actor before calling):
--
--   create_player_sub_request(...)     -- the requester journey. Derives every field server-side
--     and creates the request. open_pool  -> insert an 'open' request (nothing placed).
--                                self_assigned -> insert the request AND immediately fill it via the
--     Phase-2 atomic accept_sub_request(...) in the SAME transaction, so the requester's chosen sub
--     passes exactly the same HARD gates as an open-pool accept (the requester cannot override them).
--
--   assign_organizer_sub_request(...)  -- organizer assignment through the unified model. Creates
--     (or reuses the covered player's open request as) an 'organizer_assigned' 'filled' record and
--     places the sub via the SAME Phase-2 placement primitives, in one transaction. Organizer gate
--     set is intentionally lighter than a player accept (organizers keep their existing discretion:
--     schedule-conflict + the post-generation guard are NOT applied here, matching today's behavior),
--     but the non-overridable integrity gates ARE enforced: account eligibility, required gender,
--     duplicate placement (already-covered), scope. placed_with_override only records that a permitted
--     SOFT override (rating/logistical — never a hard gate) was used; rating is a warning, not a gate.
--
-- Nothing here weakens the Phase-2 correctness core; both wrappers reuse it. Additive + idempotent
-- (create-or-replace). Safe on a fresh chain and on the current prod Phase-2 state.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. create_player_sub_request — the requester creates their own request.
--    p_requester_id is ALWAYS the covered player (the route forces it to getUser().id).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_player_sub_request(
  p_requester_id uuid,
  p_league_id uuid,
  p_scope_kind text,               -- 'session' (RR) | 'period' (box/ladder)
  p_scope_id uuid,
  p_fulfillment_mode text,         -- 'open_pool' | 'self_assigned'
  p_chosen_user_id uuid default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league        record;
  v_session       record;
  v_period        record;
  v_reg           record;
  v_today         date := (now() at time zone 'America/Los_Angeles')::date;
  v_gender        text;
  v_expires       timestamptz;
  v_covered_reg   uuid;
  v_new_id        uuid;
  v_accept        jsonb;
begin
  if p_requester_id is null or p_league_id is null or p_scope_id is null then
    raise exception 'bad_request';
  end if;
  if p_fulfillment_mode not in ('open_pool', 'self_assigned') then
    raise exception 'bad_request';
  end if;
  if p_fulfillment_mode = 'self_assigned' then
    if p_chosen_user_id is null then raise exception 'bad_request'; end if;
    if p_chosen_user_id = p_requester_id then raise exception 'chosen_is_self'; end if;
  end if;

  select id, format, format_kind into v_league from public.leagues where id = p_league_id;
  if not found then raise exception 'league_not_found'; end if;

  v_gender := case
    when v_league.format like 'mens_%'   then 'male'
    when v_league.format like 'womens_%' then 'female'
    else null end;

  -- Requester must be a registered member of this league.
  select id, partner_registration_id into v_reg
    from public.league_registrations
   where league_id = p_league_id and user_id = p_requester_id and status = 'registered'
   limit 1;

  if p_scope_kind = 'session' then
    if v_league.format_kind <> 'session_rr' then raise exception 'unsupported_format'; end if;
    -- RR membership: a registration is required.
    if v_reg.id is null then raise exception 'not_registered'; end if;

    select id, league_id, session_date, session_time, status into v_session
      from public.league_sessions where id = p_scope_id;
    if not found then raise exception 'covered_player_not_found'; end if;
    if v_session.league_id <> p_league_id then raise exception 'scope_mismatch'; end if;
    if v_session.status in ('completed', 'cancelled') or v_session.session_date < v_today then
      raise exception 'occasion_started';
    end if;
    if exists (select 1 from public.league_rounds where session_id = v_session.id) then
      raise exception 'generation_started';
    end if;
    v_expires := (v_session.session_date + coalesce(v_session.session_time, time '23:59'))::timestamp
                 at time zone 'America/Los_Angeles';
    v_covered_reg := null;

  elsif p_scope_kind = 'period' then
    if v_league.format_kind not in ('box', 'ladder') then raise exception 'unsupported_format'; end if;
    if v_reg.id is null then raise exception 'not_registered'; end if;

    select id, league_id, status into v_period from public.league_periods where id = p_scope_id;
    if not found then raise exception 'covered_player_not_found'; end if;
    if v_period.league_id <> p_league_id then raise exception 'scope_mismatch'; end if;
    if v_period.status <> 'active' then raise exception 'occasion_started'; end if;
    if exists (select 1 from public.league_fixtures where period_id = v_period.id) then
      raise exception 'generation_started';
    end if;
    v_expires := null;                 -- periods carry no clock
    v_covered_reg := v_reg.id;         -- the requester's own slot; accept re-derives the entrant

  else
    raise exception 'scope_mismatch';
  end if;

  -- Already covered? (a filled request exists for this occasion + requester)
  if exists (
    select 1 from public.league_sub_requests
     where requesting_player_id = p_requester_id and status = 'filled'
       and ((p_scope_kind = 'session' and league_session_id = p_scope_id)
         or (p_scope_kind = 'period'  and league_period_id  = p_scope_id))
  ) then
    raise exception 'already_filled';
  end if;

  -- Insert the open request (dedupe on the partial-unique index → 'already_open').
  begin
    insert into public.league_sub_requests
      (league_id, league_session_id, league_period_id, requesting_player_id, covered_registration_id,
       fulfillment_mode, format, gender_required, expires_at, notes, status)
    values
      (p_league_id,
       case when p_scope_kind = 'session' then p_scope_id end,
       case when p_scope_kind = 'period'  then p_scope_id end,
       p_requester_id, v_covered_reg, p_fulfillment_mode, v_league.format, v_gender, v_expires,
       nullif(btrim(coalesce(p_note, '')), ''), 'open')
    returning id into v_new_id;
  exception when unique_violation then
    raise exception 'already_open';
  end;

  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_requester_id, 'league_sub_request', v_new_id, 'sub_request_created',
    null,
    jsonb_build_object('status', 'open', 'league_id', p_league_id, 'fulfillment_mode', p_fulfillment_mode,
      'scope', p_scope_kind, 'scope_id', p_scope_id, 'requesting_player_id', p_requester_id));

  if p_fulfillment_mode = 'open_pool' then
    return jsonb_build_object('ok', true, 'request_id', v_new_id, 'status', 'open',
      'fulfillment_mode', 'open_pool', 'scope', p_scope_kind);
  end if;

  -- self_assigned: fill immediately via the Phase-2 atomic core (chosen sub passes the SAME hard
  -- gates; the requester cannot override). Any failure rolls back the whole transaction.
  v_accept := public.accept_sub_request(v_new_id, p_chosen_user_id);

  return jsonb_build_object('ok', true, 'request_id', v_new_id, 'status', 'filled',
    'fulfillment_mode', 'self_assigned', 'scope', p_scope_kind,
    'filled_by_user_id', p_chosen_user_id, 'accept', v_accept);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. assign_organizer_sub_request — organizer assigns a Joinzer user through the unified model.
--    Authority (owner / co-admin / self-run operator) is verified in the route before calling.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_organizer_sub_request(
  p_actor_id uuid,
  p_league_id uuid,
  p_scope_kind text,                       -- 'session' | 'period'
  p_scope_id uuid,
  p_covered_user_id uuid,
  p_covered_session_player_id uuid default null,  -- RR: the absent roster league_session_players.id
  p_covered_registration_id uuid default null,    -- box/ladder: the covered ENTRANT registration
  p_slot_registration_id uuid default null,       -- box/ladder: the specific slot (defaults to entrant)
  p_sub_user_id uuid default null,
  p_placed_with_override boolean default false,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league   record;
  v_sub      record;
  v_gender   text;
  v_req_id   uuid;
  v_place    jsonb;
  v_covered_sp uuid;
  v_placement jsonb;
begin
  if p_sub_user_id is null or p_covered_user_id is null then raise exception 'bad_request'; end if;
  if p_sub_user_id = p_covered_user_id then raise exception 'own_request'; end if;

  select id, format, format_kind into v_league from public.leagues where id = p_league_id;
  if not found then raise exception 'league_not_found'; end if;

  -- Non-overridable integrity gates (organizer CANNOT override these).
  select id, gender, is_stub into v_sub from public.profiles where id = p_sub_user_id;
  if not found then raise exception 'accepter_not_found'; end if;
  if v_sub.is_stub then raise exception 'accepter_ineligible'; end if;

  v_gender := case
    when v_league.format like 'mens_%'   then 'male'
    when v_league.format like 'womens_%' then 'female'
    else null end;
  if v_gender is not null and coalesce(v_sub.gender, '') <> v_gender then raise exception 'gender_mismatch'; end if;

  -- Reuse the covered player's existing OPEN request if there is one (so an organizer assign
  -- resolves a pending "find me a sub" instead of orphaning it); else create a fresh record.
  select id into v_req_id
    from public.league_sub_requests
   where requesting_player_id = p_covered_user_id and status = 'open'
     and ((p_scope_kind = 'session' and league_session_id = p_scope_id)
       or (p_scope_kind = 'period'  and league_period_id  = p_scope_id))
   limit 1
     for update;

  if p_scope_kind = 'session' then
    if v_league.format_kind <> 'session_rr' then raise exception 'unsupported_format'; end if;
    if p_covered_session_player_id is null then raise exception 'covered_player_not_found'; end if;
    -- Duplicate placement (already-covered) is non-overridable.
    if exists (select 1 from public.league_session_players
                where session_id = p_scope_id and sub_for_session_player_id = p_covered_session_player_id) then
      raise exception 'already_covered';
    end if;

    if v_req_id is null then
      insert into public.league_sub_requests
        (league_id, league_session_id, requesting_player_id, fulfillment_mode, format, gender_required,
         status, filled_by_user_id, filled_at, placed_with_override, notes)
      values (p_league_id, p_scope_id, p_covered_user_id, 'organizer_assigned', v_league.format, v_gender,
         'filled', p_sub_user_id, now(), p_placed_with_override, nullif(btrim(coalesce(p_note,'')), ''))
      returning id into v_req_id;
    else
      update public.league_sub_requests
         set fulfillment_mode = 'organizer_assigned', status = 'filled',
             filled_by_user_id = p_sub_user_id, filled_at = now(),
             placed_with_override = p_placed_with_override, updated_at = now()
       where id = v_req_id;
    end if;

    v_place := public.place_league_sub_rr(p_scope_id, p_covered_session_player_id, p_sub_user_id, true);
    v_placement := jsonb_build_object('kind', 'rr', 'covered_session_player_id', p_covered_session_player_id,
      'sub_session_player_id', v_place->>'id');

  elsif p_scope_kind = 'period' then
    if v_league.format_kind not in ('box', 'ladder') then raise exception 'unsupported_format'; end if;
    if p_covered_registration_id is null then raise exception 'covered_player_not_found'; end if;
    if exists (select 1 from public.league_attendance
                where period_id = p_scope_id
                  and subbing_for_registration_id = coalesce(p_slot_registration_id, p_covered_registration_id)) then
      raise exception 'already_covered';
    end if;

    if v_req_id is null then
      insert into public.league_sub_requests
        (league_id, league_period_id, requesting_player_id, covered_registration_id, fulfillment_mode,
         format, gender_required, status, filled_by_user_id, filled_at, placed_with_override, notes)
      values (p_league_id, p_scope_id, p_covered_user_id, p_covered_registration_id, 'organizer_assigned',
         v_league.format, v_gender, 'filled', p_sub_user_id, now(), p_placed_with_override,
         nullif(btrim(coalesce(p_note,'')), ''))
      returning id into v_req_id;
    else
      update public.league_sub_requests
         set fulfillment_mode = 'organizer_assigned', status = 'filled', covered_registration_id = p_covered_registration_id,
             filled_by_user_id = p_sub_user_id, filled_at = now(),
             placed_with_override = p_placed_with_override, updated_at = now()
       where id = v_req_id;
    end if;

    v_place := public.place_league_sub_attendance(p_league_id, p_scope_id, p_covered_registration_id,
      p_covered_user_id, p_sub_user_id, coalesce(p_slot_registration_id, p_covered_registration_id));
    v_placement := jsonb_build_object('kind', 'attendance', 'entrant_registration_id', p_covered_registration_id,
      'slot_registration_id', coalesce(p_slot_registration_id, p_covered_registration_id),
      'sub_attendance_id', v_place->>'sub_attendance_id');

  else
    raise exception 'scope_mismatch';
  end if;

  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_actor_id, 'league_sub_request', v_req_id, 'sub_request_assigned',
    null,
    jsonb_build_object('status', 'filled', 'league_id', p_league_id, 'fulfillment_mode', 'organizer_assigned',
      'scope', p_scope_kind, 'requesting_player_id', p_covered_user_id, 'filled_by_user_id', p_sub_user_id,
      'placed_with_override', p_placed_with_override, 'placement', v_placement));

  return jsonb_build_object('ok', true, 'request_id', v_req_id, 'status', 'filled',
    'fulfillment_mode', 'organizer_assigned', 'scope', p_scope_kind,
    'filled_by_user_id', p_sub_user_id, 'placed_with_override', p_placed_with_override, 'placement', v_placement);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lock down execution — service_role only (the routes are the auth boundary).
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.create_player_sub_request(uuid, uuid, text, uuid, text, uuid, text) from public;
revoke all on function public.assign_organizer_sub_request(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text) from public;
grant execute on function public.create_player_sub_request(uuid, uuid, text, uuid, text, uuid, text) to service_role;
grant execute on function public.assign_organizer_sub_request(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text) to service_role;

comment on function public.create_player_sub_request(uuid, uuid, text, uuid, text, uuid, text) is
  'Phase 3 requester create. open_pool inserts an open request; self_assigned inserts + immediately '
  'fills via accept_sub_request in one txn (chosen sub passes the same hard gates; requester cannot '
  'override). Derives league/format/gender/covered/expiry server-side. service_role only.';
comment on function public.assign_organizer_sub_request(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text) is
  'Phase 3 organizer assignment (Joinzer user) through the unified model: creates/reuses an '
  'organizer_assigned filled request record AND places via the shared primitive in one txn. Enforces '
  'the non-overridable integrity gates (account eligibility, required gender, duplicate placement, '
  'scope); placed_with_override records a permitted soft (rating/logistical) override. service_role only.';
