-- Session 1 (directory): greenfield facility_listings — nationwide court directory.
-- Real columns for SEO/queryable fields + a jsonb enrichment blob. RLS deny-all;
-- all access via service role in server code (ADR-03). locations stays untouched;
-- location_id is set only when a listing is "promoted" by a real event.
create table if not exists public.facility_listings (
  id                 uuid primary key default gen_random_uuid(),
  -- identity & ingest provenance
  osm_id             text unique,                       -- e.g. 'way/123456'; nullable (manual rows), unique
  source             text not null default 'osm',
  last_synced_at     timestamptz,
  -- queryable / SEO
  name               text not null,
  slug               text unique not null,              -- /courts/[slug]
  lat                double precision,
  lng                double precision,
  address            text,
  city               text,
  state              text,
  zip                text,
  country            text default 'US',
  metro_area         text,                              -- nullable; most of the US won't map
  court_count        integer,                           -- nullable; no fake default
  access_type        text default 'unknown'
                       check (access_type in ('public','private','membership','school','hoa','unknown')),
  indoor             boolean,
  lighting           boolean,
  surface            text,
  status             text not null default 'draft'
                       check (status in ('draft','published')),
  -- google (ToS-compliant): only the place_id is stored permanently
  google_place_id    text,
  -- enrichment (Gemini)
  enrichment         jsonb,
  enriched_at        timestamptz,
  enrichment_version text,
  -- operational link (set only on promotion)
  location_id        uuid references public.locations(id) on delete set null,
  -- timestamps
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- coordinate plausibility (cheap guard against garbage ingest/geocode data)
  constraint facility_listings_lat_chk check (lat is null or lat between -90 and 90),
  constraint facility_listings_lng_chk check (lng is null or lng between -180 and 180)
);

alter table public.facility_listings enable row level security;   -- deny-all, zero policies (expected advisory)

create index if not exists facility_listings_state_city_idx on public.facility_listings (state, city);
create index if not exists facility_listings_status_idx     on public.facility_listings (status);

create trigger facility_listings_updated_at
  before update on public.facility_listings
  for each row execute function update_updated_at_column();
