-- facility_listings.location_precision — surface the geocoder's precision to the render layer.
--
-- WHY A COLUMN AT ALL. The value already exists, at provenance.coordinate.precision. It is not
-- reachable from the directory pages because lib/directory/loadFacilities.ts deliberately does NOT
-- select `provenance` — that column carries tier-4 research source URLs and must never reach the
-- client (ADR-14; the loader says so in its own header comment). Widening the select to expose one
-- string would drag the whole evidence trail with it. This exposes exactly the one derived value.
--
-- WHY GENERATED RATHER THAN A PLAIN COLUMN + BACKFILL. Three properties, none of which a written
-- column has:
--   1. it cannot drift from provenance — there is no second write path to forget;
--   2. it needs no backfill step, so there is no partially-backfilled intermediate state;
--   3. no importer, reconcile path or future batch script has to remember to populate it.
-- `provenance -> 'coordinate' ->> 'precision'` is IMMUTABLE (jsonb access on a jsonb column), which
-- is what makes it legal in a STORED generated column.
--
-- LOCK COST, CHECKED NOT ASSUMED. Adding a STORED generated column rewrites the table and takes an
-- ACCESS EXCLUSIVE lock. facility_listings is 1,775 rows / 3,920 kB as of 2026-08-04, so this is
-- sub-second. That argument does NOT generalize — on a large table this would want a nullable plain
-- column plus a batched backfill instead.
--
-- ADDITIVE AND NON-DESTRUCTIVE: no drop, no delete, no rewrite of any existing value. Every row's
-- new column is derived from data that row already carries; rows with no coordinate node get NULL.
--
-- VALUES: 'high' | 'medium' | 'low' | NULL. NULL means "no coordinate node in provenance" — which is
-- NOT the same as 'low', and the publish gate treats them differently: a missing coordinate is still
-- a hold, while 'low' now publishes behind a user-visible approximate-location label (ADR-16).
-- Deliberately NOT constrained by a CHECK: the column is derived, so a CHECK here would be a
-- constraint on the geocoder's vocabulary enforced in the wrong place, and it would make any future
-- precision tier a migration rather than a code change.

alter table public.facility_listings
  add column if not exists location_precision text
  generated always as (provenance -> 'coordinate' ->> 'precision') stored;

comment on column public.facility_listings.location_precision is
  'Derived from provenance.coordinate.precision. high | medium | low | NULL (no coordinate node). Read by lib/directory/loadFacilities.ts so the venue pages can label a low-precision pin as approximate without exposing provenance to the client. Generated — never write to it directly.';

-- Partial index: every directory read filters status='published', and the low-precision rows are a
-- small minority (91 of ~993 published after ADR-16 lands). A partial index keeps it tiny and serves
-- the "which published rows are approximate" question the QA and reporting queries actually ask.
create index if not exists facility_listings_low_precision_published_idx
  on public.facility_listings (metro_area)
  where status = 'published' and location_precision = 'low';
