-- Optional manual override for the venue's short map-pin code. Null → the map
-- auto-derives a code from the name (initials of the significant words).
alter table public.locations
  add column if not exists short_code text
    check (short_code is null or char_length(short_code) between 1 and 12);
