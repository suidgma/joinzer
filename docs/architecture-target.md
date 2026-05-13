# Architecture Target — Joinzer

> ⚠️ **This is a design proposal, not current state.**
> Reality lives in `/CLAUDE.md` and the codebase.
> Last revised: May 11, 2026. Treat anything older than 8 weeks as suspect until re-verified.

This document describes the **unified competitions architecture** Joinzer may migrate to. It is not implemented. Tables, RPCs, RLS policies, and marketing pages described here do not exist unless explicitly confirmed in `/CLAUDE.md`.

The migration decision (Path A: keep separate `tournaments`/`leagues` domains, vs. Path B: unify under `competitions`) is **deferred until an organizer conversation lands.** Until then, this is reference material for that decision, not a build plan.

---

## Domain Model (Target)

Unified `competitions` parent table with `kind in ('league','tournament')`. All four surfaces (coordination, leagues, tournaments, players) share core tables; leagues/tournaments add their own.

### Shared

```sql
profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  display_name text,
  email text,
  profile_photo_url text,
  phone text,
  bio text,
  home_location_id uuid references locations(id),
  dupr_rating decimal(4,2),
  estimated_rating decimal(4,2),
  rating_source text check (rating_source in ('dupr_known','estimated','skipped')),
  push_subscription jsonb,
  notification_prefs jsonb default '{}'::jsonb,
  discoverable boolean default true,
  created_at timestamptz default now()
)

locations (
  id uuid primary key,
  name text not null,
  slug text unique,
  address text,
  neighborhood text,
  court_count int,
  access_type text check (access_type in (
    'public','private','resort','fee_based','business',
    'directory','hoa','indoor_public','semi_private'
  )),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
)

notifications (
  id uuid primary key,
  recipient_id uuid not null references profiles(id),
  surface text not null check (surface in ('event','league','tournament','system')),
  surface_id uuid,
  kind text not null,
  title text not null,
  body text,
  deep_link text,
  payload jsonb default '{}'::jsonb,
  sent_at timestamptz default now(),
  read_at timestamptz
)

audit_log (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
)

platform_stats_mv (
  total_players int,
  total_courts int,
  events_this_week int,
  active_leagues int,
  upcoming_tournaments int,
  refreshed_at timestamptz
)
```

### Competitions (Leagues + Tournaments)

```sql
competitions (
  id uuid primary key,
  organizer_id uuid not null references profiles(id),
  kind text not null check (kind in ('league','tournament')),
  slug text unique,
  name text not null,
  description text,
  template text not null,
  location_id uuid references locations(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  registration_deadline timestamptz,
  registration_fee_cents int default 0,
  payment_provider text,
  status text not null default 'draft' check (status in (
    'draft','published','registration_open','registration_closed',
    'in_progress','completed','cancelled'
  )),
  visibility text not null default 'public' check (visibility in (
    'public','private','invite_only'
  )),
  format_config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
)

competition_divisions (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  name text not null,
  skill_min decimal(4,2),
  skill_max decimal(4,2),
  age_min int,
  age_max int,
  gender text check (gender in ('open','mens','womens','mixed')),
  team_size int not null default 2,
  max_teams int,
  format_override jsonb,
  status text default 'open',
  created_at timestamptz default now()
)

competition_courts (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  court_number int not null,
  display_name text,
  status text default 'idle' check (status in ('idle','in_use','unavailable')),
  unique (competition_id, court_number)
)

competition_teams (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  division_id uuid not null references competition_divisions(id) on delete cascade,
  display_name text,
  registration_status text default 'pending' check (registration_status in (
    'pending','confirmed','waitlisted','withdrawn'
  )),
  payment_status text default 'unpaid' check (payment_status in (
    'unpaid','paid','refunded','waived'
  )),
  waiver_status text default 'pending' check (waiver_status in (
    'pending','signed','not_required'
  )),
  created_at timestamptz default now()
)

competition_team_members (
  id uuid primary key,
  team_id uuid not null references competition_teams(id) on delete cascade,
  player_id uuid not null references profiles(id),
  is_captain boolean default false,
  unique (team_id, player_id)
)

competition_matches (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  division_id uuid not null references competition_divisions(id) on delete cascade,
  session_id uuid references league_sessions(id),
  court_id uuid references competition_courts(id),
  team_a_id uuid references competition_teams(id),
  team_b_id uuid references competition_teams(id),
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  status text not null default 'pending' check (status in (
    'pending','ready','in_progress','completed','disputed','forfeited'
  )),
  game_scores jsonb default '[]'::jsonb,
  winner_team_id uuid references competition_teams(id),
  source text,
  match_number int,
  created_at timestamptz default now()
)

competition_announcements (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  audience jsonb default '{"all":true}'::jsonb,
  pinned boolean default false,
  created_at timestamptz default now()
)
```

