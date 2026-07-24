-- Directory — create public.facility_candidates: the staging/source-of-truth table for in-progress
-- directory candidates (discovery → verify/enrich research → publish). Replaces the Google Sheet /
-- CSV masters that caused sync drift. House style: text + inline CHECK enums, snake_case, RLS deny-all
-- (all access via service role, ADR-03). All research fields nullable.
-- References facility_listings but does NOT modify it (FK-only). Phase-3 promotion flow is separate.
create table public.facility_candidates (
  id           uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,           -- e.g. 'phx-0166'; stable per-metro key
  batch        text not null,                    -- e.g. 'az-review-2026-07'; one per metro run (open-ended, no CHECK)

  -- discovery (Stage 1) — discovered_by is free text ('places' | 'osm' | 'places+osm' | 'existing+…')
  discovered_by  text,
  proposed_name  text,
  address        text,
  zip            text,
  city           text,
  state          text,
  metro_area     text,
  lat            double precision check (lat is null or lat between -90 and 90),
  lng            double precision check (lng is null or lng between -180 and 180),
  google_place_id text,
  osm_id         text,
  osm_clusters   integer,

  -- classification (Gemini, Stage 1) — classifier_* + url_source are open-ended (no CHECK)
  classifier_type        text,                   -- park | club | facility | community_hoa | residential | rental | retail | school | other
  classifier_access_type text,
  classifier_confidence  numeric,
  suggested_disposition  text
    check (suggested_disposition is null or suggested_disposition in ('likely_venue','likely_reject','uncertain')),
  proposed_source_url    text,
  url_source             text,

  -- verify / research (Stage 2 — humans + agents write here; reviewed_by is free text)
  research_status text not null default 'pending'
    check (research_status in ('pending','verified','probable','unresolved','duplicate','not_venue','not_pickleball','held','published')),
  edited_name          text,
  edited_access_type   text,
  edited_city          text,
  edited_address       text,
  verified_source_url  text,
  identity_confidence  text
    check (identity_confidence is null or identity_confidence in ('low','medium','high')),
  pickleball_confidence text
    check (pickleball_confidence is null or pickleball_confidence in ('low','medium','high')),
  reviewer_notes text,
  reviewed_by    text,                            -- 'marty' | 'claude-cowork' | 'chatgpt-work' | batch tag — free text

  -- linkage to production (FK-only; ON DELETE SET NULL so a listing delete never blocks/deletes a candidate)
  existing_listing_id  uuid references public.facility_listings(id) on delete set null,  -- pre-existing match found at discovery
  published_listing_id uuid references public.facility_listings(id) on delete set null,  -- set when this candidate is published

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.facility_candidates enable row level security;  -- deny-all, zero policies (ADR-03; expected advisory)

create index facility_candidates_batch_status_idx on public.facility_candidates (batch, research_status);
create index facility_candidates_geo_idx          on public.facility_candidates (lat, lng);

create trigger facility_candidates_updated_at
  before update on public.facility_candidates
  for each row execute function update_updated_at_column();  -- same fn used by facility_listings
