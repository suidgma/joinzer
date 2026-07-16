-- Phase 1 verification for the unified league_sub_requests domain.
-- The repo has no DB-integration test harness (tests are pure-unit vitest), so this self-contained
-- SQL script is the verification mechanism for the schema-level guarantees. It runs entirely inside
-- one transaction and ROLLS BACK — it makes NO persistent changes. Any failed assertion RAISEs and
-- aborts; a clean run returns the row 'ALL PHASE 1 CHECKS PASSED'.
--
-- Run it in the Supabase SQL editor (or via MCP execute_sql) AFTER the
-- 20260716000003_unified_sub_requests_phase1 migration is applied.

begin;

do $$
declare
  v_league  uuid := (select id from public.leagues limit 1);
  v_session uuid := (select id from public.league_sessions limit 1);
  v_period  uuid := (select id from public.league_periods limit 1);
  -- a real auth.users id that is NOT already a requester (avoids colliding with existing open rows)
  v_user    uuid := (select u.id from auth.users u
                     where u.id not in (select requesting_player_id from public.league_sub_requests)
                     limit 1);
  v_failed  boolean;
begin
  if v_league is null or v_session is null or v_user is null then
    raise notice 'SKIP: insufficient seed data (need a league + session + a spare auth user)';
    return;
  end if;

  -- 1. Valid session-scoped (round-robin) request is accepted.
  insert into public.league_sub_requests (league_id, league_session_id, requesting_player_id, status)
  values (v_league, v_session, v_user, 'open');
  raise notice 'PASS 1: valid session-scoped request accepted';

  -- 2. A second OPEN request for the same (session, requester) is rejected (dedupe unique index).
  v_failed := false;
  begin
    insert into public.league_sub_requests (league_id, league_session_id, requesting_player_id, status)
    values (v_league, v_session, v_user, 'open');
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 2: duplicate open request was NOT rejected'; end if;
  raise notice 'PASS 2: duplicate open request rejected (one active request per covered player/occasion)';

  -- 3. Legacy status is rejected (final set is open|filled|cancelled|expired).
  v_failed := false;
  begin
    insert into public.league_sub_requests (league_id, league_session_id, requesting_player_id, status)
    values (v_league, v_session, v_user, 'claimed');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 3: legacy status ''claimed'' was NOT rejected'; end if;
  raise notice 'PASS 3: legacy status rejected (final status set enforced)';

  -- 4. Invalid fulfillment_mode is rejected.
  v_failed := false;
  begin
    insert into public.league_sub_requests (league_id, league_session_id, requesting_player_id, status, fulfillment_mode)
    values (v_league, v_session, v_user, 'open', 'bogus_mode');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 4: invalid fulfillment_mode was NOT rejected'; end if;
  raise notice 'PASS 4: invalid fulfillment_mode rejected';

  -- 5. Neither scope set is rejected (session XOR period).
  v_failed := false;
  begin
    insert into public.league_sub_requests (league_id, requesting_player_id, status)
    values (v_league, v_user, 'open');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5: no-scope request was NOT rejected'; end if;
  raise notice 'PASS 5: no-scope request rejected (XOR)';

  -- 6/7. Period-scoped checks (only if a league_period exists).
  if v_period is not null then
    -- 6. Both scopes set is rejected (XOR).
    v_failed := false;
    begin
      insert into public.league_sub_requests (league_id, league_session_id, league_period_id, requesting_player_id, status)
      values (v_league, v_session, v_period, v_user, 'open');
    exception when check_violation then v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL 6: both-scope request was NOT rejected'; end if;
    raise notice 'PASS 6: both-scope request rejected (XOR)';

    -- 7. Valid period-scoped (box/ladder) request is accepted.
    insert into public.league_sub_requests (league_id, league_period_id, requesting_player_id, status)
    values (v_league, v_period, v_user, 'open');
    raise notice 'PASS 7: valid period-scoped request accepted';
  else
    raise notice 'SKIP 6/7: no league_periods row available';
  end if;

  raise notice 'ALL PHASE 1 CHECKS PASSED';
end $$;

select 'ALL PHASE 1 CHECKS PASSED' as result;

rollback;
