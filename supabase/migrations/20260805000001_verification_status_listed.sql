-- facility_listings.verification_status — add the `listed` tier (ADR-18).
--
-- WHY. Coverage-first (ADR-17) publishes rows that no controlling entity has confirmed: a venue
-- named with an address by a credible local source, which then geocoded. The importer previously
-- hardcoded verification_status='source_verified' on every row, which was true only while the
-- publish gate demanded candidate research_status='verified'. Under the new gate that hardcode
-- becomes a lie told by a column — it would assert a controlling-entity source that nobody has.
--
-- `listed` is the honest third tier:
--   human_verified   a person confirmed it            (set by hand; no script may write it)
--   source_verified  a controlling entity confirms it (research_status='verified')
--   listed           a credible local source names it, and it geocoded
--
-- NOT DESTRUCTIVE. The column is free text, but a CHECK constraint pins the vocabulary, so a fourth
-- value requires dropping and re-adding that constraint. The replacement is a strict SUPERSET of the
-- old one: every value previously permitted is still permitted, so no existing row can violate it
-- and no row is read, rewritten or deleted. Owner informed and content (2026-08-05).
--
-- ORDERING. The constraint must permit `listed` BEFORE any importer writes it, or the INSERT in
-- --stage=listings fails atomically. Applied to Supabase ahead of the dependent code, per ADR-10.
--
-- ROW COUNTS AT APPLY TIME (2026-08-05): 1,005 source_verified, 51 human_verified, 720 NULL, 0
-- listed. NULL remains permitted and remains meaningful — it is the legacy/OSM-ingested state, not a
-- tier, and this migration deliberately does not backfill it. Assigning a confidence tier to rows
-- nobody assessed would manufacture exactly the false confidence the tier exists to avoid.

alter table public.facility_listings
  drop constraint if exists facility_listings_verification_status_check;

alter table public.facility_listings
  add constraint facility_listings_verification_status_check
  check (verification_status is null or verification_status in
    ('unverified', 'source_verified', 'human_verified', 'listed'));

comment on column public.facility_listings.verification_status is
  'Confidence tier. human_verified (a person confirmed it) | source_verified (a controlling entity confirms it) | listed (a credible local source names it and it geocoded) | unverified | NULL (legacy, never assessed). ADR-18: the tier DESCRIBES a row, it does not gate it — see scripts/lib/publish-gate.mjs verificationStatusFor().';