### Leagues Only

```sql
league_sessions (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  session_number int not null,
  scheduled_at timestamptz not null,
  status text default 'scheduled' check (status in (
    'scheduled','in_progress','completed','cancelled'
  )),
  created_at timestamptz default now(),
  unique (competition_id, session_number)
)

league_attendance (
  id uuid primary key,
  session_id uuid not null references league_sessions(id) on delete cascade,
  player_id uuid not null references profiles(id),
  team_id uuid references competition_teams(id),
  attendance_status text not null check (attendance_status in (
    'present','absent','sub_in','sub_out'
  )),
  sub_for_player_id uuid references profiles(id),
  created_at timestamptz default now(),
  unique (session_id, player_id)
)

league_sub_credits (
  id uuid primary key,
  competition_id uuid not null references competitions(id) on delete cascade,
  player_id uuid not null references profiles(id),
  session_id uuid not null references league_sessions(id),
  credited_points int not null,
  reason text,
  created_at timestamptz default now()
)

league_sub_pool (
  competition_id uuid references competitions(id) on delete cascade,
  player_id uuid references profiles(id),
  available_dates jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  primary key (competition_id, player_id)
)
```

### Players Directory

```sql
player_stats_mv (
  player_id uuid primary key references profiles(id),
  total_games int,
  total_wins int,
  win_rate decimal(4,3),
  events_played int,
  leagues_played int,
  tournaments_played int,
  tournaments_won int,
  preferred_partner_ids uuid[],
  last_active_at timestamptz,
  refreshed_at timestamptz
)

player_connections (
  follower_id uuid references profiles(id),
  followed_id uuid references profiles(id),
  kind text default 'follow' check (kind in ('follow','partner','blocked')),
  created_at timestamptz default now(),
  primary key (follower_id, followed_id)
)
```

### Required indexes

- `competition_matches (competition_id, status)`
- `competition_matches (court_id) where status in ('ready','in_progress')`
- `competition_matches (session_id)`
- `league_attendance (session_id, attendance_status)`
- `notifications (recipient_id, read_at)`
- `audit_log (entity_type, entity_id, created_at desc)`
- `profiles (discoverable, dupr_rating)`
- `competitions (status, kind, starts_at)`
- `locations (slug)`

---

## Templates (Target)

### Tournament templates

| Template | Fields exposed | Defaults |
|---|---|---|
| `casual_round_robin` | name, location, date, time, fee=0, max players | 1 division, self-refereed, game to 11 win by 2, no waivers |
| `league_night` | + skill divisions | DUPR-aware, no payments |
| `bracket` | + format (single/double elim), divisions, payments, waivers | Payments + waivers required |
| `pool_to_bracket` | + pool config, seeding rule | Pool play first, then bracket |

### League templates

| Template | Fields exposed | Defaults |
|---|---|---|
| `rec_league` | name, location, format, skill, schedule, max players, points-to-win, win-by, sub credit cap | 7 weeks, mixed doubles, win-loss standings |
| `ladder` | + tier structure, promotion rules | Weekly challenges, position-based standings |
| `flex_league` | + flexible play windows | Players self-schedule within windows |
| `team_league` | + fixed team rosters, head-to-head schedule | Persistent teams, captain-led |

### Multi-step create flow (both surfaces)
1. Pick template
2. Basics (name, location, date)
3. Format & divisions (template-pre-filled)
4. Registration & payments
5. Visibility & invitations
6. Review & publish

---

