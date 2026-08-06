-- AdventHealth Pickleball Complex at Central Winds Park - adopt the courts' own OSM coordinate.
--
-- WHY A TARGETED UPDATE AND NOT A RE-IMPORT. The row is PUBLISHED, so --stage=listings is doubly
-- unavailable: it INSERTs every non-reconcile artifact row unconditionally (97 duplicates), and
-- preflight aborts first on 'reconcile target is not draft'. --stage=publish only ever writes
-- status/verified_at/verified_by and cannot touch a coordinate. So this is the one shape left.
--
-- WHAT MOVES: lat, lng, and provenance.coordinate. Nothing else. The generated column
-- location_precision derives from provenance->'coordinate'->>'precision', so it follows to 'high'
-- and the ADR-16 approximate-location label stops rendering, with no DDL.
--
-- PROVENANCE IS MERGED, NEVER REPLACED. jsonb_set rewrites exactly the 'coordinate' key and leaves
-- the other 24 top-level keys untouched - osm_reconcile above all, whose osm_original is the record
-- that made this repair possible in the first place. Overwriting provenance wholesale (which the
-- reconcile UPDATE path does) would destroy it.
--
-- THE COORDINATE IS NOT osm_original. It is what Nominatim /lookup returns for way/1165951096 today,
-- carried through the pipeline's own venue_facts.coordinate adoption. The two differ by 34.6 m: the
-- stored row holds the OSM ingest's centroid, Nominatim computes its own. Writing osm_original back
-- would be adopting a snapshot instead of the source, which is the shortcut the adoption mechanism
-- exists to make unnecessary.
--
-- RE-RUN SAFETY: the WHERE clause pins the OLD coordinate, so a second execution matches 0 rows and
-- the ROW_COUNT assertion fails loudly rather than double-applying.
--
-- DRY RUN BY DEFAULT. Executes as-is, asserts, then RAISEs so the transaction rolls back. To apply:
--     select set_config('joinzer.apply', 'yes', false);
--   in the SAME call, ahead of this block.
do $$
declare
  v_apply    boolean := coalesce(current_setting('joinzer.apply', true), 'no') = 'yes';
  v_id       uuid    := '598e3a09-67fe-4260-b1a4-8f67e56907cf';
  v_rows     integer;
  v_before   jsonb;
  v_after    jsonb;
begin
  select to_jsonb(t) into v_before from (
    select lat, lng, location_precision, status, updated_at,
           provenance->'coordinate' as coordinate,
           provenance->'osm_reconcile'->'osm_original' as osm_original,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'BEFORE: %', v_before;

  update public.facility_listings
     set lat = 28.7075117,
         lng = -81.2750142,
         provenance = jsonb_set(provenance, '{coordinate}', $json${"lat":28.7075117,"lng":-81.2750142,"precision":"high","source_url":"https://nominatim.openstreetmap.org/","origin":"nominatim","anchor":"leisure/pitch way/1165951096 \"Central Winds Pickleball Courts\", house number 1000 (query rung: osm-feature-lookup)","matched_rung":"osm-feature-lookup","workbook_crosscheck":null,"shared_anchor_with":null,"name_anchor":null,"address_override":null,"adopted_from":{"osm_id":"way/1165951096","osm_feature_name":"Central Winds Pickleball Courts","evidence_url":"https://www.openstreetmap.org/way/1165951096","reason":"OSM carries the courts themselves as leisure/pitch way/1165951096 'Central Winds Pickleball Courts' at the venue's own house number 1000 - the same feature this row reconciles onto. The query ladder cannot reach it: OSM has no house number on Central Winds Parkway and no feature under the AdventHealth name, so every rung falls back to the street centerline 407 m away and classifies low. The row therefore published a 14-court flagship on a street band wearing an ADR-16 approximate-location label, while the accurate pin sat in provenance.osm_reconcile.osm_original.","adjudicated_by":"feature-builder","adjudicated_on":"2026-08-06","expect_lat":28.7075117,"expect_lng":-81.2750142,"crosscheck_delta_m":0,"moved_m":407,"superseded":{"lat":28.7073709,"lng":-81.2708528,"precision":"low","anchor":"highway/residential way/645260772 \"Central Winds Parkway\" (query rung: structured)"},"reconcile_target_osm_id":"way/1165951096","matches_reconcile_target":true,"licence":"Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright"}}$json$::jsonb, true)
   where id = v_id
     and status = 'published'
     and lat = 28.7073709
     and lng = -81.2708528
     and provenance->'coordinate'->>'precision' = 'low';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ABORT: expected exactly 1 row, updated %. Either the row already carries the new coordinate (re-run) or it has drifted since this was written.', v_rows;
  end if;

  select to_jsonb(t) into v_after from (
    select lat, lng, location_precision,
           provenance->'coordinate'->>'precision'      as prov_precision,
           provenance->'coordinate'->'adopted_from'->>'osm_id' as adopted_osm_id,
           provenance->'osm_reconcile'->'osm_original' as osm_original,
           (select count(*) from jsonb_object_keys(provenance)) as provenance_key_count
    from public.facility_listings where id = v_id
  ) t;
  raise notice 'AFTER : %', v_after;

  -- The merge is the highest-risk part of this write, so it is ASSERTED rather than inspected.
  if v_after->>'osm_original' is null then
    raise exception 'ABORT: provenance.osm_reconcile.osm_original was destroyed - the merge replaced instead of merging.';
  end if;
  if (v_before->>'provenance_key_count')::int <> (v_after->>'provenance_key_count')::int then
    raise exception 'ABORT: provenance went from % top-level keys to % - keys were lost.',
      v_before->>'provenance_key_count', v_after->>'provenance_key_count';
  end if;
  if v_after->>'location_precision' <> 'high' then
    raise exception 'ABORT: location_precision is %, expected high - the ADR-16 label would still render.', v_after->>'location_precision';
  end if;

  if not v_apply then
    raise exception 'DRY RUN - all assertions passed, rolling back. Set joinzer.apply=yes to commit.';
  end if;
  raise notice 'APPLIED.';
end
$$;
