-- Post-generation, RECORD-ONLY organizer correction of a filled substitute request.
-- (docs/phases/substitutions-implementation-plan.md §2.6; ADR-06 amendment in docs/decisions.md.)
--
-- The problem this closes: organizer_correct_sub_request calls _sub_occasion_open, which raises
-- 'generation_started' the moment league_rounds (RR) / league_fixtures (box/ladder) exist. So once
-- play is generated the organizer is frozen out entirely — a substitute who accepts and then
-- no-shows leaves the request reading "filled by X" forever, with no way to say otherwise.
--
-- What this does NOT do, deliberately: it never touches league_session_players, league_attendance,
-- league_rounds, league_fixtures or league_session_attendance. Rewriting generated placement is
-- still unsupported and still fails loudly. Only the REQUEST RECORD moves.
--
-- ADR-06 carve-out (approved): the acceptance-checklist invariant "filled <=> a placement row
-- exists" becomes conditional. After this closes a record, a placement row exists with no 'filled'
-- request. Four constraints bound that, and all four are enforced here or provable:
--   1. the function REFUSES unless the standard reversal path is already unavailable (see the
--      inverted guard below), so divergence is impossible outside the post-generation window;
--   2. record_closed_reason makes the state self-describing rather than silently odd;
--   3. every close writes an audit_log row carrying placement_left_in_place = true;
--   4. standings are unaffected — no standings path reads league_sub_requests, and sub_credit_cap
--      applies through the placement rows (lib/leagues/assignRrSub.ts, assignAttendanceSub.ts).
--
-- Additive: one nullable column + one new function. Existing rows and RPCs are untouched.

-- ── 1. Why the record was closed (nullable; NULL on every pre-existing row) ───────────────────────
alter table public.league_sub_requests
  add column if not exists record_closed_reason text;

alter table public.league_sub_requests drop constraint if exists league_sub_requests_record_closed_reason_check;
alter table public.league_sub_requests
  add constraint league_sub_requests_record_closed_reason_check
  check (record_closed_reason is null or record_closed_reason in ('no_show', 'other'));

comment on column public.league_sub_requests.record_closed_reason is
  'Set ONLY by organizer_close_sub_request_record: why a filled request was closed to cancelled '
  'AFTER play was generated, without reversing placement. NULL everywhere else, including ordinary '
  'organizer cancels (which do reverse). A non-NULL value is the marker that this row deliberately '
  'diverges from its placement — see the ADR-06 amendment in docs/decisions.md.';

-- ── 2. organizer_close_sub_request_record — record-only close, post-generation only ───────────────
-- A SEPARATE function rather than a mode on organizer_correct_sub_request: every branch of that RPC
-- calls _reverse_sub_placement unconditionally, so a "skip the guard" flag would have to suppress
-- two behaviours at once — exactly the shape that lets a later caller reverse a placement it meant
-- to keep. Separate function => separate EXECUTE grant, an inverted guard that reads as intentional,
-- and zero behavioural change to a security-sensitive RPC that already works.
create or replace function public.organizer_close_sub_request_record(
  p_actor_id uuid, p_request_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.league_sub_requests;
  v_sub uuid; v_guest text; v_guard text;
begin
  if p_reason is null or p_reason not in ('no_show', 'other') then raise exception 'bad_request'; end if;

  select * into r from public.league_sub_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'filled' then raise exception 'not_filled'; end if;

  -- INVERTED GUARD — the correctness crux of this function.
  -- Reuse the ONE existing definition of "is this occasion still correctable normally" instead of
  -- writing an inverted copy that can drift from it. If _sub_occasion_open does NOT raise, the
  -- ordinary reopen/cancel path still works and MUST be used (it reverses placement properly), so
  -- refuse. If it raises, accept ONLY the two post-start codes and re-raise everything else — in
  -- particular 'occasion_not_found', which is a broken row, not a started occasion.
  v_guard := null;
  begin
    perform public._sub_occasion_open(r);
  exception when others then
    v_guard := sqlerrm;
    if v_guard not in ('generation_started', 'occasion_started') then raise; end if;
  end;
  if v_guard is null then raise exception 'use_standard_correction'; end if;

  v_sub := r.filled_by_user_id;
  v_guest := r.filled_by_guest_name;

  -- filled_by_user_id / filled_at are DELIBERATELY PRESERVED here, unlike every branch of
  -- organizer_correct_sub_request, which nulls them. A no-show has to stay attributable: clearing
  -- the assignee would erase the only record of who failed to appear. Readers must therefore not
  -- assume "cancelled => filled_by_user_id is null" (see the column comment above).
  update public.league_sub_requests
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = p_actor_id,
         record_closed_reason = p_reason,
         updated_at = now()
   where id = r.id;

  -- notification_generation is deliberately NOT bumped: nothing reopens, so no new substitute wave.

  insert into public.audit_log (actor_id, entity_type, entity_id, action, before, after)
  values (p_actor_id, 'league_sub_request', r.id, 'sub_request_record_closed',
    jsonb_build_object('status', 'filled', 'filled_by_user_id', v_sub, 'filled_by_guest_name', v_guest),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason, 'league_id', r.league_id,
      'requesting_player_id', r.requesting_player_id, 'filled_by_user_id', v_sub,
      'filled_by_guest_name', v_guest, 'placement_left_in_place', true, 'occasion_guard', v_guard));

  -- NOTE the key name: 'closed_sub', NOT 'removed_sub'. The organizer-correct route's side-effect
  -- handler keys the "the organizer removed you from this substitute spot" notification off
  -- removed_sub — a message that would be factually FALSE here, since the placement stands. Using a
  -- different key makes that mis-fire structurally impossible rather than merely unlikely.
  return jsonb_build_object('ok', true, 'request_id', r.id, 'status', 'cancelled',
    'record_closed_reason', p_reason, 'closed_sub', v_sub, 'closed_guest_name', v_guest,
    'league_id', r.league_id,
    'scope', case when r.league_session_id is not null then 'session' else 'period' end,
    'session_id', r.league_session_id, 'period_id', r.league_period_id);
end; $$;

-- ── 3. Lock down execution — service_role only (the route authenticates and passes the actor) ─────
-- CORRECTION (2026-08-06, migration 20260806000003): the two lines below DID NOT achieve that, and
-- the claim was false from the moment this shipped. Supabase grants EXECUTE on new public functions
-- DIRECTLY to anon/authenticated, not via the PUBLIC pseudo-role, so `revoke all ... from public`
-- revokes a grant that was never the access path — anon retained EXECUTE. The same defect affected
-- all 14 substitution RPCs, and 20260710000004 had already documented it for the registration RPCs
-- six days before this file was written. Fixed by 20260806000003, which revokes from the roles by
-- name. Left in place rather than rewritten: this migration is already applied, so editing it would
-- change history without changing the database, and the revoke is still correct as far as it goes.
revoke all on function public.organizer_close_sub_request_record(uuid, uuid, text) from public;
grant execute on function public.organizer_close_sub_request_record(uuid, uuid, text) to service_role;

comment on function public.organizer_close_sub_request_record(uuid, uuid, text) is
  'Post-generation RECORD-ONLY close of a filled substitute request: filled -> cancelled with '
  'record_closed_reason, preserving filled_by_user_id, WITHOUT reversing or rewriting placement. '
  'Refuses with use_standard_correction while the ordinary reopen/cancel path is still available. '
  'Touches no placement, attendance, round or fixture row. service_role only.';
