-- ============================================================================
-- seed-dummy-players.sql — reusable dummy-account generator (for tournament testing)
-- ============================================================================
--
-- WHAT IT DOES
--   Tops the `profiles` table up to a target number of dummy players, creating a
--   matching auth.users + auth.identities + profiles row for each one. Every
--   dummy gets a UNIQUE first name and UNIQUE last name (gender-aligned), DUPR
--   spread evenly across 2.5–5.0, and the standard dummy formatting:
--       profiles.name   = '.First Last'            (leading dot sorts them together)
--       profiles.email  = first.last@dummy.invalid (non-deliverable, clearly fake)
--       auth.users.email = first.last@{gmail|outlook|yahoo}.com
--       dummy = true, is_stub = true, rating_source = 'estimated', joinzer_rating = 1000
--   All dummies share the login password set in v_password below.
--
-- HOW TO RUN
--   This is NOT a migration (it must not auto-run on deploy). Run it manually:
--     • Supabase Dashboard → SQL Editor → paste & Run, or
--     • psql "$DATABASE_URL" -f supabase/seed-dummy-players.sql
--   Edit v_target, then run. It only ADDS the difference (idempotent top-up):
--   re-running with the same target is a no-op.
--
-- SCALE / LIMITS
--   Because each first name and last name must be unique, the ceiling is the pool
--   size: 75 male + 75 female first names and 150 last names => up to 150 dummies.
--   Need more? Add names to v_male_first / v_female_first / v_last below (keep them
--   distinct, and keep last names disjoint from first names). Names already used by
--   existing dummies are skipped automatically, so extending + re-running is safe.
--
-- CLEAN UP (remove ALL dummies — cascades to profiles + identities)
--   delete from auth.users u
--   using public.profiles p
--   where p.id = u.id and p.dummy;
-- ============================================================================

