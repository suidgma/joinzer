-- APPLIED 2026-08-07. Both blocks were dry-run first (all assertions passed, rolled back), then
-- committed with joinzer.apply=yes. Verified after the fact by a separate read: both rows are
-- status=published, location_precision=high, provenance still 24 top-level keys, verified_by
-- unchanged at syracuse-v3-2026-08-06.
--
-- Executed through the Supabase MCP, which meant the RAISE messages were abbreviated relative to the
-- text below; the UPDATE statements and their jsonb payloads are byte-identical to what ran.
--
-- ROLLBACK is at the foot of this file.
--
-- Syracuse long-road repairs — 2026-08-07
--
-- WHY A TARGETED UPDATE AND NOT A RE-IMPORT. Both rows are PUBLISHED, so --stage=listings is doubly
-- unavailable (it INSERTs every non-reconcile artifact row unconditionally, and preflight aborts on
-- 'reconcile target is not draft') and --stage=publish only ever writes status/verified_at/verified_by.
-- Same shape as scripts/sql/adventhealth-coordinate-repair-2026-08-06.sql.
--
-- THE COORDINATES ARE NOT HAND-TYPED. Both nodes were produced by the pipeline's own
-- venue_facts.<key>.coordinate adoption (scripts/metros/syracuse.json), resolved live through
-- Nominatim /lookup, classified by the untouched classifyPrecision, and passed through the
-- street-band fallback guard added in this branch. This file is GENERATED from the resulting artifact
-- and projected through the importer's own field list, so the stored node has the shape a normal
-- import would have written.
--
-- WHAT MOVES: lat, lng, provenance.coordinate. Nothing else. location_precision is a generated column
-- off provenance->'coordinate'->>'precision', so it follows to 'high' with no DDL.
--
-- RE-RUN SAFETY: each WHERE pins the OLD coordinate, so a second execution matches 0 rows and the
-- ROW_COUNT assertion fails loudly rather than double-applying.
--
-- DRY RUN BY DEFAULT. To apply, in the SAME call ahead of these blocks:
--     select set_config('joinzer.apply', 'yes', false);

-- =======================================================================================
-- Skyway Park (skyway-park-north-syracuse-ny)
--   superseded : low 43.1228399,-76.1386095 — highway/secondary way/343907770 "East Taft Road" (query rung: address)
--   adopted    : high 43.1240954,-76.1105948 — leisure/park way/336908450 "Skyway Park" (query rung: osm-feature-lookup)
--   guard      : street-band-fallback — 2280 m from the band (the 1000 m
--                anchor guard does NOT apply: it would measure from the error being repaired),
--                inside the envelope, 2326 m from the zip locus (limit 5000 m)
--   crosscheck : 0 m against the adjudicated point
-- =======================================================================================
do $$
declare
  v_apply  boolean := coalesce(current_setting('joinzer.apply', true), 'no') = 'yes';
  v_id     uuid    := '9b1a4d8c-a5d2-4371-9b7a-0346c48973be';
  v_rows   integer;
  v_before jsonb;
  v_after  jsonb;
