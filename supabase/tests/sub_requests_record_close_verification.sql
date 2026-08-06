-- Verification: organizer_close_sub_request_record — post-generation, RECORD-ONLY close.
-- Result COLLECTOR (records every outcome, never aborts early); ROLLS BACK — no persistent changes.
-- Raises use the default errcode (P0001) so WHEN OTHERS catches them (see the Phase 2 harness note
-- about avoiding P0004 / assert_failure). Run after migration 20260806000001 is applied.
--
-- The whole point of this feature is what it does NOT touch, so most checks below are negative:
-- the substitute's placement row, the covered player's 'has_sub' status, and the generated
-- rounds/fixtures must all still be there afterwards.
--
-- Checks: C1 RR close after generation · C2 placement + covered survive · C3 refuses pre-generation
-- · C4 refuses when not filled · C5 bad reason rejected · C6 box/ladder after fixtures ·
-- C7 filled_by_user_id preserved + audit carries placement_left_in_place · C8 notification_generation
-- NOT bumped · C9 rounds/fixtures untouched.

begin;
create temp table _r(t text, ok boolean, detail text) on commit drop;
do $$
declare
  U1 uuid := '3fc905c3-8d21-4b3d-854f-7d51c8b61451'; U2 uuid := '40772a62-dda6-4f67-93dd-d544ae3b37f3';
  U4 uuid := '578f3a39-33e5-4e86-bbc5-7e7b599b7e34'; U5 uuid := 'aab7568a-c55b-4dd1-b60a-6a12c16d9fab';
  d_future date := ((now() at time zone 'America/Los_Angeles')::date + 7);
  la uuid; sa uuid; lb uuid; pb uuid;
  v_res jsonb; v_req uuid; v_cov uuid; v_out text; v_gen int; v_rounds int;
