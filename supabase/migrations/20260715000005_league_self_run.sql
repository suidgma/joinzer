-- Player-run leagues: let a designated player (or, as a fallback, the first present player)
-- run a round-robin session's live flow — attendance, round-by-round generation, subs,
-- lock/complete — without the league owner physically present. Additive + default-off, so
-- existing (court-monitor-run) leagues are unchanged.
alter table leagues
  add column if not exists self_run boolean not null default false,
  add column if not exists season_host_user_id uuid references profiles(id) on delete set null;

alter table league_sessions
  add column if not exists host_user_id uuid references profiles(id) on delete set null;

comment on column leagues.self_run is
  'Player-run league: a designated session host (or first present player) runs the live session, not just the owner/co-admin. Default false = owner/court-monitor-run.';
comment on column leagues.season_host_user_id is
  'Optional season-long court monitor (a player) who hosts every session by default. Overridable per session via league_sessions.host_user_id.';
comment on column league_sessions.host_user_id is
  'The effective host for THIS session (set by assignment, host-sub handoff, or first-present claim). Falls back to leagues.season_host_user_id when null.';
