-- Phase 3 verification for create_player_sub_request + assign_organizer_sub_request.
-- Result COLLECTOR (records every outcome, never aborts early); ROLLS BACK. Expect every ok=true.
-- Raises use the default errcode (P0001) so WHEN OTHERS catches them — see the Phase 2 harness note
-- about avoiding P0004 (assert_failure). Run after migration 20260716000005 is applied.

begin;
create temp table _r(t text, ok boolean, detail text) on commit drop;
do $$
declare
  U1 uuid := '3fc905c3-8d21-4b3d-854f-7d51c8b61451'; U2 uuid := '40772a62-dda6-4f67-93dd-d544ae3b37f3';
  U3 uuid := '7b18cf1d-38ae-4b7e-b52f-4467ab93690e'; U4 uuid := '578f3a39-33e5-4e86-bbc5-7e7b599b7e34';
  U5 uuid := 'aab7568a-c55b-4dd1-b60a-6a12c16d9fab'; U6 uuid := '8c6aa5c5-16e2-4fd3-b6ff-ae52f8d679e7';
  STUBU uuid := '30d49abd-5f9b-4d42-a794-bfa0a96e300f';
  d_future date := ((now() at time zone 'America/Los_Angeles')::date + 7);
  la uuid; sa uuid; lb uuid; pb uuid; lc uuid; pc uuid; ld uuid; sd uuid;
  reg_u2_lb uuid; v_res jsonb; v_req uuid; v_cov uuid; v_cnt int; v_out text;
