-- League setting: allow registered players to submit scores for their own matches.
-- When true, a participant may score their own match (saved directly; the organizer
-- can always edit). Default false → no behavior change for existing leagues.
alter table leagues
  add column if not exists allow_player_scores boolean not null default false;
