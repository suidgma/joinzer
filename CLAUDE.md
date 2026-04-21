# CLAUDE.md — Joinzer Build Brief

> Persistent memory for Claude Code. Read this first, every session, before writing or changing any code.

---

## 1. What We're Building

**Joinzer** — a mobile-first coordination platform for pickleball players to create, discover, and join local play sessions. Pilot market: Las Vegas metro area.

**Full product spec:** see `docs/joinzer_developer_handoff_v2.docx` (treat as source of truth for product behavior).

**This file:** the technical decisions and build rules the spec does NOT cover. If the spec and this file conflict on implementation details, this file wins.

---

## 2. Build Philosophy (Jet15 MVP Rules)

- Ship fast. This is an MVP, not a finished product.
- Simple > clever. Working > perfect.
- Core functionality first, polish later.
- No premature optimization, no overengineering, no speculative scaling.
- Small, focused changes. Preserve working code.
- If a task can be deferred to post-MVP, defer it.

---

## 3. Stack (Locked)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Backend | Supabase (Postgres + Auth + Realtime + RLS) |
| Auth | Supabase Auth — **magic link only** for MVP (no passwords) |
| Hosting | Vercel (frontend) + Supabase (backend) |
| Package manager | npm |
| Module system | ES modules (`import`/`export`) |

**Do not introduce:** Redux, tRPC, Prisma, custom ORMs, microservices, Docker, CI pipelines beyond Vercel's default. Supabase's built-in client is enough.

---

## 4. Security Rules — Non-Negotiable

- Never put API keys, passwords, tokens, or secrets in code files.
- Use environment variables for all sensitive data.
- `.env` and `.env.local` must be in `.gitignore` before the first commit.
- Supabase `service_role` key is server-side only. Never expose it to the browser or commit it.
- Use `anon` key on the frontend; rely on RLS for access control.
- If you encounter exposed secrets, stop and flag immediately.

---

## 5. Data Model Notes (adjustments to the spec)

The spec's `users` table includes `password_hash`. **Remove it.** Supabase Auth manages users in `auth.users`. Create a `profiles` table keyed by `auth.users.id`:

```sql
profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  profile_photo_url text,
  phone text,
  dupr_rating decimal(4,2),
  estimated_rating decimal(4,2),
  rating_source text check (rating_source in ('dupr_known','estimated','skipped')),
  created_at timestamptz default now()
)
```

All other tables per spec Section 11, with these amendments:

- `event_date` + `start_time` → replace with a single `starts_at timestamptz`. Display in `America/Los_Angeles` (Vegas pilot). Simpler, no timezone bugs.
- `participant_status` stays as enum: `joined | waitlist | left`.
- `events.status` enum: `open | full | cancelled | completed`.
- All FK columns must have `on delete` behavior explicitly set (cascade for participants/messages, restrict for captain/location).

---

## 6. Row Level Security (RLS) — Required Before First Deploy

Enable RLS on every table. Baseline policies:

**profiles**
- Select: any authenticated user can read any profile (needed to show participant names).
- Insert: user can insert row where `id = auth.uid()`.
- Update: user can update own row only.

**locations**
- Select: public (anon + authenticated).
- Insert/Update/Delete: service role only (admin-seeded).

**events**
- Select: any authenticated user.
- Insert: any authenticated user; `creator_user_id` and `captain_user_id` must equal `auth.uid()`.
- Update: only the current captain can update.
- Delete: only the current captain can delete (or just set `status = cancelled`).

**event_participants**
- Select: any authenticated user.
- Insert: user can insert row where `user_id = auth.uid()`.
- Update: user can update own row; captain can update any row in their event.
- Delete: user can delete own row.

**event_messages**
- Select: any authenticated user (MVP — tighten to participants only in v2).
- Insert: authenticated user, `user_id = auth.uid()`, and user must be a participant of that event.
- Update/Delete: author only.

---

## 7. Concurrency Rule for Join (Important)

Two users tapping Join on the last slot at the same time must not both end up `joined`. Implementation:

- Handle join server-side via a Supabase RPC (Postgres function) or a Next.js route handler using the service role.
- Inside the function: begin transaction, `SELECT ... FOR UPDATE` on the event row, count current `joined` participants, decide `joined` vs `waitlist`, insert.
- Do NOT do this logic in the browser with the anon key. Race condition guaranteed.

