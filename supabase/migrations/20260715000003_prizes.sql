-- Advertised prizes/awards per event (display-only — Joinzer does not move prize money).
-- jsonb array of { place: text, description: text, type: 'cash'|'trophy'|'medal'|'merch'|'other' }.
-- Null = no prizes listed.
alter table tournaments add column if not exists prizes jsonb;
alter table leagues     add column if not exists prizes jsonb;
alter table events      add column if not exists prizes jsonb;

comment on column tournaments.prizes is 'Advertised prizes/awards (display-only): jsonb array of {place, description, type}.';
comment on column leagues.prizes     is 'Advertised prizes/awards (display-only): jsonb array of {place, description, type}.';
comment on column events.prizes       is 'Advertised prizes/awards (display-only): jsonb array of {place, description, type}.';
