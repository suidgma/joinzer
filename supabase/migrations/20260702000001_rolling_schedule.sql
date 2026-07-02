-- Rolling Schedule mode: a tournament-level scheduling method + a stable,
-- tournament-wide "Match #" sequence assigned at generation time. Additive and
-- nullable so every existing timed tournament is unaffected until regenerated.

alter table tournaments
  add column if not exists scheduling_method text not null default 'timed'
    check (scheduling_method in ('timed','rolling'));

alter table tournament_matches
  add column if not exists sequence_number int;

-- Fast ordering/lookup by the tournament-wide sequence. Partial (skips the large
-- population of null rows). NOT unique: draft + published copies and regeneration
-- churn make a hard uniqueness constraint fragile; uniqueness is an application
-- invariant enforced by the single-pass assigner, not the DB.
create index if not exists tournament_matches_sequence
  on tournament_matches(tournament_id, sequence_number)
  where sequence_number is not null;
