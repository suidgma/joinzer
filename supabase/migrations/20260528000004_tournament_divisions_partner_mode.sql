-- tournament_divisions.partner_mode: organizer choice for how doubles
-- partners are handled within a tournament division.
--
--   'fixed' (default, current behavior)
--     Captain picks partner at registration. Cross-linked registration rows
--     form a team. Bracket builder treats each team as one unit; matches are
--     team-vs-team. Existing tournament doubles flow exactly as it works today.
--
--   'rotating'
--     Players register solo (no partner). Match generator pairs players into
--     doubles matches with a different partner each round. Same conceptual
--     model as the league rotating scheduler. Only supported for
--     bracket_type='round_robin' in this slice — UI gates the toggle.
--
-- For rotating doubles matches, a single tournament_matches row needs to
-- store 4 distinct player registrations (2 per side). The existing
-- team_1/2_registration_id columns hold side A's first player and side B's
-- first player; new partner columns hold the second player on each side.
-- In fixed mode the partner columns stay NULL.

ALTER TABLE tournament_divisions
  ADD COLUMN IF NOT EXISTS partner_mode TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE tournament_divisions
  ADD CONSTRAINT tournament_divisions_partner_mode_check
  CHECK (partner_mode IN ('fixed', 'rotating'));

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS team_1_partner_registration_id UUID,
  ADD COLUMN IF NOT EXISTS team_2_partner_registration_id UUID;