do $$
declare
  -- ---- CONFIG (edit these) -------------------------------------------------
  v_target   int  := 100;                  -- desired TOTAL number of dummy accounts
  v_password text := 'JoinzerDummy2026!';  -- shared login password for every dummy

  v_male_first text[] := array[
    'Liam','Ethan','Mason','Logan','Caleb','Dylan','Tyler','Aiden','Hunter','Cole',
    'Wyatt','Carter','Jack','Levi','Miles','Adrian','Brody','Cameron','Damian','Elliot',
    'Finn','Grant','Harvey','Ian','Joel','Keith','Leo','Mitchell','Nash','Oscar',
    'Preston','Quentin','Reid','Spencer','Trevor','Victor','Wesley','Xavier','Zane','Bryce',
    'Colin','Devin','Emmett','Garrett','Heath','Jasper','Knox','Lance','Marshall','Sawyer',
    'Tristan','Asher','Beckett','Chase','Dean','Eli','Gideon','Hugo','Isaiah','Jonah',
    'Kai','Landon','Micah','Nathaniel','Roman','Silas','Theo','Wade','Zachary','Cody',
    'Drew','Gage','Jared','Kent','Troy'];

  v_female_first text[] := array[
    'Ava','Mia','Ella','Aria','Layla','Riley','Nova','Hazel','Aurora','Stella',
    'Violet','Paisley','Skylar','Naomi','Eliana','Quinn','Ruby','Sadie','Talia','Vera',
    'Willow','Ximena','Yara','Zara','Brooke','Cora','Daphne','Esme','Faith','Genevieve',
    'Harper','Ivy','June','Kira','Lana','Mabel','Nadia','Ophelia','Priya','Renata',
    'Selena','Tessa','Uma','Valeria','Wren','Yvonne','Zoey','Camila','Delia','Amara',
    'Bella','Clara','Demi','Edith','Freya','Greta','Hana','Imani','Joelle','Kaia',
    'Leah','Maeve','Nina','Odette','Phoebe','Rosa','Sienna','Thea','Veda','Winnie',
    'Xiomara','Yuki','Zelda','Margot','Noelle'];

  v_last text[] := array[
    'Adkins','Bishop','Bowen','Bradley','Brennan','Bryant','Burgess','Cabrera','Cannon','Carlson',
    'Carpenter','Carver','Chandler','Christensen','Clarke','Clayton','Coleman','Collier','Collins','Crawford',
    'Cross','Cummings','Dalton','Daniels','Davidson','Dawson','Donovan','Drake','Dudley','Dunn',
    'Eaton','Estrada','Emerson','Erickson','Farmer','Ferguson','Fields','Fletcher','Flynn','Frost',
    'Gardner','Gibson','Gilbert','Glover','Goodwin','Greene','Griffith','Hale','Hamilton','Hardy',
    'Hayes','Hendricks','Higgins','Hodges','Hooper','Horton','Hudson','Hughes','Jacobs','Jensen',
    'Joyce','Kelly','Kemp','Kennedy','Lane','Larson','Lawson','Leonard','Lloyd','Lowe',
    'Lyons','Maddox','Marsh','Maxwell','McBride','Mendez','Merritt','Mercer','Monroe','Mooney',
    'Moran','Mullins','Newton','Norris','Osborne','Padilla','Pearson','Perkins','Pierce','Porter',
    'Ramsey','Reyes','Roach','Sampson','Schwartz','Sexton','Sharpe','Sherman','Sloan','Sutton',
    'Abernathy','Atwood','Beck','Blackwell','Boone','Calloway','Carmichael','Conner','Dorsey','Easton',
    'Ellison','Esparza','Fenton','Galloway','Garrison','Hatcher','Holt','Irving','Jamison','Kingston',
    'Langley','Ledford','Mayfield','McConnell','Mercado','Nava','Ogden','Pruitt','Quimby','Radford',
    'Redmond','Sanford','Stafford','Thornton','Underwood','Vance','Vaughn','Waller','Whitaker','Yates',
    'Zimmerman','Ashby','Barrett','Crowley','Driscoll','Ferris','Granger','Hollis','Lockhart','Tatum'];

  v_domains text[]   := array['gmail.com','outlook.com','yahoo.com'];
  v_skill   numeric[] := array[2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  -- --------------------------------------------------------------------------

  v_current int;
  v_to_add  int;
  v_add_f   int;
  v_add_m   int;
  v_avail_m text[];
  v_avail_f text[];
  v_avail_l text[];
begin
  -- Sanity guards on the pools.
  if (select count(*) <> count(distinct x) from unnest(v_male_first)   x)
  or (select count(*) <> count(distinct x) from unnest(v_female_first) x)
  or (select count(*) <> count(distinct x) from unnest(v_last)         x) then
    raise exception 'A name pool contains duplicates — every entry must be unique.';
  end if;
  if exists (
    select 1 from unnest(v_male_first || v_female_first) f
    join unnest(v_last) l on lower(f) = lower(l)
  ) then
    raise exception 'A name appears in both a first-name and last-name pool — keep them disjoint.';
  end if;

  select count(*) into v_current from public.profiles where dummy;
  v_to_add := greatest(0, v_target - v_current);

  if v_to_add = 0 then
    raise notice 'Already % dummy accounts (target %). Nothing to add.', v_current, v_target;
    return;
  end if;

  -- Split additions ~50/50 by gender (males take the odd one).
  v_add_f := v_to_add / 2;
  v_add_m := v_to_add - v_add_f;

  -- Names not already used by an existing dummy (keeps every first & last unique).
  select array_agg(fn order by ord) into v_avail_m
  from unnest(v_male_first) with ordinality t(fn, ord)
  where lower(fn) not in (select lower(split_part(ltrim(name,'.'),' ',1)) from public.profiles where dummy);

  select array_agg(fn order by ord) into v_avail_f
  from unnest(v_female_first) with ordinality t(fn, ord)
  where lower(fn) not in (select lower(split_part(ltrim(name,'.'),' ',1)) from public.profiles where dummy);

  select array_agg(ln order by ord) into v_avail_l
  from unnest(v_last) with ordinality t(ln, ord)
  where lower(ln) not in (select lower(split_part(ltrim(name,'.'),' ',2)) from public.profiles where dummy);

  -- Capacity checks with actionable messages.
  if coalesce(array_length(v_avail_m,1),0) < v_add_m then
    raise exception 'Need % more unused male first names, have %. Add more to v_male_first.',
      v_add_m, coalesce(array_length(v_avail_m,1),0);
  end if;
  if coalesce(array_length(v_avail_f,1),0) < v_add_f then
    raise exception 'Need % more unused female first names, have %. Add more to v_female_first.',
      v_add_f, coalesce(array_length(v_avail_f,1),0);
  end if;
  if coalesce(array_length(v_avail_l,1),0) < v_to_add then
    raise exception 'Need % more unused last names, have %. Add more to v_last.',
      v_to_add, coalesce(array_length(v_avail_l,1),0);
  end if;

  -- Diagonal pairing guarantees unique first + unique last. Build the rows, then
  -- insert auth.users + auth.identities + profiles in one statement (FK checks
  -- run at statement end, so insertion order across the CTEs is irrelevant).
  with picks as (
    select v_avail_m[i] as fn, v_avail_l[i] as ln, 'male'::text as gender, i as seq
    from generate_series(1, v_add_m) i
    union all
    select v_avail_f[i] as fn, v_avail_l[v_add_m + i] as ln, 'female'::text as gender, v_add_m + i as seq
    from generate_series(1, v_add_f) i
  ),
  prepared as materialized (
    select gen_random_uuid() as id, fn, ln, gender, seq,
      lower(fn || '.' || ln) as loc,
      v_domains[1 + ((seq - 1) % array_length(v_domains,1))] as dom,
      v_skill[1 + ((seq - 1) % array_length(v_skill,1))]    as dupr
    from picks
  ),
  ins_users as (
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      is_sso_user, is_anonymous
    )
    select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated',
      p.loc || '@' || p.dom, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb, now(), now(),
      '', '', '', '', false, false
    from prepared p
    returning id, email
  ),
  ins_ident as (
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', false, 'phone_verified', false),
      now(), now(), now()
    from ins_users u
    returning user_id
  )
  insert into public.profiles (
    id, name, email, gender, dupr_rating, estimated_rating, rating_source,
    joinzer_rating, dummy, is_stub, is_admin, email_visibility, phone_visibility, created_at
  )
  select p.id, '.' || p.fn || ' ' || p.ln, p.loc || '@dummy.invalid', p.gender, p.dupr, null, 'estimated',
    1000, true, true, false, 'self', 'self', now()
  from prepared p;

  raise notice 'Added % dummy accounts (% male, % female). Total dummies now %.',
    v_to_add, v_add_m, v_add_f, v_current + v_to_add;
end $$;