begin
  insert into public.leagues (name,format,format_kind,created_by) values ('RC RR','open_singles','session_rr',U4) returning id into la;
  insert into public.league_sessions (league_id,session_date,session_number,status) values (la,d_future,1,'scheduled') returning id into sa;
  insert into public.league_registrations (league_id,user_id,status) values (la,U1,'registered'),(la,U2,'registered'),(la,U5,'registered');

  -- C1/C2/C7/C8/C9: close after generation. Record moves; EVERYTHING else stands.
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    select id into v_cov from public.league_session_players where session_id=sa and user_id=U2 and player_type='roster_player';
    select notification_generation into v_gen from public.league_sub_requests where id=v_req;
    -- Generate play: this is what freezes organizer_correct_sub_request out.
    insert into public.league_rounds (session_id, round_number, status) values (sa, 1, 'draft');

    -- the standard path must now be refused (this is the gap the feature closes)
    begin
      perform public.organizer_correct_sub_request(U4, v_req, 'cancel', null, false);
      raise exception 'standard cancel unexpectedly succeeded post-generation';
    exception when others then
      if sqlerrm <> 'generation_started' then raise exception 'expected generation_started, got %', sqlerrm; end if;
    end;

    v_res := public.organizer_close_sub_request_record(U4, v_req, 'no_show');
    if (v_res->>'status') <> 'cancelled' then raise exception 'not cancelled'; end if;
    if (v_res->>'closed_sub') <> U1::text then raise exception 'closed_sub wrong'; end if;
    if v_res ? 'removed_sub' then raise exception 'returned removed_sub — would fire the wrong notification'; end if;

    -- C7: record moved, assignee PRESERVED, reason recorded
    perform 1 from public.league_sub_requests
      where id=v_req and status='cancelled' and record_closed_reason='no_show'
        and cancelled_by_user_id=U4 and filled_by_user_id=U1 and filled_at is not null;
    if not found then raise exception 'record not closed correctly / assignee not preserved'; end if;

    -- C2: the substitute is STILL PLACED and the covered player is STILL has_sub
    perform 1 from public.league_session_players
      where session_id=sa and user_id=U1 and player_type='sub' and sub_for_session_player_id=v_cov;
    if not found then raise exception 'PLACEMENT REVERSED — record-only was violated'; end if;
    perform 1 from public.league_session_players where id=v_cov and actual_status='has_sub';
    if not found then raise exception 'covered player no longer has_sub'; end if;

    -- C9: generated play untouched
    select count(*) into v_rounds from public.league_rounds where session_id=sa;
    if v_rounds <> 1 then raise exception 'league_rounds mutated (%)', v_rounds; end if;

    -- C8: no new substitute wave
    perform 1 from public.league_sub_requests where id=v_req and notification_generation=v_gen;
    if not found then raise exception 'notification_generation was bumped'; end if;

    -- audit carries the divergence marker
    perform 1 from public.audit_log
      where entity_id=v_req and action='sub_request_record_closed'
        and (after->>'placement_left_in_place')::boolean is true
        and after->>'reason'='no_show' and after->>'filled_by_user_id'=U1::text;
    if not found then raise exception 'audit missing or incomplete'; end if;

    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('C1 close after generation, placement intact', v_out='PASS', v_out);

  -- C3: refuses while the ordinary reversing path is still available (no rounds yet)
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    begin
      perform public.organizer_close_sub_request_record(U4, v_req, 'no_show');
      v_out:='FAIL: closed pre-generation';
    exception when others then
      if sqlerrm='use_standard_correction' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if;
    end;
    -- and the record must be untouched by the refusal
    if v_out='PASS' then
      perform 1 from public.league_sub_requests where id=v_req and status='filled' and record_closed_reason is null;
      if not found then v_out:='FAIL: refusal still mutated the row'; end if;
    end if;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('C3 refuses pre-generation', v_out='PASS', v_out);

  -- C4: not filled → not_filled (an open request has no assignee to close)
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    insert into public.league_rounds (session_id, round_number, status) values (sa, 1, 'draft');
    begin
      perform public.organizer_close_sub_request_record(U4, v_req, 'no_show');
      v_out:='FAIL: closed a non-filled request';
    exception when others then
      if sqlerrm='not_filled' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if;
    end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('C4 not_filled rejected', v_out='PASS', v_out);

  -- C5: reason is a closed set, enforced in the RPC (not only in the route)
  v_out:=null; begin
    v_res := public.create_player_sub_request(U2, la, 'session', sa, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    insert into public.league_rounds (session_id, round_number, status) values (sa, 1, 'draft');
    begin
      perform public.organizer_close_sub_request_record(U4, v_req, 'because i said so');
      v_out:='FAIL: accepted an arbitrary reason';
    exception when others then
      if sqlerrm='bad_request' then v_out:='PASS'; else v_out:='FAIL: got '||sqlerrm; end if;
    end;
    raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL(outer): '||sqlerrm; end if; end;
  insert into _r values('C5 bad reason rejected', v_out='PASS', v_out);

  -- C6: box/ladder — close after FIXTURES exist; attendance rows survive
  v_out:=null; begin
    insert into public.leagues (name,format,format_kind,created_by) values ('RC Box','open_singles','box',U4) returning id into lb;
    insert into public.league_periods (league_id,status,period_number) values (lb,'active',1) returning id into pb;
    insert into public.league_registrations (league_id,user_id,status) values (lb,U1,'registered'),(lb,U2,'registered');
    v_res := public.create_player_sub_request(U2, lb, 'period', pb, 'open_pool', null, null); v_req:=(v_res->>'request_id')::uuid;
    perform public.accept_sub_request(v_req, U1);
    insert into public.league_fixtures (league_id, period_id, match_number) values (lb, pb, 1);

    v_res := public.organizer_close_sub_request_record(U4, v_req, 'other');
    if (v_res->>'status') <> 'cancelled' then raise exception 'not cancelled'; end if;
    if (v_res->>'scope') <> 'period' then raise exception 'scope wrong'; end if;
    -- the substitute's attendance row must survive
    perform 1 from public.league_attendance where period_id=pb and subbing_for_registration_id is not null;
    if not found then raise exception 'PLACEMENT REVERSED — sub attendance row gone'; end if;
    perform 1 from public.league_attendance where period_id=pb and status='has_sub';
    if not found then raise exception 'covered entrant no longer has_sub'; end if;
    v_out:='PASS'; raise exception 'RB';
  exception when others then if sqlerrm='RB' then null; else v_out:='FAIL: '||sqlerrm; end if; end;
  insert into _r values('C6 box/ladder close after fixtures', v_out='PASS', v_out);
end $$;
select t, ok, detail from _r order by t;
rollback;
