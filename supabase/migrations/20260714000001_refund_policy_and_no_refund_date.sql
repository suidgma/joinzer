-- Refund policy (free text) + a dedicated no-refund date, on every paid surface
-- (tournaments, leagues, events). The no-refund date, when set, is the authoritative
-- refund cutoff — refunds are not issued on or after this date; when null, the refund
-- routes fall back to the existing registration_closes_at behavior.
alter table public.tournaments add column if not exists refund_policy text;
alter table public.tournaments add column if not exists no_refund_date date;

alter table public.leagues add column if not exists refund_policy text;
alter table public.leagues add column if not exists no_refund_date date;

alter table public.events add column if not exists refund_policy text;
alter table public.events add column if not exists no_refund_date date;
