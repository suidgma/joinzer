-- Rollback for the Big House Pickleball retirement applied 2026-08-05
-- (Colorado Springs v3 session, owner-directed).
--
-- WHAT WAS DONE, AND WHY
-- Big House Pickleball (3785 Interpark Dr, Colorado Springs CO 80907) was live and
-- `published` with verification_status `source_verified`, citing its own operator site
-- https://thebighousepickleball.com/ as the source for name, access_type, fee_type,
-- court_count and pickleball_activity. That site is CLOSED, but says so only in an image:
-- it serves HTTP 200 with a full working navigation ("Become a Member", "Court
-- Reservations", "BOOK NOW", "Permanent Weekly Slots") and NO closure text anywhere in the
-- markup. The single closure signal is the hero graphic, whose filename is
-- "BHPB CLOSED.png". Every text-based check — ours and the 2026-08-03 import's — reads that
-- page as a healthy operating venue, which is exactly why this survived to production.
--
-- The row came from colorado-springs-addendum-2026-08-03, whose research artifact is
-- genuinely lost (unlike the main batch, which was recovered). It therefore CANNOT be
-- corrected by re-running its batch, and needed this direct keyed UPDATE.
--
-- NOTHING WAS DELETED. Two rows changed status and gained provenance; all facts,
-- coordinates and per-field sourcing are untouched and reversible by the statements below.
--
-- TO REVERSE, run both statements as one transaction.

begin;

-- 1. Restore the listing to published.
--    `provenance - 'retirement'` removes ONLY the key this retirement added, leaving the
--    original per-field provenance object byte-identical to its 2026-08-03 import state.
update facility_listings
set status       = 'published',
    provenance   = provenance - 'retirement',
    updated_at   = '2026-08-03 19:39:09.871173+00'
where id = '3235cd68-2876-4212-8214-1123f303a3f5'
  and slug = 'big-house-pickleball-colorado-springs-co';

-- 2. Restore the candidate row.
update facility_candidates
set research_status = 'published',
    reviewer_notes  = 'facts + full per-field provenance on facility_listings slug=big-house-pickleball-colorado-springs-co',
    reviewed_by     = 'colorado-springs-addendum-2026-08-03',
    updated_at      = '2026-08-03 19:39:10.016483+00'
where id = '75d081aa-75a6-4650-8567-a052eff021de'
  and candidate_key = 'big-house-pickleball-colorado-springs';

commit;

-- Verify the reversal:
--   select l.slug, l.status, c.research_status
--   from facility_listings l
--   join facility_candidates c on c.published_listing_id = l.id
--   where l.slug = 'big-house-pickleball-colorado-springs-co';
-- expect: published | published
--
-- DO NOT reverse this without re-checking the operator site first. If the hero graphic is
-- still BHPB CLOSED.png, the venue is still closed and republishing it puts a wrong fact
-- back on a public page.
