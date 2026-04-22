-- Migration 003: RPCs
-- All RPCs use security definer so they can bypass RLS and execute the
-- transactional logic safely server-side. auth.uid() is still used internally
-- so the caller's identity is always enforced.
--
-- join_event  — handles race-safe join and waitlist placement (CLAUDE.md §7)
-- leave_event — handles leave + waitlist auto-promotion (CLAUDE.md §8)
--               and captain leave rules (CLAUDE.md §9)
-- assign_captain — captain-only reassignment (CLAUDE.md §9)

-- ─── join_event ──────────────────────────────────────────────────────────────
create or replace function join_event(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
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

  -- Lock the event row first to prevent two concurrent joins racing for the
  -- last slot and both landing on 'joined' (CLAUDE.md §7).
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

  -- Check existing participation row (covers re-join after leaving)
  select * into v_existing
  from event_participants
  where event_id = p_event_id and user_id = v_user_id;

  -- Capture FOUND before any subsequent query overwrites it
  v_has_existing := found;

  if v_has_existing and v_existing.participant_status in ('joined', 'waitlist') then
    raise exception 'Already joined or on waitlist';
  end if;

  select count(*) into v_joined_count
  from event_participants
  where event_id = p_event_id and participant_status = 'joined';

  if v_joined_count < v_event.max_players then
    v_new_status := 'joined';
    -- Mark event full if this join fills the last slot
    if v_joined_count + 1 >= v_event.max_players then
      update events set status = 'full' where id = p_event_id;
    end if;
  else
    v_new_status := 'waitlist';
  end if;

  if v_has_existing then
    -- Re-joining after a previous leave: update the existing row
    update event_participants
    set participant_status = v_new_status,
        joined_at = now()
    where event_id = p_event_id and user_id = v_user_id;
  else
    insert into event_participants (event_id, user_id, participant_status)
    values (p_event_id, v_user_id, v_new_status);
  end if;

  return json_build_object('status', v_new_status);
end;
$$;

-- ─── leave_event ─────────────────────────────────────────────────────────────
create or replace function leave_event(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id          uuid := auth.uid();
  v_event            record;
  v_participant      record;
  v_next_waitlisted  record;
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

  select * into v_participant
  from event_participants
  where event_id = p_event_id
    and user_id = v_user_id
    and participant_status in ('joined', 'waitlist');

  if not found then
    raise exception 'Not an active participant of this event';
  end if;

  -- ── Captain leave rules (CLAUDE.md §9) ──────────────────────────────────
  if v_event.captain_user_id = v_user_id then
    if exists (
      select 1 from event_participants
      where event_id = p_event_id
        and user_id != v_user_id
        and participant_status = 'joined'
    ) then
      -- Other joined participants exist: block until captain reassigns
      raise exception 'Captain must reassign captainship before leaving while other participants are joined';
    else
      -- Captain is alone (or only waitlisted others): cancel the event
      update events set status = 'cancelled' where id = p_event_id;
    end if;
  end if;

  -- Mark participant as left
  update event_participants
  set participant_status = 'left'
  where event_id = p_event_id and user_id = v_user_id;

  -- ── Waitlist auto-promotion (CLAUDE.md §8) ───────────────────────────────
  -- Only applies when a 'joined' participant leaves a non-cancelled event.
  if v_participant.participant_status = 'joined' and v_event.status != 'cancelled' then
    select * into v_next_waitlisted
    from event_participants
    where event_id = p_event_id and participant_status = 'waitlist'
    order by joined_at asc
    limit 1;

    if found then
      -- Promote oldest waitlisted participant; joined count stays the same
      update event_participants
      set participant_status = 'joined'
      where id = v_next_waitlisted.id;
    else
      -- No waitlist: open the slot back up
      if v_event.status = 'full' then
        update events set status = 'open' where id = p_event_id;
      end if;
    end if;
  end if;

  return json_build_object('status', 'left');
end;
$$;

-- ─── assign_captain ───────────────────────────────────────────────────────────
create or replace function assign_captain(p_event_id uuid, p_new_captain_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from events
    where id = p_event_id and captain_user_id = v_user_id
  ) then
    raise exception 'Only the current captain can reassign captainship';
  end if;

  if not exists (
    select 1 from event_participants
    where event_id = p_event_id
      and user_id = p_new_captain_id
      and participant_status = 'joined'
  ) then
    raise exception 'New captain must be a joined participant';
  end if;

  update events
  set captain_user_id = p_new_captain_id
  where id = p_event_id;
end;
$$;
