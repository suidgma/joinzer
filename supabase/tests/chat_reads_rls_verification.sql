-- chat_reads RLS verification (migration 20260731000001_chat_reads.sql)
--
-- Runs entirely inside a transaction that ROLLS BACK — it writes nothing durable, so it is
-- safe against production. Uses the `set local role authenticated` + `request.jwt.claims`
-- pattern from docs/security.md rather than a browser session.
--
-- Every negative case records its SQLSTATE, so "the policy rejected this" (42501
-- insufficient_privilege) can never be confused with an environment failure such as a
-- read-only transaction (25006) or a missing table (42P01).
--
-- Ids are resolved from live data, so this stays re-runnable as the dataset changes.

begin;

create temp table harness_results (
  seq int, check_name text, expected text, actual text, sqlstate text, pass boolean
) on commit drop;

create temp table harness_ids on commit drop as
select l.id as league_id,
       lr.user_id as member_id,
       (select p.id from profiles p
         where p.id <> lr.user_id
           and not exists (select 1 from league_registrations x
                            where x.league_id = l.id and x.user_id = p.id and x.status <> 'cancelled')
           and not exists (select 1 from leagues y where y.id = l.id and y.created_by = p.id)
         limit 1) as non_member_id
from league_messages m
join leagues l on l.id = m.league_id
join league_registrations lr on lr.league_id = l.id and lr.status <> 'cancelled'
limit 1;

-- 1. A member can write their own read state for a chat they belong to.
do $$
declare v record; s text;
begin
  select * into v from harness_ids;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v.member_id)::text, true);
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.member_id, 'league_messages', v.league_id, now());
    reset role;
    insert into harness_results values (1, 'member inserts own row', 'INSERT succeeds', 'INSERT succeeded', '-', true);
  exception when others then
    s := sqlstate;
    reset role;
    insert into harness_results values (1, 'member inserts own row', 'INSERT succeeds', 'REJECTED: ' || sqlerrm, s, false);
  end;
end $$;

-- 2. A member cannot write a row carrying ANOTHER user's user_id (payload not trusted).
do $$
declare v record; s text;
begin
  select * into v from harness_ids;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v.member_id)::text, true);
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.non_member_id, 'league_messages', v.league_id, now());
    reset role;
    insert into harness_results values (2, 'insert with another user''s user_id', 'REJECTED 42501', 'INSERT SUCCEEDED', '-', false);
  exception when others then
    s := sqlstate;
    reset role;
    insert into harness_results values (2, 'insert with another user''s user_id', 'REJECTED 42501',
      'rejected: ' || sqlerrm, s, s = '42501');
  end;
end $$;

-- 3. A non-member cannot write read state for a chat they don't belong to.
do $$
declare v record; s text;
begin
  select * into v from harness_ids;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v.non_member_id)::text, true);
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.non_member_id, 'league_messages', v.league_id, now());
    reset role;
    insert into harness_results values (3, 'non-member inserts for that chat', 'REJECTED 42501', 'INSERT SUCCEEDED', '-', false);
  exception when others then
    s := sqlstate;
    reset role;
    insert into harness_results values (3, 'non-member inserts for that chat', 'REJECTED 42501',
      'rejected: ' || sqlerrm, s, s = '42501');
  end;
end $$;

-- 4. Cross-user SELECT returns nothing — the member's row is invisible to the other user.
do $$
declare v record; n int;
begin
  select * into v from harness_ids;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v.non_member_id)::text, true);
  select count(*) into n from chat_reads;
  reset role;
  insert into harness_results values (4, 'cross-user SELECT', '0 rows visible', n || ' rows visible', '-', n = 0);
end $$;

-- 5. The member sees exactly their own row.
do $$
declare v record; n int;
begin
  select * into v from harness_ids;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v.member_id)::text, true);
  select count(*) into n from chat_reads;
  reset role;
  insert into harness_results values (5, 'own-row SELECT', '1 row visible', n || ' rows visible', '-', n = 1);
end $$;

-- 6a. An unknown source_table is refused for a normal client. Note this comes back as 42501,
--     NOT the CHECK constraint's 23514: a policy's WITH CHECK is evaluated BEFORE table
--     constraints, so the `else false` branch of the membership CASE rejects it first. 6b
--     proves the CHECK is really there behind it — two independent gates, not one.
do $$
declare v record; s text;
begin
  select * into v from harness_ids;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v.member_id)::text, true);
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.member_id, 'not_a_chat_table', v.league_id, now());
    reset role;
    insert into harness_results values (6, 'unknown source_table (as client)', 'REJECTED 42501 by RLS', 'INSERT SUCCEEDED', '-', false);
  exception when others then
    s := sqlstate;
    reset role;
    insert into harness_results values (6, 'unknown source_table (as client)', 'REJECTED 42501 by RLS',
      'rejected: ' || sqlerrm, s, s = '42501');
  end;
end $$;

-- 6b. The CHECK constraint itself, exercised with RLS out of the picture (the session role
--     bypasses RLS) — so a service-role write can't store a bogus source_table either.
do $$
declare v record; s text;
begin
  select * into v from harness_ids;
  begin
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.member_id, 'not_a_chat_table', v.league_id, now());
    insert into harness_results values (7, 'unknown source_table (RLS bypassed)', 'REJECTED 23514 by CHECK', 'INSERT SUCCEEDED', '-', false);
  exception when others then
    s := sqlstate;
    insert into harness_results values (7, 'unknown source_table (RLS bypassed)', 'REJECTED 23514 by CHECK',
      'rejected: ' || sqlerrm, s, s = '23514');
  end;
end $$;

-- 8. The upsert the client actually issues is idempotent and advances last_read_at
--    (this is the ON CONFLICT path the UPDATE policy has to permit).
do $$
declare v record; n int; t timestamptz; s text;
begin
  select * into v from harness_ids;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v.member_id)::text, true);
    insert into chat_reads (user_id, source_table, entity_id, last_read_at)
    values (v.member_id, 'league_messages', v.league_id, now() + interval '1 minute')
    on conflict (user_id, source_table, entity_id)
    do update set last_read_at = excluded.last_read_at;
    select count(*), max(last_read_at) into n, t from chat_reads;
    reset role;
    insert into harness_results values (8, 'upsert advances, no duplicate row', '1 row, advanced',
      n || ' row(s), last_read_at ' || case when t > now() then 'advanced' else 'NOT advanced' end,
      '-', n = 1 and t > now());
  exception when others then
    s := sqlstate;
    reset role;
    insert into harness_results values (8, 'upsert advances, no duplicate row', '1 row, advanced',
      'REJECTED: ' || sqlerrm, s, false);
  end;
end $$;

select seq, check_name, expected, actual, sqlstate,
       case when pass then 'PASS' else 'FAIL' end as result
from harness_results order by seq;

rollback;
