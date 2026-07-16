-- Phase 2 verification for accept_sub_request + the shared placement primitives.
-- Self-contained: builds synthetic RR / box / ladder / mens leagues (referencing real auth.users
-- ids) and exercises every success + rejection + idempotency + atomic-rollback path. It records
-- each test's outcome into a temp table and returns them all in one SELECT (a result COLLECTOR, so
-- one failure never hides the others), then ROLLS BACK — no persistent changes.
--
-- Design notes learned the hard way:
--   * raises use the DEFAULT errcode (P0001 raise_exception). Do NOT tag them with using errcode
--     P0004 — that is assert_failure, which `WHEN OTHERS` intentionally does not catch (only
--     query_canceled + assert_failure are excluded). The message string IS the machine code.
--   * base leagues/sessions/periods/regs are created in the DO body (persist across tests); each
--     test runs in its own subtransaction that reverts via a 'RB' sentinel.
--
-- Run against prod (or any env with the 20260716000004 functions applied) via the SQL editor or
-- MCP execute_sql. Expect every row's `ok` = true.
--
-- CONCURRENCY is proven separately (a single serial transaction cannot exercise a race): create one
-- committed open request, then fire TWO parallel `select accept_sub_request(<req>, <userA/userB>)`
-- calls on separate connections. Exactly one returns {ok:true} with a single placement; the other
-- raises `already_filled` before any write. Verified July 16 2026 (U1 won, U5 lost, no double
-- placement); seed rows cleaned up afterward.

begin;
create temp table _r(t text, ok boolean, detail text) on commit drop;

do $$
declare
  U1 uuid := '3fc905c3-8d21-4b3d-854f-7d51c8b61451'; -- Abel    (gender null)
  U2 uuid := '40772a62-dda6-4f67-93dd-d544ae3b37f3'; -- Abigail (gender null)
  U3 uuid := '7b18cf1d-38ae-4b7e-b52f-4467ab93690e'; -- Adrian  (male)
  U4 uuid := '578f3a39-33e5-4e86-bbc5-7e7b599b7e34'; -- Marty Test (male)
  U5 uuid := 'aab7568a-c55b-4dd1-b60a-6a12c16d9fab'; -- Marty1  (male)
  U6 uuid := '8c6aa5c5-16e2-4fd3-b6ff-ae52f8d679e7'; -- Mendoza (male)
  STUBU uuid := '30d49abd-5f9b-4d42-a794-bfa0a96e300f'; -- a stub (is_stub=true)
  d_future date := ((now() at time zone 'America/Los_Angeles')::date + 7);
  la uuid; sa uuid; sa2 uuid; lb uuid; pb uuid; lc uuid; pc uuid; ld uuid; sd uuid;
  reg_u2_lb uuid; reg_u1_lb uuid; reg_u2_lc uuid;
  v_req uuid; v_res jsonb; v_cov uuid; v_cnt int; v_out text;
