# Security Rules — Joinzer

> Evergreen. Auto-loaded every session via the `@docs/security.md` import in `/CLAUDE.md`.
> The global `~/.claude/CLAUDE.md` has its own overlapping "Security — Non-Negotiable" section; these project rules extend it.
> Last revised: July 10, 2026.

These rules apply to every session, every file, every commit on Joinzer.

## Secrets

- Never put API keys, passwords, tokens, or secrets in code files. Use environment variables.
- `.env` / `.env.local` must be in `.gitignore`; never commit them.
- **Server-only** secrets — never in client code, never prefixed `NEXT_PUBLIC_`, never committed: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`.
- If you encounter an exposed secret, stop and flag immediately.

## Supabase keys

- The `service_role` key is **server-side only** — never in client code, never `NEXT_PUBLIC_*`, never committed. It **bypasses RLS**.
- The `anon` key is fine on the frontend; rely on RLS for what it can read/write.

## Server writes & authorization (the real model)

- Most sensitive writes are **direct service-role table writes inside API routes**, not database RPCs. Only a few flows use `SECURITY DEFINER` RPCs (registration, checkout, event join/leave, the Stripe webhook).
- Because service-role bypasses RLS, **the API route is the security boundary.** Every mutating route (and every RPC) must, *before* it writes:
  1. authenticate the caller (`supabase.auth.getUser()`), and
  2. authorize them for that *specific* action — organizer / co-admin / participant / self. Never trust a client-supplied user id, role, or ownership claim; re-derive it server-side.
- Validate and normalize inputs server-side (scores, emails, gender, etc.). Never persist client-computed authority.

## RLS

- Enable RLS on **every** table. Many tables are intentionally **deny-all** (RLS on, no policy) and touched only by server code via the service role — the default for anything not meant for direct client reads (ratings, stats, achievements, fixtures, attendance, ladder/box/team, audit_log, …). A Supabase "RLS enabled, no policy" advisory on these is expected, not a bug.
- Where a table **is** client-readable, its RLS policy is the guard — keep policies least-privilege. Avoid `USING (true)` / `WITH CHECK (true)` for INSERT/UPDATE/DELETE (a service-role write doesn't need a permissive public policy).
- A sensitive column on an otherwise client-readable table is hidden with **column-level GRANTs** (e.g. `stripe_payment_intent_id` on the registration tables): table-level `SELECT` is revoked and only the safe columns are granted to `anon`/`authenticated`. Consequence — **a new column on such a table isn't client-readable until you `GRANT SELECT (col)` on it**; do so when the client needs to read it.
- Verify policies before assuming they work. Two clean ways to test a policy without a browser: (a) a scripted authed supabase-js client, or (b) in SQL — `begin; set local role authenticated; set local request.jwt.claims to '{"sub":"<user-uuid>"}'; <query>; rollback;`.
- **Membership-scoped reads** (a member can read/write only their own entity's rows) are checked with a `SECURITY DEFINER` helper function (locked `search_path`), NOT a bare `EXISTS` subquery — because an `EXISTS` against a deny-all membership table inside a policy is itself subject to that table's RLS and would always be false. Pattern: `is_{league,tournament,event}_chat_member(id)` gate the chat message tables' SELECT/INSERT (migration `20260714000006`). `auth.uid()` still resolves to the caller inside a `SECURITY DEFINER` function.
- **Visibility-scoped league reads** (migration `20260721000002`): leagues are NOT deny-all — the `leagues` table and its client-readable children are gated by `SECURITY DEFINER` helpers `can_read_league(league_id)` (public non-dummy league OR creator OR self-run season host OR non-cancelled registration) and `can_read_league_session(session_id)` (session→league delegate). **Any new client-readable `league_*` child table must scope its SELECT policy through one of these** (`USING(can_read_league(league_id))` or `…_session(session_id)`), never `USING(true)` — otherwise private-league data leaks to anon (public-role tables) or to any logged-in user (authenticated-role tables). Server-rendered member/organizer views + public `/l/[id]` + the `/subs` loader read child data via the **service role** (bypasses RLS), so scoping children doesn't break them. (Tournaments use a different shape: the `tournaments` table blocks drafts/private for anon via `status='published' AND visibility='public'`, but its child tables are still `USING(true)` — a pending hardening slice.)
- **Realtime + RLS-scoped SELECT:** tightening a SELECT policy from `USING(true)` to anything needing `auth.uid()` (or even `to authenticated`) means `postgres_changes` on that table **only delivers to an authenticated realtime socket**. The app authenticates the socket in `RealtimeProvider` via `supabase.realtime.setAuth()`; without it, live updates silently stop (the row is still visible on a normal authed SELECT, so it looks fine until you check realtime). Keep this in mind before scoping any client-readable table that also drives realtime.

## Player PII

- PII = full name, phone, email, payment info, exact home location.
- Player PII is **never** returned by public/anon APIs. Public-browse and profile/résumé loaders select only PII-safe columns — never email/phone.
- Public/browse surfaces mask to first names; no contact info; no exact home location.
- Honor the player's own visibility settings: `profiles.discoverable` (directory + public-profile opt-out) and the `email_visibility` / `phone_visibility` tiers. Exclude `dummy` accounts from public directories.

## Payments (live — Stripe)

- Stripe **secret** key is server-side only; the publishable key is fine on the frontend.
- The Stripe **webhook must verify the signature** (`STRIPE_WEBHOOK_SECRET`) before trusting any event — treat unsigned/invalid as untrusted.
- Payment and refund state changes happen server-side (route/webhook) and are audit-logged.

## Webhooks & cron

- Webhook handlers verify their signature/secret before acting on the payload.
- Cron endpoints (e.g. nightly rating/stats/achievements recompute) are guarded by `CRON_SECRET` — reject any request without it.

## Audit

- Log sensitive state changes (scoring, registration cancel/withdraw/refund, sub claim/approve, etc.) via `lib/audit/log.ts`. Audit writes are best-effort and must never block the user path.
