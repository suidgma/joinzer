-- Rating trend: cache the primary track's Joinzer Score over time (compact array) on
-- profiles so the profile sparkline reads it directly (player_ratings stays RLS deny-all).
alter table public.profiles add column if not exists primary_score_history jsonb;
