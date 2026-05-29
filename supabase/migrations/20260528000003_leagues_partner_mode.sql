-- leagues.partner_mode: organizer choice for how doubles partners are
-- handled across the season.
--
--   'rotating' (default, current behavior)
--     Scheduler assigns a new partner each round, using the -1000 repeat
--     penalty in lib/scheduling/leagueScheduler.ts. Players may register
--     solo (auto-matched) or team (captain picks partner); either way the
--     partner_user_id is stored at registration but ignored by the scheduler.
--
--   'fixed'
--     Scheduler ALWAYS pairs the two players whose registrations are
--     cross-linked via league_registrations.partner_registration_id. The
--     registration UI should require team-mode (captain picks partner) so
--     every player has a known partner from day one. If a paired player is
--     absent, the present partner plays singles or gets a bye — no temp
--     re-pairing.
--
-- Default 'rotating' so existing leagues keep their current behavior with
-- zero migration risk. Only opt-in changes the behavior.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS partner_mode TEXT NOT NULL DEFAULT 'rotating';

ALTER TABLE leagues
  ADD CONSTRAINT leagues_partner_mode_check
  CHECK (partner_mode IN ('rotating', 'fixed'));