## Realtime + Notifications (Target)

**Channels:**
- `competition:{id}:matches`
- `competition:{id}:announcements`
- `competition:{id}:standings`
- `team:{id}` — private channel for team's players
- `league:{id}:session:{n}` — per-session channel for league play nights

**Notification flow (every organizer/captain write):**
1. DB write (transactional)
2. Realtime broadcast on relevant channel
3. Edge function fires push to affected `recipient_id`s
4. Audit log entry written

**Latency target:** organizer write → affected player phone push: under 2 seconds.

**Notification kinds (extend, don't rename):**
- `match_ready`, `court_assigned`, `rescheduled`, `score_updated`
- `bracket_advanced`, `eliminated`
- `announcement`, `payment_received`, `waiver_required`
- League-specific: `league_session_reminder`, `sub_needed`, `sub_assigned`, `standings_updated`

Every push has a deep link. Respect `profiles.notification_prefs.quiet_hours` unless event-day overrides apply.

---

## RLS Policies (Target)

### Principles (apply now and in target)

- Enable RLS on every table.
- Anon access only for explicitly public, PII-masked views.
- Use Supabase `anon` key on frontend; rely on RLS.
- Never expose service_role to the frontend.
- Sensitive writes (state transitions, scoring, cancellations) go through RPC, not direct table updates.

### Target policies — Competitions

**competitions**
- Select: public if `visibility='public'` (anon allowed, PII masked); participants + organizer for private/invite-only.
- Insert: authenticated; `organizer_id = auth.uid()`.
- Update: organizer only.
- Delete: organizer AND `status in ('draft','cancelled')`. Else use RPC.

**competition_divisions / competition_courts**
- Select: same as parent.
- Write: organizer only.

**competition_teams**
- Select: same as parent (display_name OK; member PII masked for anon).
- Insert: authenticated user.
- Update: team captain or organizer.
- Delete: organizer only.

**competition_matches**
- Select: same as parent.
- Update: organizer only (via RPC).
- Insert/Delete: server-side via RPC.

**league_sessions / league_attendance / league_sub_credits**
- Select: league participants + organizer.
- Write: organizer only (via RPC).

**competition_announcements**
- Select: participants + organizer.
- Insert: organizer only.

### Target policies — Players directory

**profiles (extended)**
- Select non-PII (`id, display_name, profile_photo_url, dupr_rating, neighborhood, bio`): any authenticated user IF `discoverable=true`.
- Select PII (full name, phone, email): self only.
- Update: self only.

**player_stats_mv**
- Select: any authenticated user.

**player_connections**
- Select: `follower_id = auth.uid()` OR `followed_id = auth.uid()`.
- Insert/Delete: `follower_id = auth.uid()`.

### Target policies — Public marketing (anon)

**locations** — Select: anon allowed.

**platform_stats_mv** — Select: anon allowed.

**competitions (public browse)**
- Select: anon allowed where `visibility='public' AND status IN ('registration_open','in_progress','completed')`.
- Returned fields: id, slug, kind, name, location_id, starts_at, status, registration_fee_cents.

**events (public browse)**
- Select: anon allowed for upcoming; participant names masked to first name only.

---

## Critical RPCs (Target)

Server-side, transactional, audited.

**Competitions:**
- `create_competition_from_template(kind, template, payload)`
- `register_team(competition_id, division_id, player_ids[])`
- `update_match_score(match_id, game_scores, winner_team_id)`
- `assign_court(match_id, court_id)`
- `mark_match_ready(match_id)`
- `reschedule_match(match_id, new_start, new_court_id, reason)`
- `regenerate_bracket(competition_id, division_id)`
- `dispute_match(match_id, reporter_id, reason)`
- `cancel_competition(competition_id, reason)`

**Leagues only:**
- `generate_league_schedule(competition_id)`
- `record_attendance(session_id, player_id, status, sub_for_player_id?)`
- `apply_sub_credits(session_id)`
- `request_sub(team_id, session_id, reason)`
- `accept_sub_request(request_id, player_id)`

**Players directory:**
- `follow_player(player_id)` / `unfollow_player(player_id)`
- `refresh_player_stats(player_id?)`

**Marketing / public:**
- `refresh_platform_stats()` — hourly cron updates `platform_stats_mv`

**Concurrency rule:** Use `SELECT ... FOR UPDATE` on parent row inside function. Last-write-wins on score updates; surface conflict toast to losing writer.

---

## Project Structure (Target)

/app
/api
/(marketing)
/page.tsx
/about
/courts
/[slug]
/events
/leagues
/tournaments
/(auth)
/(app)
/events
/leagues
/[id]
/sessions
/standings
/roster
/create
/tournaments
/[id]
/live
/schedule
/standings
/players
/comms
/create
/players
/[id]
/search
/profile
/components
/ui
/marketing
/features
/events
/competitions
/leagues
/tournaments
/players
/notifications
/lib
/supabase
/competitions
/formats
/scheduling
/standings
/sub_credits
/notifications
/utils
/supabase
/migrations
/functions
seed.sql
/docs

Split files when they pass ~200 lines.

---

## Marketing Site (Target)

`joinzer.com` is part of the same Next.js app. Target state:

**Homepage**
- Hero names coordination + leagues + tournaments together
- Meta description and OG tags reflect all four surfaces
- Real social proof from `platform_stats_mv` (player count, events this week, active leagues, courts listed)
- One primary CTA per fold; secondary "already a member? sign in"
- Image alt text on every image

**Public browse pages (read-only, anon)**
- `/events` — upcoming sessions, PII masked
- `/leagues` — active and upcoming
- `/tournaments` — upcoming and recent
- `/courts` — directory of all 65+ locations with neighborhood pages
- `/courts/[slug]` — individual court page with upcoming sessions, leagues, tournaments

**About page** — reflects all four surfaces.

**SEO**
- Per-court pages (~65) + per-neighborhood (Henderson, Summerlin, Green Valley, North Las Vegas)
- Meta tags reflecting current product
- Sitemap auto-generated from public competitions and locations

**Trust + conversion**
- "Talk to the founder" Calendly for organizer inbound
- FAQ: pricing, skill level, differentiation, organizer payouts
- PWA install promotion ("Add to home screen for push notifications")

---

## Build Order (If Path B is chosen)

**Phase 1 — Competitions foundation**
- Migrate schema: competitions, divisions, courts, teams, matches, announcements, audit_log, notifications, platform_stats_mv
- Migrate schema: league_sessions, league_attendance, league_sub_credits, league_sub_pool
- Add: profiles.display_name, locations.slug, locations.neighborhood, competitions.slug
- Template system (4 tournament + 4 league templates)
- Refactor Create flows to multi-step, template-gated
- Core RPCs deployed
- RLS for all competition tables
- Audit log on every state change

**Phase 2 — Organizer/captain Live views**
- Tournament Live tab: 4-tab structure, court cards, ops health strip, issue queue
- League Session view: tonight's matches, attendance, sub assignments, score entry
- Score entry target: 4 seconds end-to-end
- Schedule tabs with collapsible completed matches/sessions

**Phase 3 — Player companion view**
- Player home: next match (hero), schedule, standings
- Web Push registration + handlers + deep links
- "What players see" preview toggle in organizer schedule views

**Phase 4 — Comms layer**
- Comms tab: announcements with read receipts, organizer↔player DMs, notifications log
- Templated messages
- Multi-select broadcast from roster

**Phase 5 — Marketing site overhaul + Players directory**
- Update homepage hero, meta tags, OG tags
- Update About
- Build public browse pages
- Wire `platform_stats_mv` to homepage
- Players directory: search, profiles, follow, privacy controls
- "Talk to the founder" CTA

**Phase 6 — Sanctioned-tier**
- Stripe Connect onboarding + payment flow
- Waivers (e-sign)
- Ref assignment + ref-side score entry
- DUPR API integration
- Bracket generation (single elim, double elim, pool→bracket)
- League ladder/flex format engines

**Explicitly deferred**
- Spectator live-stream view
- Sponsorship / branded competitions
- Multi-day tournaments
- Multi-season league management
- Native mobile shell (PWA-first)
- Cross-organizer player ratings (use DUPR)
