-- Add session_type to events: 'game' (default) or 'clinic'
alter table events
  add column if not exists session_type text not null default 'game'
    check (session_type in ('game', 'clinic'));
