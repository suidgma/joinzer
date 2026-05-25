-- Backfill: normalize free-registration payment_status to 'waived'.
--
-- Before the free-registration fix (PRs fix/free-reg-waived), three insert paths wrote
-- free-equivalent values other than 'waived':
--   1. tournament_registrations: team/organizer-add/waitlisted-solo in free divisions
--      got the DB default 'unpaid'. Broken capacity counting (active filter is
--      IN('paid','waived'), so these rows were invisible to capacity checks).
--   2. tournament_registrations: register_doubles_pair RPC hardcoded 'unpaid'.
--      Same capacity issue on the organiser-doubles path.
--   3. league_registrations: league-register route wrote no payment_status, relying on
--      the DB default 'free'. invite-accept route hardcoded 'free'.
--      League capacity is status-only so no counting bug, but value was inconsistent.
--
-- This migration corrects all pre-fix rows. Safe to re-run (WHERE guards are idempotent).

-- ── Group 1 + 2: tournament registrations ──────────────────────────────────────────
-- Any 'unpaid' row whose division has cost_cents NULL or 0 should be 'waived'.
-- Covers team regs, organizer-adds, waitlisted solos, and RPC-created doubles pairs.
UPDATE public.tournament_registrations tr
SET    payment_status = 'waived'
FROM   public.tournament_divisions td
WHERE  tr.division_id    = td.id
  AND  tr.payment_status = 'unpaid'
  AND  (td.cost_cents IS NULL OR td.cost_cents = 0);

-- ── Group 3: league registrations (old default 'free') ─────────────────────────────
-- All 'free' rows pre-date the fix; free leagues have no per-player fee so 'waived'.
UPDATE public.league_registrations
SET    payment_status = 'waived'
WHERE  payment_status = 'free';

-- ── Group 4: league registrations safety net ('unpaid' in free leagues) ────────────
-- The league-register route returns 402 for paid leagues, so 'unpaid' rows in free
-- leagues should not exist — but clean them up defensively.
UPDATE public.league_registrations lr
SET    payment_status = 'waived'
FROM   public.leagues l
WHERE  lr.league_id      = l.id
  AND  lr.payment_status = 'unpaid'
  AND  (l.cost_cents IS NULL OR l.cost_cents = 0);
