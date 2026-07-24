-- Directory — Venue schema Phase 3A (schema half of ADR-13): bridge + enum freeze + deprecations +
-- surface normalization. Additive/non-destructive: no drops, no deletes, no lossy value rewrites of
-- locations rows. Promotion FLOW (app code) is Phase 3B. Applied before any dependent code (ADR-10).

-- A. Bridge column — the canonical link from an operational location to its directory record.
-- Nullable, additive, zero behavior change (set only on promotion / parity backfill).
alter table public.locations add column if not exists facility_listing_id uuid references public.facility_listings(id);
create index if not exists locations_facility_listing_id_idx on public.locations (facility_listing_id);

-- C. Enum reconciliation (ADR-13 #2) — freeze the overloaded legacy access_type. The CHECK stays
-- permissive so existing rows remain valid (a tighter CHECK would reject resort/fee_based/etc.); the
-- overloaded vocabulary is documented frozen, and hard new-write enforcement rides the Phase 3B
-- write-path cutover onto the canonical facility_listings record (unified access_type + fee_type + indoor).
comment on column public.locations.access_type is
  'FROZEN legacy overloaded enum (public/private/resort/fee_based/business/directory/hoa/indoor_public/semi_private) — conflates access+fee+indoor+category. New venue writes use the unified vocabulary on the canonical facility_listings record: access_type in (public/private/membership/school/hoa/unknown) + fee_type + indoor. Existing rows retained; hard new-write enforcement is Phase 3B. ADR-13 #2.';

-- D. Deprecations (ADR-13) — mark, do NOT drop; read-path switch is Phase 3B (reads are still live).
comment on column public.locations.category   is 'DEPRECATED (ADR-13) — descriptive/category free-text; canonical data lives on facility_listings. Stop writing; read-path switch is Phase 3B. Not dropped.';
comment on column public.locations.source_url is 'DEPRECATED (ADR-13) — superseded by facility_listings.name_source_url. Stop writing; read-path switch is Phase 3B. Not dropped.';
comment on column public.locations.notes      is 'DEPRECATED (ADR-13) — superseded by facility_listings.public_notes. Stop writing; read-path switch is Phase 3B. Not dropped.';
comment on column public.locations.phone      is 'DEPRECATED (ADR-13 #9) — phone migrates to the canonical facility_listings record. Stop writing; read-path switch is Phase 3B. Not dropped.';

-- E. Surface normalization (facility_listings only; locations has no surface column).
-- paved → asphalt (OSM generic → unified value, per handoff). Outcome: paved → 0, folded into asphalt.
-- (Exact before/after counts are in the session summary — the live surface data is shifting under
-- ChatGPT-Work's concurrent enrichment backfill, so a hardcoded count here would go stale.)
update public.facility_listings set surface = 'asphalt' where surface = 'paved';
-- Mistagged legacy OSM drafts → NULL (real surface undetermined): 'UNMC Ice Rink' (NE, an ice rink),
-- 'The Horseshoe' (TX). Outcome: ice → 0, grass → 0.
update public.facility_listings set surface = null where surface in ('ice', 'grass');