begin
  insert into public.leagues (name,format,format_kind,created_by) values ('P3 RR','open_singles','session_rr',U4) returning id into la;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (la,d_future,1,'scheduled') returning id into sa;
  insert into public.league_registrations (league_id,user_id,status) values (la,U1,'registered'),(la,U2,'registered'),(la,U3,'registered'),(la,U5,'registered'),(la,U6,'registered');
  insert into public.leagues (name,format,format_kind,created_by) values ('P3 Box','open_singles','box',U4) returning id into lb;
  insert into public.league_periods (league_id,period_number,period_kind,status) values (lb,1,'cycle','active') returning id into pb;
  insert into public.league_registrations (league_id,user_id,status) values (lb,U2,'registered') returning id into reg_u2_lb;
  insert into public.league_registrations (league_id,user_id,status) values (lb,U1,'registered');
  insert into public.leagues (name,format,format_kind,created_by) values ('P3 Ladder','open_singles','ladder',U4) returning id into lc;
  insert into public.league_periods (league_id,period_number,period_kind,status) values (lc,1,'ladder_session','active') returning id into pc;
  insert into public.league_registrations (league_id,user_id,status) values (lc,U2,'registered');
  insert into public.leagues (name,format,format_kind,created_by) values ('P3 Mens','mens_singles','session_rr',U4) returning id into ld;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (ld,d_future,1,'scheduled') returning id into sd;
  insert into public.league_registrations (league_id,user_id,status) values (ld,U3,'registered');

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, 'need a sub');
    if (v_res->>'status')<>'open' then raise exception 'not open %',v_res; end if;
    perform 1 from public.league_sub_requests where id=(v_res->>'request_id')::uuid and status='open' and fulfillment_mode='open_pool' and requesting_player_id=U2 and league_session_id=sa and format='open_singles' and expires_at is not null and notes='need a sub';
    if not found then raise exception 'row wrong'; end if;
    perform 1 from public.audit_log where entity_id=(v_res->>'request_id')::uuid and action='sub_request_created'; if not found then raise exception 'audit missing'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P01 open_pool RR', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, lb, 'period', pb, 'open_pool', null, null);
    perform 1 from public.league_sub_requests where id=(v_res->>'request_id')::uuid and status='open' and league_period_id=pb and covered_registration_id=reg_u2_lb and expires_at is null;
    if not found then raise exception 'row wrong'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P02 open_pool box', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, lc, 'period', pc, 'open_pool', null, null);
    if (v_res->>'status')<>'open' then raise exception 'not open'; end if; v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P03 open_pool ladder', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'self_assigned', U1, null);
    if (v_res->>'status')<>'filled' then raise exception 'not filled %',v_res; end if; v_req := (v_res->>'request_id')::uuid;
    perform 1 from public.league_sub_requests where id=v_req and status='filled' and fulfillment_mode='self_assigned' and filled_by_user_id=U1; if not found then raise exception 'req wrong'; end if;
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player';
    perform 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub' and sub_for_session_player_id=v_cov and actual_status='present'; if not found then raise exception 'sub not placed'; end if;
    perform 1 from public.league_session_players where id=v_cov and actual_status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P04 self_assigned RR fill', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, lb, 'period', pb, 'self_assigned', U1, null);
    if (v_res->>'status')<>'filled' then raise exception 'not filled'; end if;
    perform 1 from public.league_attendance where period_id=pb and user_id=U1 and subbing_for_registration_id=reg_u2_lb and status='present'; if not found then raise exception 'sub not placed'; end if;
    perform 1 from public.league_attendance where period_id=pb and registration_id=reg_u2_lb and status='has_sub'; if not found then raise exception 'covered not has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P05 self_assigned box fill', v_out='PASS', v_out);

  v_out:=null; begin
    perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null);
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_out:='FAIL: expected already_open';
    exception when others then if sqlerrm='already_open' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P06 dedupe already_open', v_out='PASS', v_out);

  v_out:=null; begin
    perform public.create_player_sub_request(U2, la, 'session', sa, 'self_assigned', U1, null);
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_out:='FAIL: expected already_filled';
    exception when others then if sqlerrm='already_filled' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P07 already_filled', v_out='PASS', v_out);

  v_out:=null; begin
    begin perform public.create_player_sub_request(U6, ld, 'session', sd, 'open_pool', null, null); v_out:='FAIL: expected not_registered';
    exception when others then if sqlerrm='not_registered' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
  exception when others then v_out:='FAIL(outer): '||sqlerrm; end;
  insert into _r values('P08 not_registered', v_out='PASS', v_out);

  v_out:=null; begin
    update public.leagues set format_kind='team' where id=la;
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_out:='FAIL: expected unsupported';
    exception when others then if sqlerrm='unsupported_format' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P09 unsupported_format', v_out='PASS', v_out);

  v_out:=null; begin
    update public.league_sessions set status='completed' where id=sa;
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_out:='FAIL: expected occ';
    exception when others then if sqlerrm='occasion_started' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P10 occasion_started', v_out='PASS', v_out);

  v_out:=null; begin
    insert into public.league_rounds (session_id,round_number,status) values (sa,1,'draft');
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_out:='FAIL: expected gen';
    exception when others then if sqlerrm='generation_started' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P11 generation_started', v_out='PASS', v_out);

  v_out:=null; begin
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'self_assigned', U2, null); v_out:='FAIL: expected chosen_is_self';
    exception when others then if sqlerrm='chosen_is_self' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
  exception when others then v_out:='FAIL(outer): '||sqlerrm; end;
  insert into _r values('P12 chosen_is_self', v_out='PASS', v_out);

  v_out:=null; begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U1,'Abel','roster_player');
    begin perform public.create_player_sub_request(U2, la, 'session', sa, 'self_assigned', U1, null); exception when others then null; end;
    select count(*) into v_cnt from public.league_sub_requests where league_session_id=sa and requesting_player_id=U2;
    if v_cnt <> 0 then v_out:='FAIL: request row leaked ('||v_cnt||')'; else v_out:='PASS'; end if;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P13 self_assigned rollback', v_out='PASS', v_out);

  v_out:=null; begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U2,'Abigail','roster_player') returning id into v_cov;
    v_res := public.assign_organizer_sub_request(U4, la, 'session', sa, U2, v_cov, null, null, U1, false, null);
    if (v_res->>'status')<>'filled' or (v_res->>'fulfillment_mode')<>'organizer_assigned' then raise exception 'res wrong %',v_res; end if;
    perform 1 from public.league_sub_requests where id=(v_res->>'request_id')::uuid and status='filled' and fulfillment_mode='organizer_assigned' and filled_by_user_id=U1 and requesting_player_id=U2; if not found then raise exception 'record wrong'; end if;
    perform 1 from public.league_session_players where session_id=sa and user_id=U1 and player_type='sub' and sub_for_session_player_id=v_cov; if not found then raise exception 'sub not placed'; end if;
    perform 1 from public.audit_log where entity_id=(v_res->>'request_id')::uuid and action='sub_request_assigned'; if not found then raise exception 'audit missing'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P14 organizer RR assign', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req := (v_res->>'request_id')::uuid;
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U2,'Abigail','roster_player') returning id into v_cov;
    v_res := public.assign_organizer_sub_request(U4, la, 'session', sa, U2, v_cov, null, null, U1, false, null);
    if (v_res->>'request_id')::uuid <> v_req then raise exception 'did not reuse open request'; end if;
    select count(*) into v_cnt from public.league_sub_requests where league_session_id=sa and requesting_player_id=U2;
    if v_cnt <> 1 then raise exception 'orphan created (% rows)', v_cnt; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P15 organizer reuses open request', v_out='PASS', v_out);

  v_out:=null; begin
    v_res := public.assign_organizer_sub_request(U4, lb, 'period', pb, U2, null, reg_u2_lb, null, U1, true, null);
    perform 1 from public.league_sub_requests where id=(v_res->>'request_id')::uuid and status='filled' and fulfillment_mode='organizer_assigned' and placed_with_override=true; if not found then raise exception 'override not recorded'; end if;
    perform 1 from public.league_attendance where period_id=pb and user_id=U1 and subbing_for_registration_id=reg_u2_lb; if not found then raise exception 'sub not placed'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('P16 organizer box + override', v_out='PASS', v_out);

  v_out:=null; begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sd,U3,'Adrian','roster_player') returning id into v_cov;
    begin perform public.assign_organizer_sub_request(U4, ld, 'session', sd, U3, v_cov, null, null, U1, true, null); v_out:='FAIL: expected gender_mismatch';
    exception when others then if sqlerrm='gender_mismatch' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P17 organizer gender hard-gate', v_out='PASS', v_out);

  v_out:=null; begin
    insert into public.league_session_players (session_id,user_id,display_name,player_type) values (sa,U2,'Abigail','roster_player') returning id into v_cov;
    insert into public.league_session_players (session_id,user_id,display_name,player_type,actual_status,sub_for_session_player_id) values (sa,U6,'Mendoza','sub','present',v_cov);
    begin perform public.assign_organizer_sub_request(U4, la, 'session', sa, U2, v_cov, null, null, U1, true, null); v_out:='FAIL: expected already_covered';
    exception when others then if sqlerrm='already_covered' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if; end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('P18 organizer already_covered', v_out='PASS', v_out);
end $$;
select t, ok, detail from _r order by t;
rollback;
