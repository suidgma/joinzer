-- Recreate tournament_events, which was CASCADE-dropped by migration 20260430150757
-- (DROP TABLE IF EXISTS tournaments CASCADE). No tracked migration recreates it;
-- this fills the gap so fresh-branch replays end with all tables present.
-- CREATE TABLE IF NOT EXISTS → no-op on prod.

CREATE TABLE IF NOT EXISTS public.tournament_events (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid    NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name          text    NOT NULL,
  category      text    NOT NULL
    CHECK (category IN ('mens_singles','womens_singles','mens_doubles','womens_doubles','mixed_doubles')),
  skill_level   text,
  age_division  text,
  max_teams     integer,
  event_date    date,
  bracket_type  text    DEFAULT 'single_elimination'
    CHECK (bracket_type IN ('single_elimination','double_elimination','round_robin','pool_play')),
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.tournament_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tevt_select" ON public.tournament_events;
CREATE POLICY "tevt_select"
  ON public.tournament_events FOR SELECT TO public USING (true);
