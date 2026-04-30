-- Tournaments foundation (Prompt 1 of 4)
-- Drops old incompatible table, rebuilds with correct schema + RLS

drop table if exists tournaments cascade;

create table tournaments (
  id                   uuid        primary key default gen_random_uuid(),
  name                 text        not null,
  description          text,
  location_id          uuid        references locations(id) on delete set null,
  start_date           date        not null,
  start_time           time        not null,
  estimated_end_time   time,
  organizer_id         uuid        not null references profiles(id) on delete restrict,
  status               text        not null default 'draft'
                                   check (status in ('draft', 'published', 'cancelled', 'completed')),
  visibility           text        not null default 'public'
                                   check (visibility in ('public', 'private')),
  registration_status  text        not null default 'open'
                                   check (registration_status in ('open', 'closed')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tournaments_updated_at
  before update on tournaments
  for each row execute function update_updated_at_column();

alter table tournaments enable row level security;

create policy "tournaments: public can view published public"
  on tournaments for select
  to anon, authenticated
  using (status = 'published' and visibility = 'public');

create policy "tournaments: organizers can view own"
  on tournaments for select
  to authenticated
  using (organizer_id = auth.uid());

create policy "tournaments: authenticated can create"
  on tournaments for insert
  to authenticated
  with check (organizer_id = auth.uid());

create policy "tournaments: organizers can update own"
  on tournaments for update
  to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

create policy "tournaments: organizers can delete own"
  on tournaments for delete
  to authenticated
  using (organizer_id = auth.uid());
