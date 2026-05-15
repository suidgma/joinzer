-- Migration: standardize registration_closes_at across tournaments, leagues, and events
-- Date: 2026-05-15
-- Affected tables: tournaments (3 steps), leagues (1 new col + backfill), events (1 new col + backfill)
-- Affected functions: join_event (add deadline guard)
--
-- Timezone assumption: America/Los_Angeles for all existing rows.
-- All current data is Las Vegas metro. Re-evaluate if expanding beyond Vegas.
-- Documented in docs/decisions.md (2026-05-15 backup strategy clarification).


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — TOURNAMENTS: convert registration_closes_at from date to timestamptz
-- ─────────────────────────────────────────────────────────────────────────────
-- The existing column stores a plain date (e.g., '2026-06-14').
-- We interpret it as 23:59:59 on that calendar date in Pacific time
-- and store the equivalent UTC instant.
-- This preserves the organizer's intent ("closes end of this day") while
-- giving us a precise, timezone-aware timestamp for server-side enforcement.

ALTER TABLE tournaments
  ALTER COLUMN registration_closes_at TYPE timestamptz
  USING (
    (registration_closes_at::timestamp + interval '23 hours 59 minutes 59 seconds')
    AT TIME ZONE 'America/Los_Angeles'
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — LEAGUES: add registration_closes_at with backfill
-- ─────────────────────────────────────────────────────────────────────────────
-- Leagues had no deadline column. We add it nullable so rows with NULL
-- start_date are not blocked. Evaluate NOT NULL coverage after deploy.

ALTER TABLE leagues
  ADD COLUMN registration_closes_at timestamptz;

-- Backfill: 7 days before the league start date, at 23:59:59 PT.
-- Rows with NULL start_date are intentionally skipped (get NULL deadline).
-- At the time of this migration: 6 leagues total.

UPDATE leagues
SET registration_closes_at = (
  (start_date::timestamp - interval '7 days' + interval '23 hours 59 minutes 59 seconds')
  AT TIME ZONE 'America/Los_Angeles'
)
WHERE start_date IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — EVENTS (PLAY): add registration_closes_at with backfill
-- ─────────────────────────────────────────────────────────────────────────────
-- Events had no deadline column. starts_at is timestamptz NOT NULL, so
-- every row gets a deadline. Nullable column; NOT NULL deferred pending review.

ALTER TABLE events
  ADD COLUMN registration_closes_at timestamptz;

-- Backfill: extract the calendar date of starts_at in PT, subtract 7 days,
-- set 23:59:59 on that date in PT, then store as UTC.
-- Using (starts_at AT TIME ZONE 'America/Los_Angeles')::date avoids the
-- off-by-one risk from naive starts_at::date (which uses the Postgres
-- session timezone, defaulting to UTC — which could give the wrong calendar
-- date for evening sessions).
-- At the time of this migration: 18 events total.

UPDATE events
SET registration_closes_at = (
  (starts_at AT TIME ZONE 'America/Los_Angeles')::date::timestamp
  - interval '7 days'
  + interval '23 hours 59 minutes 59 seconds'
) AT TIME ZONE 'America/Los_Angeles';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — join_event RPC: add deadline guard
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a single deadline check BEFORE the existing status and payment checks.
-- All other logic is reproduced exactly from the current function body.
-- Signature is unchanged: join_event(p_event_id uuid) RETURNS json

CREATE OR REPLACE FUNCTION join_event(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_user_id         uuid := auth.uid();
  v_event           record;
  v_joined_count    int;
  v_new_status      text;
  v_existing        record;
  v_has_existing    boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_event
  from events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found';
  end if;

  if v_event.status in ('cancelled', 'completed') then
    raise exception 'Event is not open for joining';
  end if;

  -- Hard registration cutoff. Fires after status checks so cancelled/completed
  -- events take priority in user-facing error messages.
  if v_event.registration_closes_at is not null
     and now() > v_event.registration_closes_at then
    raise exception 'Registration is closed' using errcode = 'P0001';
  end if;

  -- Block direct join on paid events — payment must go through Stripe checkout
  if v_event.price_cents is not null and v_event.price_cents > 0 then
    raise exception 'Payment required to join this session';
  end if;

  select * into v_existing
  from event_participants
  where event_id = p_event_id and user_id = v_user_id;

  v_has_existing := found;

  if v_has_existing and v_existing.participant_status in ('joined', 'waitlist') then
    raise exception 'Already joined or on waitlist';
  end if;

  select count(*) into v_joined_count
  from event_participants
  where event_id = p_event_id and participant_status = 'joined';

  if v_joined_count < v_event.max_players then
    v_new_status := 'joined';
    if v_joined_count + 1 >= v_event.max_players then
      update events set status = 'full' where id = p_event_id;
    end if;
  else
    v_new_status := 'waitlist';
  end if;

  if v_has_existing then
    update event_participants
    set participant_status = v_new_status,
        payment_status = 'free',
        joined_at = now()
    where event_id = p_event_id and user_id = v_user_id;
  else
    insert into event_participants (event_id, user_id, participant_status, payment_status)
    values (p_event_id, v_user_id, v_new_status, 'free');
  end if;

  return json_build_object('status', v_new_status);
end;
$$;
