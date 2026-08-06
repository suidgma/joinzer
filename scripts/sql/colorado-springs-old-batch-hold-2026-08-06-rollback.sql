-- Rollback for the 2026-08-06 owner-directed hold on the colorado-springs-2026-08-03 rows.
-- ALL ELEVEN HELD ROWS ARE COVERED BY THIS ONE FILE — 9 locked in the first pass, plus the
-- 2 added later the same day. They are one decision and they roll back together; two separate
-- files would have made a partial reversal look complete.
--
-- WHAT WAS DONE
-- All 11 were set facility_candidates.research_status = 'held'. `held` is one of the four
-- verdicts the publish gate still blocks on (duplicate / not_venue / not_pickleball / held),
-- so this is the only lever that keeps them down through a FUTURE gate change. Leaving them
-- at 'probable' would mean the next ADR that loosens the gate republishes them silently —
-- which is exactly how they came to be releasable in the first place.
--
-- NOTHING WAS DELETED and no listing row was touched: all 11 listings were already
-- status='draft' and remain so. This changes a review verdict, not data.
--
-- ---------------------------------------------------------------------------------------------
-- PASS 1 (9 rows) — rows the ADR-16/17 gate loosening would otherwise have released
--
-- WHY THEY WERE HELD (2026-08-06 audit + that session's re-research):
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
-- ---------------------------------------------------------------------------------------------
-- PASS 2 (2 rows) — rows held ONLY by a missing coordinate, converted to a deliberate hold
--
-- These two were left at 'probable' in pass 1 because a NULL coordinate was already holding
-- them. That is the same "accident holding the line" pattern one layer down: a queued
-- cross-metro re-geocode pass would have supplied the coordinate and published both, because
-- a coordinate was the last thing standing between them and the gate.
--
--   windmill-mesa-park — a real venue (Widefield School District 3, 4610 Fencer Rd, 80911),
--     but its name_source_url is https://pppall.net/Outdoor: the SAME single club page that
--     holds five of the pass-1 rows. It belongs with those five, on the merits.
--   colorado-springs-pickleball-the-warehouse — name_source_url is a pickleheads.com
--     AGGREGATOR url, and the ADR-14 scan in import-metro-merged.mjs (~line 991) runs over
--     ELIGIBLE rows only. So a successful re-geocode would not merely publish a bad row, it
--     would ABORT THE ENTIRE COLORADO SPRINGS PUBLISH RUN after the other rows were already
--     classified. Its operator domain cspickleball.com now serves gambling/affiliate spam,
--     so the row has no citable source at all and cannot publish as it stands under any
--     reading. Releasing this one needs a new source, not a coordinate.
--
-- ---------------------------------------------------------------------------------------------
-- DO NOT BLANKET-REVERSE THIS. The rescue found real controlling-entity sources for several
-- of these, but FINDING a source is not APPLYING one — every row below still carries its old
-- name_source_url in the database. Releasing a row without first writing its new source
-- publishes it on precisely the evidence that held it. Release is per-row, and each release
-- belongs with the keyed UPDATE that re-sources that row.

begin;

-- Per-row release template — run ONLY for a row whose source has actually been rewritten.
--   update facility_candidates set research_status = '<prior>' where id = '<id>';
-- Prior values are recorded per row below. `updated_at` restamps itself via the
-- facility_candidates_updated_at BEFORE UPDATE trigger; do not set it by hand.

-- Pass 1 — 9 rows
update facility_candidates set research_status = 'probable' where id = '5085e7de-1348-4db8-a194-3afe6975d9f9'; -- banning-lewis-ranch
update facility_candidates set research_status = 'probable' where id = '738f5c20-8cf7-493f-bf6c-4a72013ce6d1'; -- bonforte-park
update facility_candidates set research_status = 'probable' where id = 'ca3b7a1f-5465-488b-8a38-21b2c1a84721'; -- cheyenne-mountain-country-club
update facility_candidates set research_status = 'probable' where id = '029905b8-a7b3-4886-b701-c08a7abf408b'; -- glen-park
update facility_candidates set research_status = 'probable' where id = 'f215b478-a6f1-43d9-aebf-83a8ac25061e'; -- portal-park
update facility_candidates set research_status = 'probable' where id = '8806ec5b-258a-487c-bb39-fa1a82a89759'; -- wasson-high-school
update facility_candidates set research_status = 'probable' where id = 'be5253b9-458c-43b7-a096-e4d1e9d77281'; -- westmoor-park
update facility_candidates set research_status = 'probable' where id = 'f0834db3-f6a9-4097-b566-927a98a2c623'; -- wildflower-park
update facility_candidates set research_status = 'verified' where id = '7a051a21-b46a-48d9-999b-0c174c2940c1'; -- springs-pickleball-west (NOTE: was 'verified', not 'probable')

-- Pass 2 — 2 rows. Prior reviewed_by is recorded here because pass 2 overwrote it; it was
-- verified as 'colorado-springs-2026-08-03' on both rows immediately before the write.
-- (Pass 1 also overwrote reviewed_by on its 9, but that session did not record the prior
-- value and it is NOT reconstructed here — restoring a value nobody verified would be a
-- guess wearing a rollback's clothes. Reverse those 9 by research_status only.)
update facility_candidates set research_status = 'probable', reviewed_by = 'colorado-springs-2026-08-03' where id = 'a61662c7-7388-4204-a86b-564d9130d9ba'; -- windmill-mesa-park
update facility_candidates set research_status = 'probable', reviewed_by = 'colorado-springs-2026-08-03' where id = '97d5e8de-89da-413f-b5c4-afbc220f7bc1'; -- colorado-springs-pickleball-the-warehouse

commit;

-- ---------------------------------------------------------------------------------------------
-- OPTIONAL: strip the appended rationale from reviewer_notes.
--
-- Both passes APPENDED to reviewer_notes rather than overwriting, each beginning with the
-- literal marker ' || HELD 2026-08-06'. Verified 2026-08-06: that marker occurs EXACTLY ONCE
-- on each of the 11 rows, so the split below is unambiguous and loses no original text.
-- Usually you do NOT want this — the note explains why the row was held, which stays true
-- and useful even after a release. Run it only if you are erasing the episode entirely.
--
--   update facility_candidates
--      set reviewer_notes = split_part(reviewer_notes, ' || HELD 2026-08-06', 1)
--    where batch = 'colorado-springs-2026-08-03'
--      and reviewer_notes like '%|| HELD 2026-08-06%';

-- ---------------------------------------------------------------------------------------------
-- Releasing a row also needs the listing published and the cache busted — a research_status
-- change alone does nothing to the live site:
--   node scripts/import-metro-merged.mjs --metro=colorado-springs --stage=publish --dry-run
--   node scripts/lib/revalidate-directory.mjs --metro="Colorado Springs"
-- and note that running the old batch's publish stage releases EVERY eligible row in it, not
-- just the one you meant — check the dry run's ELIGIBLE list before applying.
--
-- ALSO NOTE, before trusting a projection: --stage=project CANNOT SEE ANY OF THIS. It computes
-- the gate from the research ARTIFACT and opens no database connection (import-metro-merged.mjs
-- ~line 821-859), so every row above still reads 'probable'/'verified' there and project reports
-- 22/24 with 10 expected-split divergences. The expected_publish block in
-- scripts/metros/colorado-springs.json describes DATABASE state and is asserted correctly only
-- by --stage=publish (and --stage=verify), which read facility_candidates.research_status.
-- Do not "fix" that project divergence by editing the expectation.