begin
  insert into public.leagues (name,format,format_kind,created_by) values ('P2 RR','open_singles','session_rr',U4) returning id into la;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (la,d_future,1,'scheduled') returning id into sa;
  insert into public.league_registrations (league_id,user_id,status) values (la,U1,'registered'),(la,U2,'registered'),(la,U3,'registered'),(la,U4,'registered'),(la,U5,'registered'),(la,U6,'registered');
  insert into public.leagues (name,format,format_kind,created_by) values ('P2 Box','open_singles','box',U4) returning id into lb;
  insert into public.league_periods (league_id,period_number,period_kind,status) values (lb,1,'cycle','active') returning id into pb;
  insert into public.league_registrations (league_id,user_id,status) values (lb,U2,'registered') returning id into reg_u2_lb;
  insert into public.league_registrations (league_id,user_id,status) values (lb,U1,'registered') returning id into reg_u1_lb;
  insert into public.leagues (name,format,format_kind,created_by) values ('P2 Ladder','open_singles','ladder',U4) returning id into lc;
  insert into public.league_periods (league_id,period_number,period_kind,status) values (lc,1,'ladder_session','active') returning id into pc;
  insert into public.league_registrations (league_id,user_id,status) values (lc,U2,'registered') returning id into reg_u2_lc;
  insert into public.leagues (name,format,format_kind,created_by) values ('P2 Mens','mens_singles','session_rr',U4) returning id into ld;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (ld,d_future,1,'scheduled') returning id into sd;
  insert into public.league_registrations (league_id,user_id,status) values (ld,U3,'registered');

  -- T01 RR happy
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    v_res := public.accept_sub_request(v_req,U1);
    if (v_res->>'ok')::bool is not true or (v_res->>'idempotent')::bool is true then raise exception 'bad result %',v_res; end if;
    perform 1 from public.league_sub_requests where id=v_req and status='filled' and filled_by_user_id=U1 and filled_at is not null; if not found then raise exception 'not filled'; end if;
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player'; if v_cov is null then raise exception 'no covered'; end if;
    perform 1 from public.league_session_players where id=v_cov and actual_status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    perform 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub' and actual_status='present' and sub_for_session_player_id=v_cov; if not found then raise exception 'sub not linked'; end if;
    perform 1 from public.audit_log where entity_id=v_req and action='sub_request_filled' and (after->>'filled_by_user_id')=U1::text and (after->>'placed_with_override')='false'; if not found then raise exception 'audit missing'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('T01 RR happy', v_out='PASS', v_out);

  -- T02 Box happy (sub has a registration → attendance row links it)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_period_id,requesting_player_id,covered_registration_id,status) values (lb,pb,U2,reg_u2_lb,'open') returning id into v_req;
    perform public.accept_sub_request(v_req,U1);
    perform 1 from public.league_sub_requests where id=v_req and status='filled' and filled_by_user_id=U1; if not found then raise exception 'not filled'; end if;
    perform 1 from public.league_attendance where period_id=pb and user_id=U1 and registration_id=reg_u1_lb and subbing_for_registration_id=reg_u2_lb and status='present'; if not found then raise exception 'sub att not linked'; end if;
    perform 1 from public.league_attendance where period_id=pb and registration_id=reg_u2_lb and status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('T02 Box happy', v_out='PASS', v_out);

  -- T03 Ladder happy (sub has NO registration → attendance row stores bare user_id)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_period_id,requesting_player_id,covered_registration_id,status) values (lc,pc,U2,reg_u2_lc,'open') returning id into v_req;
    perform public.accept_sub_request(v_req,U1);
    perform 1 from public.league_attendance where period_id=pc and user_id=U1 and registration_id is null and subbing_for_registration_id=reg_u2_lc and status='present'; if not found then raise exception 'sub(bare) not linked'; end if;
    perform 1 from public.league_attendance where period_id=pc and registration_id=reg_u2_lc and status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('T03 Ladder happy', v_out='PASS', v_out);

  -- T04 own_request
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U1,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected own_request';
    exception when others then if sqlerrm='own_request' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T04 own_request', v_out='PASS', v_out);

  -- T05 duplicate_participation
  v_out:=null;
  begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U1,'Abel','roster_player');
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected dup';
    exception when others then if sqlerrm='duplicate_participation' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T05 duplicate_participation', v_out='PASS', v_out);

  -- T06 generation_started (RR rounds exist)
  v_out:=null;
  begin
    insert into public.league_rounds (session_id,round_number,status) values (sa,1,'draft');
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected gen';
    exception when others then if sqlerrm='generation_started' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T06 generation_started (rounds)', v_out='PASS', v_out);

  -- T06b generation_started (box fixtures exist)
  v_out:=null;
  begin
    insert into public.league_fixtures (league_id,period_id,match_stage,status) values (lb,pb,'round_robin','scheduled');
    insert into public.league_sub_requests (league_id,league_period_id,requesting_player_id,status) values (lb,pb,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected gen';
    exception when others then if sqlerrm='generation_started' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T06b generation_started (fixtures)', v_out='PASS', v_out);

  -- T07 unsupported_format (session-scoped request on a non-RR league)
  v_out:=null;
  begin
    update public.leagues set format_kind='team' where id=la;
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected unsupported';
    exception when others then if sqlerrm='unsupported_format' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T07 unsupported_format', v_out='PASS', v_out);

  -- T08 occasion_started (session completed)
  v_out:=null;
  begin
    update public.league_sessions set status='completed' where id=sa;
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected occ';
    exception when others then if sqlerrm='occasion_started' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T08 occasion_started', v_out='PASS', v_out);

  -- T09 gender_mismatch (mens league, accepter gender null)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (ld,sd,U3,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected gender';
    exception when others then if sqlerrm='gender_mismatch' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T09 gender_mismatch', v_out='PASS', v_out);

  -- T10 already_filled (serial lost race)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    perform public.accept_sub_request(v_req,U1);
    begin perform public.accept_sub_request(v_req,U5); v_out:='FAIL: expected already_filled';
    exception when others then if sqlerrm='already_filled' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T10 already_filled', v_out='PASS', v_out);

  -- T11 idempotent same-user re-accept (no double placement/audit)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    perform public.accept_sub_request(v_req,U1);
    v_res := public.accept_sub_request(v_req,U1);
    if (v_res->>'idempotent')::bool is not true then raise exception 'not idempotent %',v_res; end if;
    select count(*) into v_cnt from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub'; if v_cnt<>1 then raise exception 'dup placement %',v_cnt; end if;
    select count(*) into v_cnt from public.audit_log where entity_id=v_req and action='sub_request_filled'; if v_cnt<>1 then raise exception 'dup audit %',v_cnt; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('T11 idempotent retry', v_out='PASS', v_out);

  -- T12 schedule_conflict (accepter present in another RR session same Pacific date)
  v_out:=null;
  begin
    insert into public.league_sessions (league_id,session_date,session_number,status) values (la,d_future,2,'scheduled') returning id into sa2;
    insert into public.league_session_players (session_id,user_id,display_name,player_type,actual_status) values (sa2,U1,'Abel','roster_player','present');
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected conflict';
    exception when others then if sqlerrm='schedule_conflict' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T12 schedule_conflict', v_out='PASS', v_out);

  -- T13 already_covered (covered roster row already has a sub linked)
  v_out:=null;
  begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U2,'Abigail','roster_player') returning id into v_cov;
    insert into public.league_session_players (session_id,user_id,display_name,player_type,actual_status,sub_for_session_player_id) values (sa,U6,'Mendoza','sub','present',v_cov);
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected already_covered';
    exception when others then if sqlerrm='already_covered' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T13 already_covered', v_out='PASS', v_out);

  -- T14 scope_mismatch (request league <> the session's league)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (ld,sa,U3,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U5); v_out:='FAIL: expected scope_mismatch';
    exception when others then if sqlerrm='scope_mismatch' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T14 scope_mismatch', v_out='PASS', v_out);

  -- T15 request_not_found
  v_out:=null;
  begin
    begin perform public.accept_sub_request(gen_random_uuid(),U1); v_out:='FAIL: expected not_found';
    exception when others then if sqlerrm='request_not_found' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
  exception when others then v_out:='FAIL(outer): '||sqlerrm; end;
  insert into _r values('T15 request_not_found', v_out='PASS', v_out);

  -- T16 accepter_ineligible (stub account)
  v_out:=null;
  begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,STUBU); v_out:='FAIL: expected ineligible';
    exception when others then if sqlerrm='accepter_ineligible' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T16 accepter_ineligible', v_out='PASS', v_out);

  -- T17 atomic rollback: a trigger forces the SUB-row insert (post-transition) to fail; prove the
  -- request reverts to open with no sub row and no audit (claim+placement+audit are one unit).
  v_out:=null;
  begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U2,'Abigail','roster_player');
    create or replace function pg_temp.p2_fail_lsp() returns trigger language plpgsql as $f$ begin raise exception 'INJECTED'; end; $f$;
    create trigger p2_fail_lsp_trg before insert on public.league_session_players for each row execute function pg_temp.p2_fail_lsp();
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status) values (la,sa,U2,'open') returning id into v_req;
    begin perform public.accept_sub_request(v_req,U1); v_out:='FAIL: expected injected';
    exception when others then if sqlerrm='INJECTED' then v_out:='PASS-so-far'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    drop trigger p2_fail_lsp_trg on public.league_session_players;
    if v_out='PASS-so-far' then
      perform 1 from public.league_sub_requests where id=v_req and status='open' and filled_by_user_id is null and filled_at is null; if not found then v_out:='FAIL: request not left open'; end if;
      if v_out='PASS-so-far' and exists(select 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub') then v_out:='FAIL: sub leaked'; end if;
      if v_out='PASS-so-far' and exists(select 1 from public.audit_log where entity_id=v_req and action='sub_request_filled') then v_out:='FAIL: audit leaked'; end if;
      if v_out='PASS-so-far' then v_out:='PASS'; end if;
    end if;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('T17 atomic rollback', v_out='PASS', v_out);
end $$;

select t, ok, detail from _r order by t;
rollback;
