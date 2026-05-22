-- Baseline: create tables that predate migration tracking.
-- These tables were created out-of-band before supabase_migrations tracking
-- began. The first tracked migration (20260422003735) is an ALTER TABLE on
-- locations — this migration must run before it so the table exists.
--
-- All statements are idempotent:
--   CREATE TABLE IF NOT EXISTS  → no-op on prod (table exists)
--   DROP POLICY IF EXISTS + CREATE POLICY  → drop and recreate (safe)
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY  → no-op if already enabled
--
-- Columns intentionally NOT included here (added by tracked migrations):
--   profiles.joinzer_rating    — 20260424203923, no IF NOT EXISTS
--   profiles.gender            — 20260428195307, no IF NOT EXISTS
--   profiles.is_stub           — 20260520145348, no IF NOT EXISTS
--   profiles.email_visibility  — 20260520183746, no IF NOT EXISTS
--   profiles.phone_visibility  — 20260520183746, no IF NOT EXISTS
--   events.recurrence_group_id — 20260424203321, no IF NOT EXISTS
-- Including these would cause those migrations to fail with "column already exists".
--
-- profiles.dummy and events.registration_closes_at are included because no
-- tracked migration adds them — they must be in the baseline or they won't
-- exist on fresh branches.

-- ─── locations ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.locations (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL,
  metro_area  text    NOT NULL DEFAULT 'Las Vegas',
  subarea     text,
  court_count integer NOT NULL DEFAULT 1,
  access_type text    NOT NULL
    CHECK (access_type IN (
      'public','private','resort','fee_based','business',
      'directory','hoa','indoor_public','semi_private'
    )),
  notes       text,
  is_active   boolean NOT NULL DEFAULT true
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_locations_court_count
  ON public.locations (court_count DESC, name);

DROP POLICY IF EXISTS "locations: public read" ON public.locations;
CREATE POLICY "locations: public read"
  ON public.locations FOR SELECT TO anon, authenticated USING (true);

-- ─── profiles ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  email               text,
  profile_photo_url   text,
  phone               text,
  dupr_rating         numeric,
  estimated_rating    numeric,
  rating_source       text
    CHECK (rating_source IN ('dupr_known','estimated','skipped')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  notify_new_sessions boolean     NOT NULL DEFAULT false,
  dummy               boolean     DEFAULT false
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: authenticated users can read any profile" ON public.profiles;
CREATE POLICY "profiles: authenticated users can read any profile"
  ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles: users can insert own profile" ON public.profiles;
CREATE POLICY "profiles: users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles: users can update own profile" ON public.profiles;
CREATE POLICY "profiles: users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ─── events ──────────────────────────────────────────────────────────────────
-- status uses the 4-value final form; 20260430151753 DROP+re-ADD is idempotent.
-- registration_closes_at included: no tracked migration adds it to events.

CREATE TABLE IF NOT EXISTS public.events (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text        NOT NULL,
  creator_user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  captain_user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id            uuid        NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  starts_at              timestamptz NOT NULL,
  duration_minutes       integer     NOT NULL DEFAULT 120,
  court_count            integer     NOT NULL DEFAULT 1,
  players_per_court      integer     NOT NULL DEFAULT 6,
  max_players            integer     NOT NULL,
  notes                  text,
  status                 text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','full','cancelled','completed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  registration_closes_at timestamptz
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events: authenticated users can read events" ON public.events;
CREATE POLICY "events: authenticated users can read events"
  ON public.events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "events: authenticated users can create events" ON public.events;
CREATE POLICY "events: authenticated users can create events"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (creator_user_id = auth.uid() AND captain_user_id = auth.uid());

DROP POLICY IF EXISTS "events: only captain can update" ON public.events;
CREATE POLICY "events: only captain can update"
  ON public.events FOR UPDATE TO authenticated
  USING (captain_user_id = auth.uid())
  WITH CHECK (captain_user_id = auth.uid());

DROP POLICY IF EXISTS "events: only captain can delete" ON public.events;
CREATE POLICY "events: only captain can delete"
  ON public.events FOR DELETE TO authenticated
  USING (captain_user_id = auth.uid());

-- ─── event_participants ───────────────────────────────────────────────────────
-- Excluded: payment_status, stripe_payment_intent_id
-- (both added with IF NOT EXISTS by 20260508150615 and 20260508151948).

CREATE TABLE IF NOT EXISTS public.event_participants (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_status text        NOT NULL
    CHECK (participant_status IN ('joined','waitlist','left')),
  joined_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_participants: authenticated users can read" ON public.event_participants;
CREATE POLICY "event_participants: authenticated users can read"
  ON public.event_participants FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "event_participants: users can insert own row" ON public.event_participants;
CREATE POLICY "event_participants: users can insert own row"
  ON public.event_participants FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "event_participants: users or captain can update" ON public.event_participants;
CREATE POLICY "event_participants: users or captain can update"
  ON public.event_participants FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_participants.event_id
        AND events.captain_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "event_participants: users can delete own row" ON public.event_participants;
CREATE POLICY "event_participants: users can delete own row"
  ON public.event_participants FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── event_messages ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_text text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_messages: authenticated users can read" ON public.event_messages;
CREATE POLICY "event_messages: authenticated users can read"
  ON public.event_messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "event_messages: joined participants can insert" ON public.event_messages;
CREATE POLICY "event_messages: joined participants can insert"
  ON public.event_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.event_participants
      WHERE event_participants.event_id = event_messages.event_id
        AND event_participants.user_id = auth.uid()
        AND event_participants.participant_status = 'joined'
    )
  );

DROP POLICY IF EXISTS "event_messages: authors can update own messages" ON public.event_messages;
CREATE POLICY "event_messages: authors can update own messages"
  ON public.event_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "event_messages: authors can delete own messages" ON public.event_messages;
CREATE POLICY "event_messages: authors can delete own messages"
  ON public.event_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid());
