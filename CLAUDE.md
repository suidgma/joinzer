# CLAUDE.md — Joinzer Quick Reference

> Daily reference for Claude Code. Read this at session start.
> For detailed schemas, RLS policies, and technical specs, see **CLAUDE_DETAILED.md**.

---

## 1. What We're Building

**Joinzer** is a mobile-first pickleball platform with **four product surfaces** sharing one app, one auth, one database:

1. **Coordination** — players create, discover, and join local play sessions ("find a game tonight"). Original MVP.
2. **Leagues** — recurring competitive play with persistent rosters, weekly sessions, season standings.
3. **Tournaments** — discrete events with divisions and registrations.
4. **Players** — searchable directory of players with profiles, ratings, history, and connections.

**Pilot market:** Las Vegas metro (Henderson, Summerlin, Green Valley, North Las Vegas).

All four surfaces share users, profiles, locations. Bottom nav: Home / Play / Leagues / Tournaments / Players / Profile.

---

## 2. Product North Star

- **Coordination**: Player-first. Speed of "find a game and show up" is the metric.
- **Leagues**: Organizer-and-captain-first. Season reliability and roster fairness are the metrics.
- **Tournaments**: Organizer-first. Tournament-day reliability and the player↔organizer loop are the metrics.
- **Players**: Discovery-first. Finding the right partner, opponent, or community is the metric.
- Setup surfaces are desktop-first. Day-of and player-facing surfaces are mobile-first. See `/docs/phases/two-form-factor.md`.

---

## 3. Build Philosophy

- Small, focused changes. Preserve working code.
- Read existing code before changing it.
- ES modules, async/await, TypeScript strict.
- One concern per slice. Data model changes and layout changes do not share a PR.
- Update CLAUDE.md as the last step of any session that changes structure, schema, or status. Drift is the enemy.

---

## 4. Stack (Actual)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript strict |
| Styling | Tailwind CSS only (no shadcn/ui, no Radix) |
| Icons | lucide-react |
| Backend | Supabase (Postgres + Auth + RLS) |
| Auth | Production: email/password + Google OAuth. Original spec was magic-link; production is canonical. |
| Hosting | Vercel (frontend) + Supabase (backend) |
| Notifications | Not yet implemented |
| Payments | Not yet implemented |

**Do not introduce:** shadcn/ui, Radix, Redux, tRPC, Prisma, custom ORMs, Docker, CI pipelines beyond Vercel default.

---

## 5. Current State — Verified May 11, 2026

This section describes **what is actually in the database and codebase right now**, verified against Supabase Table Editor and live routes. The previous CLAUDE.md claimed Phase 1 was complete with a unified `competitions` schema. **That was not true.** This section corrects that.

### Database tables that exist

**Coordination (shipped, working):**
- `events`, `event_participants`, `profiles`, `locations`, `organizations`

**Tournaments (separate domain, shipped, working):**
- `tournaments`, `tournament_divisions`, `tournament_events`, `tournament_matches`, `tournament_messages`, `tournament_registrations`, `tournament_team_invit...` (truncated in screenshot)

**Leagues (separate domain, shipped, working):**
- `leagues`, `league_registrations`, `league_rounds`, `league_round_matches`, `league_sessions`, `league_session_attendance`, `league_session_players`, `league_session_subs`, `league_sub_interest`, `league_sub_requests`

**Other:**
- `player_availability`, `session_ratings`

### Tables that do NOT exist (despite previous doc claims)

- `competitions` (unified parent table) — not built
- `competition_divisions`, `competition_courts`, `competition_teams`, `competition_team_members`, `competition_matches`, `competition_announcements` — not built
- `league_attendance`, `league_sub_credits`, `league_sub_pool` (as named in detailed doc) — different names used in live DB
- `notifications`, `audit_log`, `platform_stats_mv` — not built
- `player_stats_mv`, `player_connections` — not built

### Routes that exist

