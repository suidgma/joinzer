-- Phase 2: Atomic acceptance + placement for the unified league substitute domain.
-- (docs/phases/substitutions-implementation-plan.md §5.1.)
--
-- The correctness core: an eligible player accepts an OPEN league_sub_requests row and the
-- claim (status open->filled) AND the actual substitute placement happen in ONE Postgres
-- transaction. Neither can exist without the other, so status and participation can never
-- diverge. Supported scopes: round-robin (league_session_id) + box/ladder (league_period_id).
--
-- Three functions, all SECURITY DEFINER + locked search_path, EXECUTE granted to service_role
-- ONLY (never authenticated/anon): the API route is the trust boundary — it authenticates via
-- getUser() and passes the authenticated accepter id. A logged-in user cannot call these
-- directly with a forged accepter id.
--
--   place_league_sub_rr(...)          -- the ONE round-robin placement primitive (was assignRrSub)
--   place_league_sub_attendance(...)  -- the ONE box/ladder placement primitive (was assignAttendanceSub)
--   accept_sub_request(...)           -- atomic claim + validate + place + audit, in one txn
--
-- The TS helpers lib/leagues/assignRrSub.ts + assignAttendanceSub.ts are refactored to DELEGATE
-- to these primitives, so organizer manual-assign, player self-sub, and open-pool accept all
-- produce byte-identical linkage from a single source of truth. leagues.sub_credit_cap is
-- untouched — credit stays on the covered participant exactly as before.
--
-- Additive + idempotent (create-or-replace). Safe on a fresh chain and on the current prod
-- Phase-1 state; touches no existing rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Shared placement primitive — ROUND ROBIN
--    Mirrors the old assignRrSub exactly: find-or-create the sub's league_session_players row,
--    link it to the covered roster-player row, optionally flip the covered row to 'has_sub'.
--    Locks the covered row and the sub row FOR UPDATE. Returns the sub row as jsonb.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.place_league_sub_rr(
  p_session_id uuid,
  p_covered_session_player_id uuid,
  p_sub_user_id uuid,
  p_mark_covered_has_sub boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_covered_id uuid;
  v_sub_row    public.league_session_players%rowtype;
  v_prof       record;
  v_existing   uuid;
begin
  -- Covered player must belong to this session (lock it).
  select id into v_covered_id
    from public.league_session_players
   where id = p_covered_session_player_id and session_id = p_session_id
     for update;
  if v_covered_id is null then
    raise exception 'covered_not_in_session';
  end if;

  select id, name, joinzer_rating into v_prof
    from public.profiles where id = p_sub_user_id;
  if not found then
    raise exception 'sub_profile_not_found';
  end if;

  -- Find-or-create the sub's session row (by session + user).
  select id into v_existing
    from public.league_session_players
   where session_id = p_session_id and user_id = p_sub_user_id
     for update;

  if v_existing is not null then
    update public.league_session_players
       set player_type = 'sub',
           actual_status = 'present',
           sub_for_session_player_id = p_covered_session_player_id
     where id = v_existing
     returning * into v_sub_row;
  else
    insert into public.league_session_players
      (session_id, user_id, display_name, player_type, expected_status, actual_status, joinzer_rating, sub_for_session_player_id)
    values
      (p_session_id, p_sub_user_id, coalesce(v_prof.name, 'Player'), 'sub', 'expected', 'present',
       coalesce(v_prof.joinzer_rating, 1000), p_covered_session_player_id)
    returning * into v_sub_row;
  end if;

  if p_mark_covered_has_sub then
    update public.league_session_players
       set actual_status = 'has_sub'
     where id = p_covered_session_player_id;
  end if;

  return to_jsonb(v_sub_row);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Shared placement primitive — BOX / LADDER (unified league_attendance model)
--    Mirrors the old assignAttendanceSub exactly: find-or-create the sub's attendance row for
--    the period, link it to the covered slot registration, mark the covered ENTRANT 'has_sub'.
--    Credit stays on the covered registration. Returns the sub attendance id as jsonb.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.place_league_sub_attendance(
  p_league_id uuid,
  p_period_id uuid,
  p_covered_registration_id uuid,   -- the ENTRANT (canonical) reg — gets 'has_sub'
  p_covered_user_id uuid,
  p_sub_user_id uuid,
  p_for_registration_id uuid default null  -- the specific slot the sub fills (defaults to entrant)
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot        uuid := coalesce(p_for_registration_id, p_covered_registration_id);
  v_sub_reg     uuid;
  v_sub_row     uuid;
  v_covered_row uuid;
begin
  -- The sub's own registration in this league (if any) — link it; else store the bare user_id.
  select id into v_sub_reg
    from public.league_registrations
   where league_id = p_league_id and user_id = p_sub_user_id and status <> 'cancelled'
   limit 1;

  -- Find-or-create the sub's attendance row for the period.
  if v_sub_reg is not null then
    select id into v_sub_row
      from public.league_attendance
     where period_id = p_period_id and registration_id = v_sub_reg
       for update;
  else
    select id into v_sub_row
      from public.league_attendance
     where period_id = p_period_id and user_id = p_sub_user_id
     limit 1
       for update;
  end if;

  if v_sub_row is null then
    insert into public.league_attendance (league_id, period_id, registration_id, user_id, status)
    values (p_league_id, p_period_id, v_sub_reg, p_sub_user_id, 'present')
    returning id into v_sub_row;
  end if;

  update public.league_attendance
     set subbing_for_registration_id = v_slot,
         status = 'present',
         updated_at = now()
   where id = v_sub_row;

  -- Mark the covered ENTRANT 'has_sub' (update-or-insert their row).
  select id into v_covered_row
    from public.league_attendance
   where period_id = p_period_id and registration_id = p_covered_registration_id
     for update;
  if v_covered_row is not null then
    update public.league_attendance
       set status = 'has_sub', updated_at = now()
     where id = v_covered_row;
  else
    insert into public.league_attendance (league_id, period_id, registration_id, user_id, status)
    values (p_league_id, p_period_id, p_covered_registration_id, p_covered_user_id, 'has_sub');
  end if;

  return jsonb_build_object('sub_attendance_id', v_sub_row);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. accept_sub_request — atomic claim + validate + place + audit (ONE transaction)
--    Trust boundary: called only by the accept route with the getUser()-authenticated id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.accept_sub_request(
  p_request_id uuid,
  p_accepter_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r                record;   -- the locked request
  v_league         record;
  v_accepter       record;
  v_session        record;
  v_period         record;
  v_required_gender text;
  v_today          date := (now() at time zone 'America/Los_Angeles')::date;
  v_covered_sp_id  uuid;
  v_slot_reg_id    uuid;
  v_slot_partner   uuid;
  v_entrant_reg_id uuid;
  v_place          jsonb;
  v_placement_target jsonb;
begin
  if p_request_id is null or p_accepter_id is null then
    raise exception 'bad_request';
  end if;

  -- (1) Lock the request row — the serialization point for concurrent accepts.
  select * into r from public.league_sub_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;

  -- (2) Idempotency: the SAME accepter re-accepting an already-filled request → success, no re-place.
  if r.status = 'filled' and r.filled_by_user_id = p_accepter_id then
    return jsonb_build_object('ok', true, 'idempotent', true, 'request_id', r.id,
      'status', r.status, 'filled_by_user_id', r.filled_by_user_id);
  end if;

  -- (3) Must currently be open (covers filled-by-other / cancelled / expired → lost race).
  if r.status <> 'open' then
    raise exception 'already_filled';
  end if;

  -- (4) Not past expiry.
  if r.expires_at is not null and r.expires_at <= now() then
    raise exception 'request_expired';
  end if;

  -- (5) Exactly one scope (CHECK also guarantees this; defense in depth).
  if (r.league_session_id is null) = (r.league_period_id is null) then
    raise exception 'invalid_scope';
  end if;

  -- (6) Requester cannot accept their own request.
  if r.requesting_player_id = p_accepter_id then
    raise exception 'own_request';
  end if;

  -- (7) Accepter account eligibility — real, completed profile (no suspension model exists in the
  --     schema; is_stub is the account-completeness gate). dummy/discoverable are matching-pool
  --     filters (Phase 4), not correctness gates, so they are NOT enforced here.
  select id, name, gender, joinzer_rating, is_stub into v_accepter
    from public.profiles where id = p_accepter_id;
  if not found then raise exception 'accepter_not_found'; end if;
  if v_accepter.is_stub then raise exception 'accepter_ineligible'; end if;

  -- (8) League + supported format, re-derived from the authoritative table (never trust the request).
  select id, format, format_kind, sub_credit_cap into v_league
    from public.leagues where id = r.league_id;
  if not found then raise exception 'league_not_found'; end if;

  -- Required-division gender — hard gate, derived from the league format (mens_/womens_).
  v_required_gender := case
    when v_league.format like 'mens_%'   then 'male'
    when v_league.format like 'womens_%' then 'female'
    else null end;
  if r.gender_required in ('male', 'mens', 'men') then v_required_gender := 'male';
  elsif r.gender_required in ('female', 'womens', 'women') then v_required_gender := 'female';
  end if;
  if v_required_gender is not null and coalesce(v_accepter.gender, '') <> v_required_gender then
    raise exception 'gender_mismatch';
  end if;

  -- Serialize placement of THIS accepter into THIS occasion (the placement tables have no
  -- (session,user)/(period,user) unique index for the no-registration path), so two requests
  -- accepted by the same user in the same occasion can't double-insert a participation row.
  perform pg_advisory_xact_lock(
    hashtextextended('sub_place:' || coalesce(r.league_session_id, r.league_period_id)::text
                     || ':' || p_accepter_id::text, 0)
  );

  if r.league_session_id is not null then
    -- ============================= ROUND ROBIN =============================
    if v_league.format_kind <> 'session_rr' then
      raise exception 'unsupported_format';
    end if;

    select id, league_id, session_date, session_time, status into v_session
      from public.league_sessions where id = r.league_session_id for update;
    if not found then raise exception 'occasion_not_found'; end if;
    if v_session.league_id <> r.league_id then raise exception 'scope_mismatch'; end if;

    -- Occasion open + not started (past-dated or closed → gone).
    if v_session.status in ('completed', 'cancelled') then raise exception 'occasion_started'; end if;
    if v_session.session_date < v_today then raise exception 'occasion_started'; end if;

    -- Placement guard: rounds not yet generated.
    if exists (select 1 from public.league_rounds where session_id = v_session.id) then
      raise exception 'generation_started';
    end if;

    -- Duplicate participation: accepter not already in this session (roster or sub).
    if exists (select 1 from public.league_session_players
                where session_id = v_session.id and user_id = p_accepter_id) then
      raise exception 'duplicate_participation';
    end if;

    -- Schedule conflict (day-granular, Pacific): another RR session the accepter has signalled
    -- attendance at that day, OR a joined Play event that day.
    if exists (
      select 1 from public.league_session_players sp
      join public.league_sessions s2 on s2.id = sp.session_id
      where sp.user_id = p_accepter_id
        and s2.id <> v_session.id
        and s2.session_date = v_session.session_date
        and s2.status <> 'cancelled'
        and sp.player_type in ('roster_player', 'sub')
        and sp.actual_status in ('present', 'coming', 'late')
    ) or exists (
      select 1 from public.event_participants ep
      join public.events e on e.id = ep.event_id
      where ep.user_id = p_accepter_id
        and ep.participant_status = 'joined'
        and e.status not in ('cancelled', 'completed')
        and (e.starts_at at time zone 'America/Los_Angeles')::date = v_session.session_date
    ) then
      raise exception 'schedule_conflict';
    end if;

    -- Resolve (or create) the covered roster-player's session row from requesting_player_id.
    select id into v_covered_sp_id
      from public.league_session_players
     where session_id = v_session.id and user_id = r.requesting_player_id and player_type = 'roster_player'
       for update;
    if v_covered_sp_id is null then
      insert into public.league_session_players
        (session_id, user_id, display_name, player_type, expected_status, actual_status, joinzer_rating)
      select v_session.id, r.requesting_player_id, coalesce(p.name, 'Player'), 'roster_player', 'expected', 'not_present',
             coalesce(p.joinzer_rating, 1000)
        from public.profiles p where p.id = r.requesting_player_id
      returning id into v_covered_sp_id;
      if v_covered_sp_id is null then raise exception 'covered_not_found'; end if;
    end if;

    -- Covered must not already have a sub linked.
    if exists (select 1 from public.league_session_players
                where session_id = v_session.id and sub_for_session_player_id = v_covered_sp_id) then
      raise exception 'already_covered';
    end if;

    -- (5→filled) Conditional transition (belt + suspenders under the row lock).
    update public.league_sub_requests
       set status = 'filled', filled_by_user_id = p_accepter_id, filled_at = now()
     where id = r.id and status = 'open';
    if not found then raise exception 'already_filled'; end if;

    -- (6) PLACE via the shared primitive (same txn).
    v_place := public.place_league_sub_rr(v_session.id, v_covered_sp_id, p_accepter_id, true);
    v_placement_target := jsonb_build_object('kind', 'rr',
      'covered_session_player_id', v_covered_sp_id,
      'sub_session_player_id', v_place->>'id');

  else
    -- ============================ BOX / LADDER ============================
    if v_league.format_kind not in ('box', 'ladder') then
      raise exception 'unsupported_format';
    end if;

    select id, league_id, period_kind, status into v_period
      from public.league_periods where id = r.league_period_id for update;
    if not found then raise exception 'occasion_not_found'; end if;
    if v_period.league_id <> r.league_id then raise exception 'scope_mismatch'; end if;

    -- Occasion must be the active period (periods carry no clock; 'active' is the operational gate).
    if v_period.status <> 'active' then raise exception 'occasion_started'; end if;

    -- Placement guard: fixtures not yet generated for this period.
    if exists (select 1 from public.league_fixtures where period_id = v_period.id) then
      raise exception 'generation_started';
    end if;

    -- Resolve the requester's own registration (the SLOT) + the canonical ENTRANT.
    select id, partner_registration_id into v_slot_reg_id, v_slot_partner
      from public.league_registrations
     where league_id = r.league_id and user_id = r.requesting_player_id and status = 'registered'
     limit 1;
    if v_slot_reg_id is null then raise exception 'covered_not_found'; end if;
    v_entrant_reg_id := case
      when v_slot_partner is not null and v_slot_partner < v_slot_reg_id then v_slot_partner
      else v_slot_reg_id end;

    -- Duplicate participation: accepter not already an attendee in this period (by user or reg).
    if exists (
      select 1 from public.league_attendance a
      where a.period_id = v_period.id
        and (a.user_id = p_accepter_id
             or a.registration_id in (
               select id from public.league_registrations
               where league_id = r.league_id and user_id = p_accepter_id and status <> 'cancelled'))
    ) then
      raise exception 'duplicate_participation';
    end if;

    -- Covered slot must not already have a sub linked.
    if exists (select 1 from public.league_attendance
                where period_id = v_period.id and subbing_for_registration_id = v_slot_reg_id) then
      raise exception 'already_covered';
    end if;

    -- (5→filled) Conditional transition.
    update public.league_sub_requests
       set status = 'filled', filled_by_user_id = p_accepter_id, filled_at = now()
     where id = r.id and status = 'open';
    if not found then raise exception 'already_filled'; end if;

    -- (6) PLACE via the shared primitive (same txn).
    v_place := public.place_league_sub_attendance(
      r.league_id, v_period.id, v_entrant_reg_id, r.requesting_player_id, p_accepter_id, v_slot_reg_id);
    v_placement_target := jsonb_build_object('kind', 'attendance',
      'entrant_registration_id', v_entrant_reg_id,
      'slot_registration_id', v_slot_reg_id,
      'sub_attendance_id', v_place->>'sub_attendance_id');
  end if;

  -- (7) Audit — inside the txn, so a completed substitution can never exist without its record.
  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_accepter_id, 'league_sub_request', r.id, 'sub_request_filled',
    jsonb_build_object('status', 'open'),
    jsonb_build_object(
      'status', 'filled',
      'league_id', r.league_id,
      'requesting_player_id', r.requesting_player_id,
      'filled_by_user_id', p_accepter_id,
      'fulfillment_mode', r.fulfillment_mode,
      'session_id', r.league_session_id,
      'period_id', r.league_period_id,
      'placement', v_placement_target,
      'placed_with_override', false));

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'request_id', r.id, 'league_id', r.league_id,
    'status', 'filled', 'filled_by_user_id', p_accepter_id,
    'requesting_player_id', r.requesting_player_id,
    'fulfillment_mode', r.fulfillment_mode,
    'scope', case when r.league_session_id is not null then 'session' else 'period' end,
    'session_id', r.league_session_id, 'period_id', r.league_period_id,
    'placement', v_placement_target);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock down execution — service_role only (the route is the auth boundary).
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.place_league_sub_rr(uuid, uuid, uuid, boolean) from public;
revoke all on function public.place_league_sub_attendance(uuid, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.accept_sub_request(uuid, uuid) from public;

grant execute on function public.place_league_sub_rr(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.place_league_sub_attendance(uuid, uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.accept_sub_request(uuid, uuid) to service_role;

comment on function public.accept_sub_request(uuid, uuid) is
  'Atomic league-substitute acceptance (Phase 2). Locks the request row, revalidates every hard '
  'eligibility rule under the lock, transitions status open->filled, and places the substitute via '
  'the shared placement primitive — all in ONE transaction, so status and participation can never '
  'diverge. RR (league_session_id) + box/ladder (league_period_id) only; team/flex/tournament raise '
  'unsupported_format. SECURITY DEFINER, EXECUTE = service_role only: the accept API route '
  'authenticates the caller and passes the authenticated id as p_accepter_id.';

comment on function public.place_league_sub_rr(uuid, uuid, uuid, boolean) is
  'Single round-robin substitute placement primitive (find-or-create the sub session-player row, '
  'link to the covered roster row, optional has_sub). Called by accept_sub_request and by the '
  'refactored assignRrSub TS helper so all placement paths share one implementation.';

comment on function public.place_league_sub_attendance(uuid, uuid, uuid, uuid, uuid, uuid) is
  'Single box/ladder substitute placement primitive over league_attendance (find-or-create the sub '
  'attendance row, link to the covered slot, mark the entrant has_sub; credit stays on the covered '
  'registration). Called by accept_sub_request and by the refactored assignAttendanceSub TS helper.';
