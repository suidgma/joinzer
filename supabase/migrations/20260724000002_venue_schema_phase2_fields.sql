-- Directory — Venue schema Phase 2 (additive venue fields on facility_listings). ADR-13.
-- All 15 columns are nullable with no defaults, and stay invisible until the directory loader selects
-- them (no loader/UI change in this package). ChatGPT-Work backfills these immediately after this lands.
-- Semantics for the enum-ish text fields: 'unknown' = researched but undetermined; NULL = not yet researched.

alter table public.facility_listings
  -- contact / links: website is the venue's OWN official site — distinct from name_source_url (provenance)
  add column if not exists website text,
  add column if not exists phone text,

  -- cost + booking
  add column if not exists fee_type text
    check (fee_type is null or fee_type in ('free','fee','membership','unknown')),
  add column if not exists reservation_policy text
    check (reservation_policy is null or reservation_policy in
      ('none','drop_in','reservation_recommended','reservation_required','unknown')),
  add column if not exists reservation_url text,

  -- courts / equipment
  add column if not exists court_configuration text
    check (court_configuration is null or court_configuration in
      ('dedicated','shared_multi_use','mixed','unknown')),
  add column if not exists line_type text
    check (line_type is null or line_type in
      ('permanent_painted','temporary_provided','byo_required','none','mixed','unknown')),
  add column if not exists net_setup text
    check (net_setup is null or net_setup in
      ('permanent','portable_provided','shared_tennis_net','byo_required','none','mixed','unknown')),
  add column if not exists nets_provided_count integer
    check (nets_provided_count is null or nets_provided_count >= 0),

  -- amenities / free-text notes
  add column if not exists public_notes text,
  add column if not exists restrooms boolean,
  add column if not exists parking text
    check (parking is null or parking in ('lot','street','none','unknown')),
  add column if not exists water_fountain boolean,
  add column if not exists accessibility boolean,

  -- provenance of these venue facts
  add column if not exists verification_status text
    check (verification_status is null or verification_status in
      ('unverified','source_verified','human_verified'));
