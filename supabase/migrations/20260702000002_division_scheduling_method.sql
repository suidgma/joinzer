-- Per-division scheduling method override. Nullable → the division inherits the
-- tournament's scheduling_method; set to force a division to Timed or Rolling.
alter table tournament_divisions
  add column if not exists scheduling_method text
    check (scheduling_method is null or scheduling_method in ('timed','rolling'));