A single RPC `join_event(event_id uuid)` is the cleanest approach.

---

## 8. Waitlist Auto-Promotion

When a `joined` participant leaves:

- Handle in the same `leave_event` RPC (app-layer, transactional).
- Inside the function: delete/update the leaving row, then if any `waitlist` rows exist, promote the oldest one to `joined`.
- Do not build this as a database trigger. Keep it in the RPC so it's readable and debuggable.

---

## 9. Captain Rules

- Creator becomes captain on event insert. Enforce at insert time (not via trigger).
- Captain attempting to leave while others are joined: block with a clear error, prompt to reassign or cancel.
- Captain leaving when they are the only participant: allow, and cascade to `status = cancelled`.
- Reassignment endpoint: `POST /events/:id/assign-captain` — current captain only, target must already be a `joined` participant.

---

## 10. Chat (Realtime)

Use Supabase Realtime on `event_messages` — subscribe to inserts filtered by `event_id`. No polling, no custom websocket layer. One line of client setup.

---

## 11. Location Seed Data

- Appendix A of the spec has ~65 rows.
- Generate a single `supabase/seed.sql` file with every row. Do not hand-type a subset.
- Sort at query time by `court_count DESC, name ASC`. Do not pre-sort in the seed.
- Preserve `access_type` metadata (`public | private | resort | fee_based | business | directory | hoa | indoor_public | semi_private`) — use a text column with a check constraint rather than a Postgres enum, so adding new values later doesn't require a migration.

---

## 12. Project Structure

```
/app                    # Next.js App Router routes
  /api                  # Route handlers (thin — mostly proxying to Supabase RPCs)
  /(auth)               # Login, magic link callback
  /(app)                # Authenticated app shell
    /events             # List, detail, create
    /profile            # View/edit own profile
/components
  /ui                   # shadcn/ui primitives
  /features             # Feature-scoped components (events, chat, profile)
/lib
  /supabase             # Client + server helpers
  /utils                # Date formatting (Vegas TZ), capacity math, etc.
/supabase
  /migrations           # SQL migrations
  seed.sql              # Seed locations
/docs
  joinzer_developer_handoff_v2.docx  # Source spec
```

Keep files modular. If a component crosses ~200 lines, split it.

---

## 13. Coding Style

- TypeScript strict mode on.
- ES modules, `import`/`export`.
- `async`/`await`, not `.then()` chains.
- 2-space indent.
- Descriptive variable names. No single letters except loop counters.
- Comment *why*, not *what*. Skip obvious comments.
- Server Components by default; use `"use client"` only when needed (forms, realtime, interactivity).

---

## 14. How to Work With Marty

- Read existing code before changing it.
- Explain the approach in 1–2 sentences before implementing.
- Make small, focused changes. Don't rewrite.
- Preserve working functionality unless told otherwise.
- If a request seems off, ask before proceeding.
- If there's a faster/smarter path, flag it — don't derail, but flag it.
- Default to practical, working solutions.

---

## 15. Out of Scope for v1 (Do Not Build)

- Payments
- Court booking / reservation integration
- Ratings / reviews
- League management
- Push notifications (email magic link is enough for auth; no transactional push)
- Admin dashboard (seed via SQL, edit via Supabase Studio)
- Multi-region support (hardcode Vegas pilot in seed; keep schema region-agnostic)
- Native mobile apps (web is mobile-first and sufficient)

---

## 16. Definition of Done for MVP

The MVP is shippable when:

1. A new user can sign up via magic link, complete profile with optional DUPR, and land on the event feed.
2. Any user can create an event; creator is captain and first participant automatically.
3. Any user can join an event; if full, they go to waitlist. If someone leaves, the top waitlisted user is promoted.
4. Events show participant count, capacity, captain, and location (with court count).
5. Location dropdown on create-event is searchable and sorted by `court_count DESC, name ASC`.
6. Each event has a working realtime chat.
7. Captain rules (leave/reassign/cancel) behave per Section 9.
8. RLS is enabled on all tables with policies per Section 6.
9. Deployed to Vercel with Supabase connected via env vars.

Nothing beyond this list is required for v1.
