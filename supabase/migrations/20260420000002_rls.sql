-- Migration 002: Row Level Security
-- Enable RLS on every table and define baseline policies per CLAUDE.md §6.

alter table profiles         enable row level security;
alter table locations        enable row level security;
alter table events           enable row level security;
alter table event_participants enable row level security;
alter table event_messages   enable row level security;

-- ─── profiles ────────────────────────────────────────────────────────────────

-- Any authenticated user can view any profile (needed to display participant names)
create policy "profiles: authenticated users can read any profile"
  on profiles for select
  to authenticated
  using (true);

-- Users can only create their own profile row
create policy "profiles: users can insert own profile"
  on profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Users can only update their own profile
create policy "profiles: users can update own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─── locations ───────────────────────────────────────────────────────────────

-- Public read (anon + authenticated); writes are service-role only (admin-seeded)
create policy "locations: public read"
  on locations for select
  to anon, authenticated
  using (true);

-- ─── events ──────────────────────────────────────────────────────────────────

create policy "events: authenticated users can read events"
  on events for select
  to authenticated
  using (true);

-- Creator and captain must both equal the calling user at insert time
-- (enforced here; RPCs also enforce this at the app layer)
create policy "events: authenticated users can create events"
  on events for insert
  to authenticated
  with check (
    creator_user_id = auth.uid()
    and captain_user_id = auth.uid()
  );

create policy "events: only captain can update"
  on events for update
  to authenticated
  using (captain_user_id = auth.uid())
  with check (captain_user_id = auth.uid());

-- Soft-delete preferred (set status = cancelled), but hard delete is captain-only
create policy "events: only captain can delete"
  on events for delete
  to authenticated
  using (captain_user_id = auth.uid());

-- ─── event_participants ───────────────────────────────────────────────────────

create policy "event_participants: authenticated users can read"
  on event_participants for select
  to authenticated
  using (true);

-- Direct inserts restricted to own row; the join_event RPC (security definer)
-- handles join logic and bypasses RLS intentionally
create policy "event_participants: users can insert own row"
  on event_participants for insert
  to authenticated
  with check (user_id = auth.uid());

-- Users can update their own row; captains can update any row in their event
create policy "event_participants: users or captain can update"
  on event_participants for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from events
      where id = event_id and captain_user_id = auth.uid()
    )
  );

create policy "event_participants: users can delete own row"
  on event_participants for delete
  to authenticated
  using (user_id = auth.uid());

-- ─── event_messages ──────────────────────────────────────────────────────────

-- MVP: any authenticated user can read (tighten to participants-only in v2)
create policy "event_messages: authenticated users can read"
  on event_messages for select
  to authenticated
  using (true);

-- Must be authenticated, own the row, and be a joined participant of the event
create policy "event_messages: joined participants can insert"
  on event_messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from event_participants
      where event_id = event_messages.event_id
        and user_id = auth.uid()
        and participant_status = 'joined'
    )
  );

create policy "event_messages: authors can update own messages"
  on event_messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "event_messages: authors can delete own messages"
  on event_messages for delete
  to authenticated
  using (user_id = auth.uid());
