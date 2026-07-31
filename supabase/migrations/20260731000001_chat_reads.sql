-- Server-side chat read state.
--
-- Chat read state lived ONLY in localStorage (`chat-read:<table>:<entityId>`, written by
-- ChatPanel and read by ChatUnreadProvider), which made it non-durable and per-device: a
-- browser cache clear made every league/tournament with any message light up as unread,
-- because the provider treated a MISSING key as unread. This table is the durable source of
-- truth; localStorage stays on as an optimistic cache so the dot still clears instantly.
--
-- Client-readable AND client-writable by design: the rows are strictly self-scoped, so RLS is
-- the whole authorization rule (ADR-03's "the API route is the boundary" exists because the
-- service role bypasses RLS — not the case here). ChatPanel already writes its messages the
-- same way. Writes are additionally gated on chat membership via the existing SECURITY DEFINER
-- helpers from 20260714000006, so a user can't accumulate rows for chats they don't belong to.

create table public.chat_reads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  -- All three ChatPanel surfaces. ChatUnreadProvider only surfaces leagues + tournaments,
  -- but Play chat (event_messages) uses the same panel and gets the same durable read state.
  source_table text not null check (source_table in ('league_messages', 'tournament_messages', 'event_messages')),
  entity_id    uuid not null,
  last_read_at timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Also the only index this table needs: it serves the one query shape,
  -- `where user_id = $1 and (source_table, entity_id) in (...)`.
  unique (user_id, source_table, entity_id)
);

alter table public.chat_reads enable row level security;

create policy "chat_reads_select" on public.chat_reads
  for select to authenticated
  using (user_id = auth.uid());

-- Own rows only, and only for chats the caller is actually a member of. user_id is enforced
-- as auth.uid() here rather than trusted from the payload.
create policy "chat_reads_insert" on public.chat_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and case source_table
      when 'league_messages'     then public.is_league_chat_member(entity_id)
      when 'tournament_messages' then public.is_tournament_chat_member(entity_id)
      when 'event_messages'      then public.is_event_chat_member(entity_id)
      else false
    end
  );

create policy "chat_reads_update" on public.chat_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and case source_table
      when 'league_messages'     then public.is_league_chat_member(entity_id)
      when 'tournament_messages' then public.is_tournament_chat_member(entity_id)
      when 'event_messages'      then public.is_event_chat_member(entity_id)
      else false
    end
  );

-- No delete policy: read state is never deleted by the client (rows go with the user via the
-- profiles cascade).
--
-- This grant is declarative intent, not the actual guard. Supabase's default privileges
-- already grant the full set to anon + authenticated on any new public table, so this is a
-- no-op on top of them — verified identical on `notifications` and `league_messages`. RLS is
-- what actually restricts access (ADR-03): anon has no policy at all, so it is denied
-- everything, and authenticated is confined to its own rows by the three policies above.
grant select, insert, update on public.chat_reads to authenticated;

create trigger chat_reads_updated_at
  before update on public.chat_reads
  for each row execute function update_updated_at_column();  -- same fn used by facility_listings
