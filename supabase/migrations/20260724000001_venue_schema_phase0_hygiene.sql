-- Directory — Venue schema Phase 0 (hygiene). Implements the hygiene half of ADR-13.
-- Formalizes out-of-band locations columns (lat/lng/sort_order were created in the dashboard, not in
-- any migration, so a rebuild-from-migrations would not reproduce production) and adds range/value
-- CHECKs that existing data already satisfies (validated against the live DB before writing — zero
-- violations). Purely additive: no drops, no renames, no data changes, all-nullable where new.
-- Phase 3 (enum reconciliation, promotion flow, deprecations) is a separate, later-approved package.

-- locations: formalize the dashboard-created columns so repo == production. Idempotent no-ops on the
-- live DB (they already exist); on a from-scratch rebuild they are created here.
alter table public.locations add column if not exists lat        double precision;
alter table public.locations add column if not exists lng        double precision;
alter table public.locations add column if not exists sort_order integer not null default 999; -- live default is 999

-- locations: coordinate-plausibility CHECKs mirroring facility_listings' _lat_chk/_lng_chk.
-- Validated: 0 of 65 rows violate (63 have coords, 2 are null — the CHECK allows null).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'locations_lat_chk' and conrelid = 'public.locations'::regclass) then
    alter table public.locations add constraint locations_lat_chk check (lat is null or lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_lng_chk' and conrelid = 'public.locations'::regclass) then
    alter table public.locations add constraint locations_lng_chk check (lng is null or lng between -180 and 180);
  end if;
end $$;

-- locations.metro_area: drop the misleading default 'Las Vegas' (keep the column AND its NOT NULL).
-- The LV default silently mislabels rows created for any other metro; new rows must set metro explicitly.
alter table public.locations alter column metro_area drop default;

-- facility_listings.surface: value CHECK. EXPANDED beyond the originally-recommended shortlist to
-- cover ALL 13 distinct values already present — raw OSM surface tags: concrete, asphalt, paved, hard,
-- hard_court, acrylic, tartan, ground, artificial_turf, rubber, grass, clay, ice — so zero existing
-- rows violate. sport_court/wood/other added for forward use. Normalizing the raw OSM values (e.g.
-- paved→asphalt, hard/hard_court→acrylic, clearly-mistagged ice/grass) is Phase-3 work, not hygiene.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'facility_listings_surface_chk' and conrelid = 'public.facility_listings'::regclass) then
    alter table public.facility_listings add constraint facility_listings_surface_chk
      check (surface is null or surface in (
        'concrete','asphalt','paved','hard','hard_court','acrylic','sport_court',
        'tartan','ground','artificial_turf','rubber','wood','grass','clay','ice','other'));
  end if;
end $$;

-- facility_listings.country: ISO-2 length guard. All 686 rows are 'US' (length 2) — validated.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'facility_listings_country_chk' and conrelid = 'public.facility_listings'::regclass) then
    alter table public.facility_listings add constraint facility_listings_country_chk
      check (country is null or char_length(country) = 2);
  end if;
end $$;

-- NOTE: facility_listings.source is intentionally left UNCONSTRAINED. It holds 'osm' plus open-ended
-- per-metro batch tags (e.g. 'az-review-2026-07'), one per metro run — a fixed IN-list would break
-- every future metro batch. Free-form by design (ADR-13).
