-- Directory — hygiene: formalize the out-of-band `address_source` column on facility_candidates.
-- Same drift class as facility_listings.address_source (20260724000007) and the earlier locations
-- lat/lng/sort_order. The column AND its CHECK exist in production but appear in no repo migration:
-- 20260724000003 created the table without them, and the migration that actually added them
-- (Supabase registry `20260725015722_address_source_provenance`, which patched BOTH tables) was
-- applied straight to the project and never committed here. So a rebuild-from-migrations reproduces
-- facility_listings.address_source but NOT the candidates one. Verified live 2026-07-28 against
-- pg_constraint + information_schema.columns + supabase_migrations.schema_migrations.
--
-- Idempotent and a no-op against the live DB. Zero data change. Mirrors the ADR-12 six-value
-- vocabulary exactly so candidates and listings can never drift apart on address provenance.
alter table public.facility_candidates add column if not exists address_source text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'facility_candidates_address_source_check' and conrelid = 'public.facility_candidates'::regclass) then
    alter table public.facility_candidates add constraint facility_candidates_address_source_check
      check (address_source is null or address_source in
        ('official_page','osm','county_open_data','manual_research','organizer','unknown_legacy'));
  end if;
end $$;

comment on column public.facility_candidates.address_source is
  'Compliant provenance of `address` (ADR-12 / GMP Places ToS), mirroring facility_listings.address_source. A Places formatted_address is NOT a valid source. Aggregator-sourced addresses file as `manual_research` (ADR-14). Values: official_page | osm | county_open_data | manual_research | organizer | unknown_legacy.';
