-- League format dimension (Phase 0, PR-0.1). Additive + backward-compatible:
-- every existing league defaults to 'session_rr' (the current round-robin
-- session-based model) so behavior is unchanged. Nothing reads these columns
-- yet — later PRs dispatch scheduling/standings/scoring on format_kind and
-- store per-format knobs in format_settings_json.
alter table leagues
  add column if not exists format_kind text not null default 'session_rr';

alter table leagues
  add column if not exists format_settings_json jsonb not null default '{}'::jsonb;

-- Enumerate ALL planned formats up front so no follow-up migration is needed
-- when box/flex/ladder/team land.
alter table leagues
  drop constraint if exists leagues_format_kind_check;
alter table leagues
  add constraint leagues_format_kind_check
  check (format_kind in ('session_rr','box','flex','ladder','team'));