begin
  select to_jsonb(t) into v_before from (
    select lat, lng, location_precision, status,
           provenance->'coordinate' as coordinate,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'BEFORE skyway-park-north-syracuse-ny: %', v_before;

  update public.facility_listings
     set lat = 43.1240954,
         lng = -76.1105948,
         provenance = jsonb_set(provenance, '{coordinate}', $json${"lat":43.1240954,"lng":-76.1105948,"precision":"high","source_url":"https://nominatim.openstreetmap.org/","origin":"nominatim","anchor":"leisure/park way/336908450 \"Skyway Park\" (query rung: osm-feature-lookup)","matched_rung":"osm-feature-lookup","workbook_crosscheck":null,"shared_anchor_with":null,"name_anchor":null,"address_override":null,"adopted_from":{"osm_id":"way/336908450","osm_feature_name":"Skyway Park","evidence_url":"https://www.openstreetmap.org/way/336908450","reason":"OSM carries the venue itself as leisure/park way/336908450 \"Skyway Park\", containing four sport=pickleball pitches (way/1416783511-14). The query ladder cannot reach it: OSM has no house number 5950 on East Taft Road, so every address rung falls back to the East Taft Road centreline 2,283 m away and classifies low. The superseded anchor is therefore a STREET BAND — Nominatim matched the right road NAME and returned the wrong SEGMENT — which is why the 1000 m anchor guard does not apply and the envelope + zip-locus fence does.","adjudicated_by":"feature-builder","adjudicated_on":"2026-08-07","expect_lat":43.1240954,"expect_lng":-76.1105948,"crosscheck_delta_m":0,"moved_m":2280,"anchor_guard":{"guard":"street-band-fallback","reason":"the superseded anchor is a street band, so distance from it measures the error being repaired rather than the correctness of the adoption","superseded_band_distance_m":2280,"envelope":"inside","locus_kind":"zip","locus_lat":43.1290217,"locus_lng":-76.1384156,"locus_distance_m":2326,"limit_m":5000,"ordinary_anchor_limit_m":1000},"superseded":{"lat":43.1228399,"lng":-76.1386095,"precision":"low","anchor":"highway/secondary way/343907770 \"East Taft Road\" (query rung: address)"},"superseded_was_street_band":"STREET-BAND ANCHOR — Nominatim matched the street and returned a ROAD, so the crosshair is on a centreline by construction. The crop shows a road because the pin is on one. Note that a road has a length: matching the right road name says nothing about which SEGMENT came back, and the two Syracuse repairs landed 2,280 m and 2,532 m from their venues on correctly-named roads. This pin needs a real anchor: a house number, or an adjudicated OSM feature.","reconcile_target_osm_id":null,"matches_reconcile_target":null,"licence":"Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright"}}$json$::jsonb, true)
   where id = v_id
     and status = 'published'
     and lat = 43.1228399
     and lng = -76.1386095
     and provenance->'coordinate'->>'precision' = 'low';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ABORT skyway-park-north-syracuse-ny: expected exactly 1 row, updated %. Either the repair already applied (re-run) or the row drifted since this was written.', v_rows;
  end if;

  select to_jsonb(t) into v_after from (
    select lat, lng, location_precision,
           provenance->'coordinate'->>'precision' as prov_precision,
           provenance->'coordinate'->'adopted_from'->>'osm_id' as adopted_osm_id,
           provenance->'coordinate'->'adopted_from'->'anchor_guard'->>'guard' as guard,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'AFTER  skyway-park-north-syracuse-ny: %', v_after;

  if (v_before->>'provenance_key_count')::int <> (v_after->>'provenance_key_count')::int then
    raise exception 'ABORT skyway-park-north-syracuse-ny: provenance went from % top-level keys to % — the merge replaced instead of merging.',
      v_before->>'provenance_key_count', v_after->>'provenance_key_count';
  end if;
  if v_after->>'location_precision' <> 'high' then
    raise exception 'ABORT skyway-park-north-syracuse-ny: location_precision is %, expected high — the ADR-16 label would still render.', v_after->>'location_precision';
  end if;
  if v_after->>'guard' <> 'street-band-fallback' then
    raise exception 'ABORT skyway-park-north-syracuse-ny: anchor_guard.guard is %, expected street-band-fallback.', v_after->>'guard';
  end if;

  if not v_apply then
    raise exception 'DRY RUN skyway-park-north-syracuse-ny — all assertions passed, rolling back. Set joinzer.apply=yes to commit.';
  end if;
  raise notice 'APPLIED skyway-park-north-syracuse-ny.';
end
$$;

-- =======================================================================================
-- Van Buren Central Park (van-buren-central-park-baldwinsville-ny)
--   superseded : low 43.1481919,-76.3347359 — highway/tertiary way/319184723 "Canton Street" (query rung: address)
--   adopted    : high 43.1256814,-76.3302582 — leisure/park way/419320185 "Van Buren Central Park" (query rung: osm-feature-lookup)
--   guard      : street-band-fallback — 2532 m from the band (the 1000 m
--                anchor guard does NOT apply: it would measure from the error being repaired),
--                inside the envelope, 4146 m from the zip locus (limit 5000 m)
--   crosscheck : 0 m against the adjudicated point
-- =======================================================================================
do $$
declare
  v_apply  boolean := coalesce(current_setting('joinzer.apply', true), 'no') = 'yes';
  v_id     uuid    := '4cae540f-a76c-47d2-876b-599a7dc0ec1d';
  v_rows   integer;
  v_before jsonb;
  v_after  jsonb;
begin
  select to_jsonb(t) into v_before from (
    select lat, lng, location_precision, status,
           provenance->'coordinate' as coordinate,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'BEFORE van-buren-central-park-baldwinsville-ny: %', v_before;

  update public.facility_listings
     set lat = 43.1256814,
         lng = -76.3302582,
         provenance = jsonb_set(provenance, '{coordinate}', $json${"lat":43.1256814,"lng":-76.3302582,"precision":"high","source_url":"https://nominatim.openstreetmap.org/","origin":"nominatim","anchor":"leisure/park way/419320185 \"Van Buren Central Park\" (query rung: osm-feature-lookup)","matched_rung":"osm-feature-lookup","workbook_crosscheck":null,"shared_anchor_with":null,"name_anchor":null,"address_override":null,"adopted_from":{"osm_id":"way/419320185","osm_feature_name":"Van Buren Central Park","evidence_url":"https://www.openstreetmap.org/way/419320185","reason":"OSM carries the venue itself as leisure/park way/419320185 \"Van Buren Central Park\", with two sport=pickleball pitches (way/1503982599, way/1503982600) inside its recreation_ground. The query ladder cannot reach it: OSM has no house number 7350 on Canton Street, so every address rung falls back to the Canton Street centreline 2,529 m away and classifies low. The superseded anchor is a STREET BAND, so the adoption is fenced by the metro envelope and the venue's 13027 zip locus rather than by distance from the road.","adjudicated_by":"feature-builder","adjudicated_on":"2026-08-07","expect_lat":43.1256814,"expect_lng":-76.3302582,"crosscheck_delta_m":0,"moved_m":2532,"anchor_guard":{"guard":"street-band-fallback","reason":"the superseded anchor is a street band, so distance from it measures the error being repaired rather than the correctness of the adoption","superseded_band_distance_m":2532,"envelope":"inside","locus_kind":"zip","locus_lat":43.1622685,"locus_lng":-76.320708,"locus_distance_m":4146,"limit_m":5000,"ordinary_anchor_limit_m":1000},"superseded":{"lat":43.1481919,"lng":-76.3347359,"precision":"low","anchor":"highway/tertiary way/319184723 \"Canton Street\" (query rung: address)"},"superseded_was_street_band":"STREET-BAND ANCHOR — Nominatim matched the street and returned a ROAD, so the crosshair is on a centreline by construction. The crop shows a road because the pin is on one. Note that a road has a length: matching the right road name says nothing about which SEGMENT came back, and the two Syracuse repairs landed 2,280 m and 2,532 m from their venues on correctly-named roads. This pin needs a real anchor: a house number, or an adjudicated OSM feature.","reconcile_target_osm_id":null,"matches_reconcile_target":null,"licence":"Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright"}}$json$::jsonb, true)
   where id = v_id
     and status = 'published'
     and lat = 43.1481919
     and lng = -76.3347359
     and provenance->'coordinate'->>'precision' = 'low';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ABORT van-buren-central-park-baldwinsville-ny: expected exactly 1 row, updated %. Either the repair already applied (re-run) or the row drifted since this was written.', v_rows;
  end if;

  select to_jsonb(t) into v_after from (
    select lat, lng, location_precision,
           provenance->'coordinate'->>'precision' as prov_precision,
           provenance->'coordinate'->'adopted_from'->>'osm_id' as adopted_osm_id,
           provenance->'coordinate'->'adopted_from'->'anchor_guard'->>'guard' as guard,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'AFTER  van-buren-central-park-baldwinsville-ny: %', v_after;

  if (v_before->>'provenance_key_count')::int <> (v_after->>'provenance_key_count')::int then
    raise exception 'ABORT van-buren-central-park-baldwinsville-ny: provenance went from % top-level keys to % — the merge replaced instead of merging.',
      v_before->>'provenance_key_count', v_after->>'provenance_key_count';
  end if;
  if v_after->>'location_precision' <> 'high' then
    raise exception 'ABORT van-buren-central-park-baldwinsville-ny: location_precision is %, expected high — the ADR-16 label would still render.', v_after->>'location_precision';
  end if;
  if v_after->>'guard' <> 'street-band-fallback' then
    raise exception 'ABORT van-buren-central-park-baldwinsville-ny: anchor_guard.guard is %, expected street-band-fallback.', v_after->>'guard';
  end if;

  if not v_apply then
    raise exception 'DRY RUN van-buren-central-park-baldwinsville-ny — all assertions passed, rolling back. Set joinzer.apply=yes to commit.';
  end if;
  raise notice 'APPLIED van-buren-central-park-baldwinsville-ny.';
end
$$;

-- ===========================================================================================
-- ROLLBACK — restores both rows to their street bands. Dry run by default, same convention.
--
-- The superseded coordinate is not reconstructed from memory: it is read back out of
-- provenance.coordinate.adopted_from.superseded, which the adoption wrote onto the row for
-- exactly this purpose.
-- ===========================================================================================
-- do $$
-- declare
--   v_apply boolean := coalesce(current_setting('joinzer.apply', true), 'no') = 'yes';
--   r record;
--   n int := 0;
-- begin
--   for r in
--     select id, slug,
--            (provenance->'coordinate'->'adopted_from'->'superseded'->>'lat')::float8 as lat,
--            (provenance->'coordinate'->'adopted_from'->'superseded'->>'lng')::float8 as lng,
--            provenance->'coordinate'->'adopted_from'->'superseded'->>'precision' as precision,
--            provenance->'coordinate'->'adopted_from'->'superseded'->>'anchor'    as anchor
--       from public.facility_listings
--      where slug in ('skyway-park-north-syracuse-ny','van-buren-central-park-baldwinsville-ny')
--        and provenance->'coordinate'->'adopted_from'->'anchor_guard'->>'guard' = 'street-band-fallback'
--   loop
--     update public.facility_listings
--        set lat = r.lat, lng = r.lng,
--            provenance = jsonb_set(provenance, '{coordinate}',
--              (provenance->'coordinate') - 'adopted_from'
--                || jsonb_build_object('lat', r.lat, 'lng', r.lng, 'precision', r.precision,
--                                      'anchor', r.anchor, 'matched_rung', 'address'),
--              true)
--      where id = r.id;
--     n := n + 1;
--   end loop;
--   if n <> 2 then raise exception 'ROLLBACK matched % rows, expected 2', n; end if;
--   if not v_apply then raise exception 'DRY RUN rollback - rolling back.'; end if;
-- end $$;
