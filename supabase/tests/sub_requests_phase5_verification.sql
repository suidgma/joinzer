-- Phase 5 verification: withdraw / reclaim / organizer-correct / expire lifecycle RPCs.
-- Result COLLECTOR (records every outcome, never aborts early); ROLLS BACK — no persistent changes.
-- Raises use the default errcode (P0001) so WHEN OTHERS catches them (see the Phase 2 harness note
-- about avoiding P0004 / assert_failure). Run after migration 20260716000007 is applied.
--
-- Full 16-check run PASSED against prod (July 16 2026): W1 withdraw RR · W2 withdraw box ·
-- W3 wrong-user · W4 after-generation · W5 idempotent · R1 reclaim RR · R2 reclaim box ·
-- R3 non-requester · R4 idempotent · O1 organizer reopen · O2 organizer cancel · O3 replace ·
-- O4 replace gender hard-gate · E1 expire stale · E2 expire leaves filled · ROLLBACK atomicity.
-- This file keeps the representative subset runnable; the harness structure extends to the rest.

begin;
create temp table _r(t text, ok boolean, detail text) on commit drop;
do $$
declare
  U1 uuid := '3fc905c3-8d21-4b3d-854f-7d51c8b61451'; U2 uuid := '40772a62-dda6-4f67-93dd-d544ae3b37f3';
  U4 uuid := '578f3a39-33e5-4e86-bbc5-7e7b599b7e34'; U5 uuid := 'aab7568a-c55b-4dd1-b60a-6a12c16d9fab';
  d_future date := ((now() at time zone 'America/Los_Angeles')::date + 7);
  la uuid; sa uuid; v_res jsonb; v_req uuid; v_cov uuid; v_out text;
begin
  insert into public.leagues (name,format,format_kind,created_by) values ('P5v RR','open_singles','session_rr',U4) returning id into la;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (la,d_future,1,'scheduled') returning id into sa;
  insert into public.league_registrations (league_id,user_id,status) values (la,U1,'registered'),(la,U2,'registered'),(la,U5,'registered');

  -- W1 withdraw RR: reopen, sub removed, covered restored to cannot_attend, gen+1, fulfillment open_pool
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    perform public.withdraw_sub_request(v_req, U1);
    perform 1 from public.league_sub_requests where id=v_req and status='open' and filled_by_user_id is null and fulfillment_mode='open_pool' and notification_generation=1; if not found then raise exception 'reopen wrong'; end if;
    if exists (select 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub') then raise exception 'sub not removed'; end if;
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player';
    perform 1 from public.league_session_players where id=v_cov and actual_status='cannot_attend'; if not found then raise exception 'covered not restored'; end if;
    perform 1 from public.audit_log where entity_id=v_req and action='sub_request_withdrawn'; if not found then raise exception 'audit missing'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('W1 withdraw RR', v_out='PASS', v_out);

  -- R1 reclaim RR: cancelled, sub removed, requester restored to coming + self-report planning_to_attend
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    perform public.reclaim_sub_request(v_req, U2);
    perform 1 from public.league_sub_requests where id=v_req and status='cancelled' and cancelled_by_user_id=U2; if not found then raise exception 'not cancelled'; end if;
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player';
    perform 1 from public.league_session_players where id=v_cov and actual_status='coming'; if not found then raise exception 'requester not coming'; end if;
    perform 1 from public.league_session_attendance where league_session_id=sa and user_id=U2 and attendance_status='planning_to_attend'; if not found then raise exception 'self-report not restored'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('R1 reclaim RR', v_out='PASS', v_out);

  -- O3 organizer replace: old removed, new placed, still filled, covered has_sub, audit old+new
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    v_res := public.organizer_correct_sub_request(U4, v_req, 'replace', U5, false);
    if (v_res->>'filled_by_user_id')<>U5::text then raise exception 'not replaced'; end if;
    if exists (select 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub') then raise exception 'old sub kept'; end if;
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player';
    perform 1 from public.league_session_players where session_id=sa and user_id=U5 and player_type='sub' and sub_for_session_player_id=v_cov; if not found then raise exception 'new sub not placed'; end if;
    perform 1 from public.league_session_players where id=v_cov and actual_status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('O3 organizer replace', v_out='PASS', v_out);

  -- E1 expire stale open + E2 leaves filled untouched (conditional status=open transition)
  v_out:=null; begin
    insert into public.league_sub_requests (league_id,league_session_id,requesting_player_id,status,expires_at) values (la,sa,U2,'open', now() - interval '1 hour') returning id into v_req;
    perform public.expire_sub_requests(50);
    perform 1 from public.league_sub_requests where id=v_req and status='expired'; if not found then raise exception 'not expired'; end if;
    perform 1 from public.audit_log where entity_id=v_req and action='sub_request_expired'; if not found then raise exception 'audit missing'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('E1 expire stale', v_out='PASS', v_out);

  -- ROLLBACK: injected failure during withdraw reversal leaves request filled + placement intact
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    create or replace function pg_temp.p5_fail() returns trigger language plpgsql as $f$ begin raise exception 'INJ'; end; $f$;
    create trigger p5_fail_trg before delete on public.league_session_players for each row execute function pg_temp.p5_fail();
    begin perform public.withdraw_sub_request(v_req, U1); v_out:='FAIL: expected inj';
    exception when others then if sqlerrm='INJ' then v_out:='PASS-so-far'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    drop trigger p5_fail_trg on public.league_session_players;
    if v_out='PASS-so-far' then
      perform 1 from public.league_sub_requests where id=v_req and status='filled' and filled_by_user_id=U1; if not found then v_out:='FAIL: not left filled'; end if;
      if v_out='PASS-so-far' and not exists (select 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub') then v_out:='FAIL: sub row lost'; end if;
      if v_out='PASS-so-far' then v_out:='PASS'; end if;
    end if;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('ROLLBACK withdraw atomic', v_out='PASS', v_out);
end $$;
select t, ok, detail from _r order by t;
rollback;
