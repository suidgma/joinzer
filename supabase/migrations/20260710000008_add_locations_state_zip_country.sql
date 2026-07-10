-- Add postal address fields to locations: state, ZIP, country.
-- (ZIP kept as text — leading zeros / +4 suffixes aren't integers.)
alter table public.locations
  add column if not exists state text,
  add column if not exists zip_code text,
  add column if not exists country text default 'US';

-- Backfill: every current location is in the Las Vegas, Nevada metro (USA).
update public.locations set state = 'NV' where state is null;
update public.locations set country = 'US' where country is null;

-- Pull a trailing 5-digit ZIP from any address that already embeds one
-- (only "Dill Dinkers ... NV 89014" currently qualifies). The remaining
-- addresses are street-only and need a per-court ZIP lookup — left null here.
update public.locations
set zip_code = substring(address from '(\d{5})(?:-\d{4})?\s*$')
where zip_code is null and address ~ '\d{5}\s*$';
