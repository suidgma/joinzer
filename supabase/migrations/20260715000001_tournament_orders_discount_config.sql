-- Snapshot the multi-division discount config (jsonb) onto each order at purchase
-- time, so a later per-division refund recomputes the bundle against the terms
-- that were actually bought — not whatever the organizer's config says now.
alter table tournament_orders
  add column if not exists discount_config jsonb;

comment on column tournament_orders.discount_config is
  'Snapshot of tournaments.multi_division_discount at checkout; used to recompute marginal refunds on per-division cancel. Null = no bundle discount was in effect.';
