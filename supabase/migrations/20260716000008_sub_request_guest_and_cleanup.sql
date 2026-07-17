-- Phase 6: guest substitute representation + legacy deprecation.
-- (docs/phases/substitutions-implementation-plan.md — final consolidation.)
--
-- Additive only. Lets a box/ladder organizer guest assignment carry an authoritative
-- league_sub_requests record (fulfillment_mode='organizer_assigned', status='filled',
-- filled_by_user_id NULL, filled_by_guest_name set) — no fake user account, no separate guest table.

alter table public.league_sub_requests
  add column if not exists filled_by_guest_name text;

comment on column public.league_sub_requests.filled_by_guest_name is
  'Guest substitute display name for organizer_assigned records where the substitute has no Joinzer '
  'account (filled_by_user_id stays NULL). Display/audit only — never a contact detail. The guest''s '
  'attendance placement is the authoritative participation row (league_attendance.subbing_for_...).';

-- Deprecate the legacy claim/approve columns: retained for historical audit, never written by live
-- code (Phase 6 removed the claim/approve flow). Left in place — dropping them is unnecessary
-- destructive risk with no benefit.
comment on column public.league_sub_requests.claimed_by_user_id is
  'DEPRECATED (Phase 6). Historical only — the claim step was removed; acceptance is the atomic '
  'accept_sub_request RPC. No live code reads or writes this.';
comment on column public.league_sub_requests.approved_by_user_id is
  'DEPRECATED (Phase 6). Historical only — organizer approval was removed. No live code reads or writes this.';

comment on table public.sub_nominations is
  'Player-picks-own-substitute for the Play + tournament surfaces ONLY (applies immediately, no '
  'approval). League substitutions moved entirely to the unified league_sub_requests model in Phase 3; '
  'the surface=''league'' branch was removed in Phase 6. Any historical surface=''league'' rows are '
  'legacy records — no live workflow reads them.';
