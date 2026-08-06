-- Rollback for the 2026-08-06 owner-directed hold on the 9 colorado-springs-2026-08-03 rows
-- that the ADR-16/17 gate loosening would otherwise have released.
--
-- WHAT WAS DONE
-- All 9 were set facility_candidates.research_status = 'held'. `held` is one of the four
-- verdicts the publish gate still blocks on (duplicate / not_venue / not_pickleball / held),
-- so this is the only lever that keeps them down through a FUTURE gate change. Leaving them
-- at 'probable' would mean the next ADR that loosens the gate republishes them silently —
-- which is exactly how they came to be releasable in the first place.
--
-- NOTHING WAS DELETED and no listing row was touched: all 9 listings were already
-- status='draft' and remain so. This changes a review verdict, not data.
--
-- WHY THEY WERE HELD (2026-08-06 audit + this session's re-research):
--   5 rest solely on pppall.net/Outdoor, one club page: banning-lewis-ranch, glen-park,
--     wasson-high-school, westmoor-park, wildflower-park
--   1 rests on an OSM way as its IDENTITY source, and a DIFFERENT OSM object than its
--     coordinate came from: cheyenne-mountain-country-club — whose name designates no
--     entity (the venue is The Country Club of Colorado at Cheyenne Mountain Resort)
--   2 cite coloradosprings.gov/parks/page/tennis-and-pickleball, a tier-1 municipal page
--     that DOES NOT NAME THEM: bonforte-park, portal-park
--   1 is genuinely well-sourced and was held only on coordinate precision:
--     springs-pickleball-west (operator springspickleball.com)
--
-- DO NOT BLANKET-REVERSE THIS. The rescue found real controlling-entity sources for several
-- of these, but FINDING a source is not APPLYING one — every row below still carries its old
-- name_source_url in the database. Releasing a row without first writing its new source
-- publishes it on precisely the evidence that held it. Release is per-row, and each release
-- belongs with the keyed UPDATE that re-sources that row.

begin;

-- Per-row release template — run ONLY for a row whose source has actually been rewritten.
--   update facility_candidates set research_status = '<prior>', updated_at = now()
--   where id = '<id>';
-- Prior values are recorded per row below.

update facility_candidates set research_status = 'probable' where id = '5085e7de-1348-4db8-a194-3afe6975d9f9'; -- banning-lewis-ranch
update facility_candidates set research_status = 'probable' where id = '738f5c20-8cf7-493f-bf6c-4a72013ce6d1'; -- bonforte-park
update facility_candidates set research_status = 'probable' where id = 'ca3b7a1f-5465-488b-8a38-21b2c1a84721'; -- cheyenne-mountain-country-club
update facility_candidates set research_status = 'probable' where id = '029905b8-a7b3-4886-b701-c08a7abf408b'; -- glen-park
update facility_candidates set research_status = 'probable' where id = 'f215b478-a6f1-43d9-aebf-83a8ac25061e'; -- portal-park
update facility_candidates set research_status = 'probable' where id = '8806ec5b-258a-487c-bb39-fa1a82a89759'; -- wasson-high-school
update facility_candidates set research_status = 'probable' where id = 'be5253b9-458c-43b7-a096-e4d1e9d77281'; -- westmoor-park
update facility_candidates set research_status = 'probable' where id = 'f0834db3-f6a9-4097-b566-927a98a2c623'; -- wildflower-park
update facility_candidates set research_status = 'verified' where id = '7a051a21-b46a-48d9-999b-0c174c2940c1'; -- springs-pickleball-west (NOTE: was 'verified', not 'probable')

commit;

-- Releasing a row also needs the listing published and the cache busted — a research_status
-- change alone does nothing to the live site:
--   node scripts/import-metro-merged.mjs --metro=colorado-springs --stage=publish --dry-run
--   node scripts/lib/revalidate-directory.mjs --metro="Colorado Springs"
-- and note that running the old batch's publish stage releases EVERY eligible row in it, not
-- just the one you meant — check the dry run's ELIGIBLE list before applying.
