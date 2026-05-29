create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  surface text not null check (surface in ('event', 'league', 'tournament', 'system')),
  surface_id uuid,
  kind text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  created_at timestamptz default now() not null
);

alter table notifications enable row level security;

create policy "users_select_own_notifications"
  on notifications for select
  using (recipient_id = auth.uid());

create policy "users_update_own_notifications"
  on notifications for update
  using (recipient_id = auth.uid());

-- service_role bypasses RLS — no insert policy needed for server-side writes

create index notifications_recipient_created
  on notifications(recipient_id, created_at desc);

-- Partial index for fast unread count queries
create index notifications_recipient_unread
  on notifications(recipient_id, created_at desc)
  where read_at is null;