- `/(app)/tournaments/create` — single-page form, refactored in Slice 1, writes to `tournaments` table via direct `.insert()`
- `/(app)/compete/tournaments/create` — second create route (different form), also writes to `tournaments` table; not yet reconciled with the primary create route
- `/(app)/tournaments/[id]` — manage view (organizer + player branches in one page); refactored in Slice 2 with `DesktopShell` + `ManageNav`
- `/(app)/tournaments/[id]/edit` — edit form; exists, not yet refactored
- `/(app)/tournaments/[id]/organizer/_components/` — organizer Live/Schedule/Standings/Players tabs implemented as client-side tab state inside `TournamentOrganizerView`, NOT as separate sub-routes; Slice 3 will create the actual sub-routes

### Phase status (corrected)

- **Phase 0 (Coordination MVP):** Shipped.
- **Tournaments product:** Shipped at basic functionality level, parallel domain to coordination.
- **Leagues product:** Shipped at basic functionality level, parallel domain to coordination.
- **Phase 1 (unified competitions schema as described in CLAUDE_DETAILED.md):** *Not built.* This is aspiration, not reality. The detailed doc describes a target state we have not migrated to.
- **Two-form-factor refactor:** In progress. See `/docs/phases/two-form-factor.md`. Slices 0–2 shipped (primitives, `/tournaments/create`, `/tournaments/[id]`). Slice 3 (tournament sub-routes) is next.

---

## 6. Open Decisions (Real)

These are the actual unresolved decisions, not the ones the previous doc claimed:

- **Schema reconciliation:** Live DB has separate `tournaments` and `leagues` domains. CLAUDE_DETAILED.md describes a unified `competitions` schema that doesn't exist. **Do we migrate (Path B) or accept the duplication (Path A)?** Deferred until an organizer has been spoken to.
- **Second tournament create route:** `/compete/tournaments/create` exists alongside `/tournaments/create`. Is it dead code, a feature branch, or intentional? Audit before Slice 2.
- **Auth model:** Production uses email/password + Google OAuth. Original spec was magic-link. Production is canonical; spec is stale. Reconcile docs.
- **First committed event date:** None. No organizer has seen the product yet.
- **Organizer conversation:** Not yet booked. This is blocking informed product decisions.

---

## 7. Coding Style

- TypeScript strict mode
- ES modules, `import`/`export`
- `async`/`await`, not `.then()` chains
- 2-space indent
- Descriptive variable names; no single letters except loop counters
- Comment *why*, not *what*
- Server Components by default; `"use client"` only when needed
- Tailwind only; lucide-react for icons; no shadcn/ui
- One file = one concern; split early (target under 250 lines per file)

---

## 8. How to Work With Marty

- Read existing code before changing it
- Explain the approach in 1–2 sentences before implementing
- Make small, focused changes; preserve working code
- If a request seems off, ask before proceeding
- Flag faster/smarter paths without derailing the current task
- Default to practical, working solutions
- If a doc claim contradicts the codebase, the codebase wins. Flag the contradiction immediately and stop.
- The last step of any code-changing session: update CLAUDE.md and the relevant phase doc to reflect what shipped.

---

## 9. Security Rules — Non-Negotiable

- Never put API keys, passwords, tokens, or secrets in code files
- Use environment variables for all sensitive data
- `.env` and `.env.local` must be in `.gitignore`
- Supabase `service_role` key is server-side only
- Use Supabase `anon` key on the frontend; rely on RLS for access control
- Player PII never returned by public/anon APIs
- If you encounter exposed secrets, stop and flag immediately

---

## Quick Links

- **Two-form-factor refactor plan:** `/docs/phases/two-form-factor.md`
- **Target architecture (aspirational, not current):** `CLAUDE_DETAILED.md` — treat as design ideas, not current state

---

*Last verified against repo: May 11, 2026*
*Previous version overclaimed Phase 1 completion. Corrected.*
