-- Pre-session "still no substitute" warning: dedupe key.
--
-- The problem: the only notification a requester gets when nobody picks up their request is the
-- post-expiry "No substitute was found", emitted by the daily cron AFTER expire_sub_requests has
-- swept the row. expires_at for a session-scoped request IS the session start, so a 6pm session
-- that went uncovered notified the requester at ~3am the next morning — after the game. The notice
-- was true and useless.
--
-- The fix needs no new cron. /api/cron/expire-sub-requests already runs at 0 11 * * * UTC = 3am PDT
-- / 4am PST, i.e. the morning OF that evening's sessions, so a pass placed BEFORE the expiry sweep
-- warns roughly 15 hours out, while the requester and organizer can still do something about it.
--
-- This column is the dedupe key. It is deliberately NOT a row in sub_request_notifications: that
-- table means "candidates notified about this request" and explicitly excludes the requester
-- (lib/subs/candidates.ts), so writing requester rows into it would silently inflate any future
-- count of how many substitutes were pinged. Keying on the generation instead means:
--   * no index change, and no edit to the withdraw/reopen RPCs;
--   * a reopen bumps notification_generation, so the request becomes warnable again automatically —
--     the reset is a consequence of the existing design rather than a second thing to remember.
--
-- Warn when unfilled_warned_generation IS DISTINCT FROM notification_generation.
-- Additive: one nullable column. NULL on every pre-existing row, which correctly reads as
-- "never warned".

alter table public.league_sub_requests
  add column if not exists unfilled_warned_generation integer;

comment on column public.league_sub_requests.unfilled_warned_generation is
  'notification_generation at which the requester was last warned that this request is still '
  'unfilled with the session approaching. NULL = never warned. Compared with IS DISTINCT FROM '
  'against notification_generation, so a reopen (which bumps the generation) re-arms the warning '
  'with no extra bookkeeping. Session-scoped requests only — periods carry no clock, so they have '
  'no moment to warn at and keep the post-expiry notice instead.';

-- Supports the daily "warnable soon" scan: open requests with a clock, ordered by when they die.
create index if not exists league_sub_requests_unfilled_warning_idx
  on public.league_sub_requests (expires_at)
  where status = 'open' and expires_at is not null;
