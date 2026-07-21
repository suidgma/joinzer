-- Directory Session 3d-1 — provenance fields on facility_listings.
-- The Session-3d pipeline verifies name/address/facts from PRIMARY sources (venue site, city
-- parks & rec, county open data) and stores them permanently with provenance. Google Places data
-- beyond place_id (already the `google_place_id` column) is never persisted — these columns hold
-- the verified-by-a-human trail, not Places response fields.
--
-- Purely additive, nullable, no constraint changes (access_type already allows 'hoa'; status stays
-- draft/published). Applied before the dependent import code (3d-5), per ADR-10.

alter table public.facility_listings
  add column if not exists name_source_url text,        -- primary-source URL verifying name/address/facts (publish gate will require it)
  add column if not exists verified_at     timestamptz, -- human sign-off timestamp from the review pass
  add column if not exists verified_by     text,        -- who approved (review pass 1/2)
  add column if not exists provenance      jsonb;       -- { discovered_by:[existing|places|osm], place_id, osm_cluster_ids:[], classifier:{model,type,access_type,confidence,at} }
