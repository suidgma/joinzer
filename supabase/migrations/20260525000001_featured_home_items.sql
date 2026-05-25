-- App-owner curated featured items for the home screen.
-- When any active rows exist they replace the personalized recommendations.
create table featured_home_items (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null check (event_type in ('session', 'tournament', 'league')),
  event_id      uuid not null,
  display_order int not null default 0,
  label         text,
  active_from   timestamptz not null default now(),
  active_until  timestamptz,
  created_at    timestamptz default now()
);

alter table featured_home_items enable row level security;

create policy "featured_home_items_read"
  on featured_home_items for select
  to authenticated using (true);
