-- Early-bird / tiered pricing on every paid surface. A JSON ladder of
-- [{ "until": "YYYY-MM-DD", "cents": N }, ...] — the price applies while the
-- current date is on or before "until"; once all tiers lapse, the base fee
-- (cost_cents / price_cents) is the full price. Null/empty = no tiers (flat fee).
alter table public.tournaments add column if not exists price_tiers jsonb;
alter table public.leagues add column if not exists price_tiers jsonb;
alter table public.events add column if not exists price_tiers jsonb;
