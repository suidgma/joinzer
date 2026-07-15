-- Snapshot the applied discount code's terms ({type, value}) onto the order, alongside
-- discount_config, so per-division marginal refunds recompute the bundle WITH the code —
-- otherwise a coded bundle over-refunds (it would give back the pre-code marginal value).
-- Null = no code was applied.
alter table tournament_orders
  add column if not exists code_config jsonb;

comment on column tournament_orders.code_config is
  'Snapshot of the applied discount code as {type:''percent''|''flat'', value:int} at checkout; used so marginal per-division refunds recompute with the code. Null = no code applied.';
