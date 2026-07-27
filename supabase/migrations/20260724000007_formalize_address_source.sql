-- Directory — Task A (ToS address remediation, ADR-12): formalize the out-of-band `address_source`
-- provenance column on facility_listings. It was created in the dashboard (in no migration — same
-- drift class as the earlier lat/lng/sort_order), so a rebuild-from-migrations wouldn't reproduce it.
-- Idempotent; matches the LIVE definition (the Jul-24 work-order proposal was superseded — the live
-- vocabulary already had 23 stamped rows). GMP Places ToS §3.2.3(a)-(b): a Places `formatted_address`
-- is NOT a storable source; addresses traceable only to Places are nulled + stamped `unknown_legacy`.
alter table public.facility_listings add column if not exists address_source     text;
alter table public.facility_listings add column if not exists address_verified_at timestamptz;

-- Pin address_source to the six canonical values so a seventh can't appear out-of-band the way this
-- column did — a new value is then a deliberate schema change, not a silent write.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'facility_listings_address_source_check' and conrelid = 'public.facility_listings'::regclass) then
    alter table public.facility_listings add constraint facility_listings_address_source_check
      check (address_source is null or address_source in
        ('official_page','osm','county_open_data','manual_research','organizer','unknown_legacy'));
  end if;
end $$;

comment on column public.facility_listings.address_source is
  'Compliant provenance of `address` (ADR-12 / GMP Places ToS). A Places formatted_address is NOT a valid source — such addresses are nulled + stamped `unknown_legacy`. Every future address write MUST set this. Values: official_page | osm | county_open_data | manual_research | organizer | unknown_legacy.';
