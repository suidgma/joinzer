
# Joinzer — Platform Overview & Feature Inventory
> **Purpose of this document:** Comprehensive reference for competitive analysis. Describes what Joinzer is, who it serves, and every piece of functionality currently built and deployed. Use this to compare Joinzer's capabilities against established pickleball and recreational sports platforms.

---

## 1. What Is Joinzer?

Joinzer is a **mobile-first pickleball platform** serving recreational and competitive players in the Las Vegas metro area (Henderson, Summerlin, Green Valley, North Las Vegas), with architecture built to scale to other markets.

It combines four distinct product surfaces under one app, one auth system, and one database:

1. **Coordination (Play)** — players find, create, and join ad-hoc play sessions at local courts
2. **Leagues** — organizers run recurring, season-long competitive leagues with standings, subs, and partner matching
3. **Tournaments** — organizers host discrete tournament events with divisions, brackets, registrations, and live scoring
4. **Players** — searchable directory of all platform members with skill ratings and profiles

The platform is designed with a **two-form-factor philosophy**: setup and management surfaces are desktop-first (organizers), while day-of and player-facing surfaces are mobile-first.

**Tech stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Supabase (PostgreSQL + Auth + Realtime), Stripe (payments), Vercel (hosting).

---

## 2. Target Users

| User Type | Description |
|---|---|
| **Recreational player** | Wants to find a game quickly, see who else is playing, join a local session |
| **Competitive player** | Enters leagues and tournaments, tracks skill rating, finds partners |
| **Session captain** | Creates and manages informal play sessions for a group |
| **League organizer** | Runs multi-week seasons, manages rosters, substitutes, scoring, and standings |
| **Tournament organizer** | Hosts discrete events with divisions, brackets, check-in, and live scoring |
| **Staff/volunteer** | Assigned by organizer for day-of operations (check-in, scoring, court management) |

---

## 3. Pilot Market

- **Geography:** Las Vegas metro (Henderson, Summerlin, Green Valley, North Las Vegas)
- **Courts:** 65+ court locations catalogued with name, subarea, court count, access type, coordinates
- **Access types:** Public, private, resort, fee-based, business, HOA, indoor public, semi-private

---

## 4. Authentication & Identity

### Sign-in Methods
- **Email/password** — standard sign-up with email confirmation
- **Google OAuth** — one-click Google sign-in via Supabase Auth

### Sign-up Flow
1. Sign up with email or Google
2. Email confirmation (for email sign-up)
3. First-time profile setup page (`/profile/setup`) — name, photo, skill rating
4. Redirected to home feed

### Profile Data
| Field | Description |
|---|---|
| Name | Display name |
| Email | Account email (visibility: public/private) |
| Phone | Optional (visibility: public/private) |
| Profile photo | Uploaded image |
| DUPR rating | Real DUPR rating if registered (decimal, e.g. 3.75) |
| Estimated rating | Self-assessed skill level |
| Joinzer rating | Platform-internal rating updated by peer ratings |
| Rating source | `dupr_known`, `estimated`, or `skipped` |
| Gender | Player gender |
| Display name | Alternate display name |
| Notify new sessions | Opt-in for new session email alerts |
| Privacy settings | Email/phone visibility (public vs. private) |
| Last login | Timestamp of most recent login (auto-synced from auth) |
| Stub flag | Auto-created accounts for tournament team invites |

### Security
- Row-level security (RLS) enabled on every table
- JWT sessions via Supabase
- Service role key never exposed to frontend
- PII (phone, email) visibility controlled per-profile

---

## 5. Surface: Coordination / Play Sessions

Play sessions are **ad-hoc, informal games** — the original MVP surface. Any authenticated user can create a session; others can join or waitlist.

### Session Fields
| Field | Description |
|---|---|
| Title | Session name |
| Location | Court/facility picker (from locations table) |
| Date & time | Start datetime |
| Duration | Session length in minutes |
| Court count | Number of courts in use |
| Players per court | Default 6 |
| Max players | Derived from courts × players per court |
| Skill level | Min/max numeric rating range (e.g. 3.0–3.5) |
| Notes | Free-text description |
| Session type | `game`, `free_clinic`, `paid_clinic` |
| Price | Dollar amount (for paid clinics only) |
| Registration deadline | Optional cutoff time |

### What Players Can Do
- Browse all open sessions with filters (location, date, skill level)
- Join a session (immediate if spots available)
- Join the waitlist (if session is full — auto-promoted when spots open)
- Leave a session
- View session details: participants, location map, notes, schedule
- Chat with other joined participants (event-scoped messaging)
- Add session to calendar (Google Calendar, Yahoo Calendar, Apple Calendar/iCal, Outlook)
- Rate other players after a session ends (1–5 stars + comments, feeds Joinzer rating)
- Receive a confirmation email upon joining

### What Captains Can Do
- Create sessions with all configuration
- Edit session details (title, time, location, notes, skill range, courts)
- Duplicate a session (pre-fills create form from existing session)
- Delete session
- Reassign captain role to another joined participant
- Cannot leave while other players are joined — must reassign captain first
- Paid clinic: session fee tracked, captain sees payment status per participant

### Session Lifecycle
`open` → `full` (auto when max reached) → `completed` (after end time) | `cancelled`

### Notifications
- Email confirmation on join
- Session reminder email 24 hours before (cron job)
- New session notifications to opted-in followers

---

## 6. Surface: Leagues

Leagues are **recurring, season-long** competitive structures. Players register once and play every week over a multi-week season.

### League Configuration
| Field | Description |
|---|---|
| Name | League name |
| Format | `mens_doubles`, `womens_doubles`, `mixed_doubles`, `coed_doubles`, `open_singles`, `individual_round_robin`, `custom` |
| Skill level | `beginner`, `beginner_plus`, `intermediate`, `intermediate_plus`, `advanced`, `advanced_plus` |
| Skill range | Numeric min/max (e.g. 3.0–3.5) |
| Location | Court/facility |
| Schedule description | Free text (e.g. "Tuesdays 6–9 PM") |
| Start/end date | Season dates |
| Play days | Number of weeks in season |
| Games per session | Rounds per play night |
| Max players | Registration cap |
| Cost | Optional registration fee (dollars) |
| Registration status | `upcoming`, `open`, `waitlist_only`, `closed` |
| Registration deadline | Auto-defaults to 7 days before start |
| Scoring method | `win_loss` or `total_points` |
| Points to win | Target score per game |
| Win by | 1 or 2 points |
| Sub credit cap | Max substitute credits per player per season |

### Registration Types
- **Team (with partner)** — doubles captain registers and sends email invite to partner; both pay separately when partner accepts
- **Solo (seeking partner)** — registers alone; organizer auto-pairs with another solo player when enough are available
- **Waitlist** — if league is full; auto-promoted when a spot opens
- **Cancellation** — player cancels registration (with optional refund)

### Partner Invitation System
- Captain enters partner's email at registration
- Partner receives invite link (expires after configurable time)
- Partner accepts → both registered as a team
- Invite expiry cron: auto-declines expired pending invites
- If partner has no account, a stub account is created for them

### Session Management (Per Play Night)
Each week's play night is a **League Session** containing multiple **Rounds** of **Matches**.

**Organizer/staff flow:**
1. Players check in (mark attendance: `expected`, `out`, `maybe`, `late`, `present`, `left_early`)
2. Assign substitutes for absent players
3. Generate round (auto-algorithm pairs present players into matches per court)
4. Lock round (makes matches official, starts next round generation)
5. Enter scores for each match
6. Complete round → scores committed to standings
7. Repeat for all rounds in the session

### Substitutes (Sub System)
- Any player can request a sub for a session they can't attend
- Other players on the sub interest list can accept
- Accepted sub earns **sub credits** toward their standing
- Cap on sub credits per season (sub_credit_cap) prevents gaming standings
- Sub assignment: accepted sub is slotted into the absent player's match position

### Standings
- Updated after each session's results are locked
- Tracks wins, losses, total points scored (depending on league config)
- Accessible from `/leagues/[id]/standings`

### What League Players Can Do
- Register (solo or team), pay fee if applicable
- Accept/decline partner invitations
- View upcoming sessions
- Mark availability for each session
- Check in to sessions
- View match assignments (round, court, opponents)
- Request a sub when unavailable
- Accept sub requests and earn credits
- View season standings
- Chat in league group chat
- Add league schedule to calendar (all sessions in one `.ics` export)

### What League Organizers Can Do
- Create and configure league
- Edit league details
- Open/close registration
- Manage roster (view all members, remove players)
- Run sessions (check-in, attendance, round generation, scoring)
- View and manage sub requests
- View standings
- Send session reminders
- Delete league

---

## 7. Surface: Tournaments

Tournaments are **discrete, single-day (or multi-day) events** with divisions, brackets, formal registrations, and live scoring.

### Tournament Configuration
| Field | Description |
|---|---|
| Name | Tournament name |
| Description | Rich text description |
| Location | Court/facility picker |
| Date | Tournament date |
| Start time | Event start (e.g. 8:00 AM) |
| Estimated end time | Projected end (e.g. 5:00 PM) |
| Status | `draft`, `published`, `cancelled`, `completed` |
| Visibility | `public`, `private` |
| Registration status | `open`, `closed` |
| Registration deadline | Cutoff for new registrations |
| Cost | Optional tournament-wide entry fee |

### Divisions
Each tournament can have multiple **divisions** — separate brackets for different formats or skill levels.

| Field | Description |
|---|---|
| Name | Division name (e.g. "Men's Doubles 3.5+") |
| Format | `mens_doubles`, `womens_doubles`, `mixed_doubles`, `open_singles`, `coed_doubles`, etc. |
| Skill range | Numeric min/max |
| Max entries | Maximum teams allowed |
| Waitlist enabled | Allow overflow waitlist |
| Bracket type | `round_robin`, `single_elimination`, `double_elimination`, `pool_play` (pool play + playoffs) |
| Format settings | Game score to win, win-by, number of pools, teams per pool, teams that advance |
| Division cost | Optional per-division fee (overrides tournament-level cost) |
| Status | `open`, `closed` |

### Registration
- **Singles:** One player registers per entry
- **Doubles (team):** Captain registers and invites a partner by email
- **Doubles (solo):** Registers alone; organizer can auto-pair with another solo
- **Partner invitation:** Email invite with accept link (stub account created if partner has no Joinzer account)
- **Bulk import:** CSV upload of pre-existing registrations
- **Payment:** Stripe checkout; payment status tracked per registration (`pending`, `paid`, `refunded`, `waived`)
- **Discount codes:** Organizer can create promo codes (percent off or fixed dollar amount, with usage caps and expiry)
- **Waitlist:** Overflow registrations tracked separately; organizer can promote from waitlist

### Registration Lifecycle
`pending` → `registered` (paid or waived) → `cancelled` | `withdrawn`

Payment status: `pending` → `paid` → `refunded`

### Bracket Generation
- Organizer clicks "Generate Matches" per division
- System generates matches based on bracket type and format settings
- Supported structures:
  - **Round Robin:** Every team plays every other team; ranked by wins
  - **Single Elimination:** Losers out; winner advances
  - **Double Elimination:** One loss moves to consolation bracket; two losses = out
  - **Pool Play + Playoffs:** Groups play round robin; top N teams advance to elimination bracket
- Match fields: round number, match number, stage (pool/main/consolation/finals), pool number, court number, scheduled time, team assignments, scores, winner, status

### Day-of Operations
- **Check-in screen** (`/tournaments/[id]/checkin`): QR code scanner + manual check-in
- **Live view** (`/tournaments/[id]/live`): All matches in progress with real-time score updates
- **Staff view** (`/tournaments/[id]/staff`): Court assignments, match readiness, score reporting
- **Match lifecycle:** `pending` → `ready` → `in_progress` → `completed` | `no_show`
- **Score entry:** Staff or players submit scores; winner auto-determined
- **Court assignment:** Staff can assign matches to specific courts
- **Reschedule:** Move matches to different courts or times

### Staff & Roles
- **Organizer:** Full control over tournament, edit, manage, delete
- **Co-organizer:** Full access except delete
- **Volunteer:** Score entry only
- Staff added via searchable player combobox (name/email search from profiles)

### Player Count Display
- Shows current registered players vs. max players
- Doubles: `max_entries × 2 = max players` (e.g., 4 team slots = 8 player capacity)
- Full divisions show "FULL" badge and block new registrations

### Organizer Dashboard
- **Setup checklist:** Step-by-step guide (add divisions, open registration, publish, generate bracket)
- **Registration overview:** Count, payment statuses at a glance
- **Registrations list:** View all with ability to cancel, refund, withdraw
- **Divisions management:** Edit division settings, bracket type, rules
- **Match management:** View all matches, update scores, reschedule
- **Discount codes:** Create, manage, track usage and redemption counts
- **Import players:** CSV bulk upload for pre-registered participants

### What Tournament Players Can Do
- Register for one or more divisions
- Pay entry fee (Stripe)
- Accept partner invitations
- View tournament info, divisions, schedule
- View "My Matches" filtered to their registrations
- Check in day-of (QR or manual)
- View live bracket and scores
- Chat in tournament group chat
- Add tournament to calendar (Google Calendar, Yahoo Calendar, Apple Calendar, Outlook)
- Cancel or withdraw registration

### Edit Access
- Only the **organizer** and **co-organizers** see the Edit navigation item
- Volunteers and regular registrants see overview only

---

## 8. Surface: Players Directory

### What Exists
- Searchable directory of all platform members
- Filter by name
- View player profile: name, rating, skill level, gender
- Invite player to a session or connect

### Player Rating System
- **DUPR rating:** If player has a real DUPR rating, stored and displayed
- **Estimated rating:** Self-assessed or platform-estimated (e.g. 3.0–3.5)
- **Joinzer rating:** Internal rating updated when other players rate them after sessions
- **Rating source:** `dupr_known`, `estimated`, `skipped`

---

## 9. Home Feed

### What's Displayed
- Registered leagues with next upcoming session
- My next tournament match
- **Upcoming Events section** — personalized or curated, showing sessions, leagues, and tournaments

### Upcoming Events Personalization Algorithm
When no featured items are manually set, the feed scores and ranks events across all three types:
- **+30 points** if event's skill range overlaps the user's skill level (±1 tier)
- **0–20 points** based on proximity to user's home court (1 point per mile deducted, max 20)
- **+10 points** if event is within 7 days
- **+5 points** if event is 8–14 days away
- Top 8 results shown, mixing sessions, leagues, and tournaments

### Featured Override (App Owner Control)
- Admin can populate the `featured_home_items` table with specific events
- When active featured items exist, they replace the personalized feed entirely
- Items ordered by `display_order`
- Active/expiry windows supported (`active_from`, `active_until`)

### Nudges
- **Skill rating nudge:** Amber banner if user hasn't set a skill rating → links to `/profile/edit`
- **Home court nudge:** Amber banner if user hasn't set a home court → links to `/profile/edit`

---

## 10. Calendar Integration

All three surfaces support multi-provider calendar export via a dropdown menu:

| Option | Method |
|---|---|
| Google Calendar | URL-based with event pre-filled; uses `ctz=America/Los_Angeles` for correct timezone |
| Yahoo Calendar | URL-based with event pre-filled; timezone-aware |
| Apple Calendar | Downloads `.ics` file |
| Outlook / Other | Downloads `.ics` file |

**Data included in calendar entries:**
- Event title (tournament name, league name, or session title)
- Start and end time (full datetime for sessions/tournaments with time; date-only for leagues)
- Location name
- Link back to Joinzer event page

---

## 11. Payments

### What Can Be Paid For
| Surface | Trigger |
|---|---|
| Paid clinic (Play) | Player joins a paid clinic session |
| League registration | Player registers for a paid league |
| Tournament registration | Player registers for a paid tournament or division |

### Payment Infrastructure
- **Processor:** Stripe
- **Checkout:** Stripe Checkout sessions (redirect to Stripe, return to Joinzer on success)
- **Payment tracking:** `payment_status` (`pending`, `paid`, `refunded`, `waived`) + `stripe_payment_intent_id` stored per participant/registration record
- **Refunds:** Organizer can trigger refund; status updated in DB
- **Discount codes:** Tournament-level promo codes (percent or fixed, with max-use cap and expiry)
- **Stripe Connect:** Organizers can connect their Stripe account for direct payouts
- **Webhooks:** `/api/stripe/webhook` handles Stripe charge events and disputes

### Stripe Connect (Organizer Payouts)
- Organizer onboards via `/settings/payouts` → Stripe Connect flow
- Status check at `/api/stripe/connect/status`
- Payments flow through Joinzer's account and are transferred to organizer's Connected Account

---

## 12. Real-Time & Chat

### Chat Channels
| Channel | Scope | Who Can Chat |
|---|---|---|
| Session chat | Per play session | Joined participants only |
| League chat | Per league | League members |
| Tournament chat | Per tournament | Registered participants |

- All chat uses Supabase Realtime (PostgreSQL broadcast)
- Messages persist in DB (`event_messages`, `league_messages`, `tournament_messages`)
- Shown in real-time without page refresh

### Live Scoring
- Tournament matches update in real-time as scores are entered
- Live view (`/tournaments/[id]/live`) subscribes to match updates
- League session live view shows round-by-round progress as organizer advances rounds

---

## 13. Notifications & Communications

### Email Notifications
| Trigger | Recipient |
|---|---|
| Joining a play session | Player |
| Registering for a league | Player |
| Session reminder | Joined players (24h before, via cron) |
| New session created nearby | Opted-in followers |
| Admin new signup alert | Internal admin |
| Unsubscribe confirmation | Player |

### Cron Jobs
- **Session reminders:** Fires 24 hours before each session; emails all joined participants
- **League partner invite timeout:** Auto-expires pending partner invites after set window

### Calendar
- iCalendar (`.ics`) export available for all three event types (see §10)

### Not Yet Built
- Push notifications (iOS/Android/Web)
- In-app notification center
- SMS

---

## 14. Locations / Courts Database

- 65+ court locations in Las Vegas metro catalogued
- Fields: name, subarea/neighborhood, court count, access type, address, coordinates (lat/lng for proximity scoring)
- Access types: public, private, resort, fee-based, business, HOA, indoor public, semi-private
- Used across all surfaces (play sessions, leagues, tournaments)
- Home court: players can set a preferred court on their profile (used for feed personalization)

---

## 15. API Surface

65+ REST endpoints organized by domain:

### Play Sessions (`/api/events/`)
- Fetch, update, delete event
- Cancel event
- Leave event
- Stripe checkout for paid sessions
- iCal export
- List participants
- Participant payment status

### Leagues (`/api/leagues/`, `/api/league-*`)
- Full league CRUD
- Register / cancel registration
- Stripe checkout
- iCal export
- Member management
- Partner invitation accept/decline
- Session management (attendance, round generation, sub assignment)
- Round & match score updates
- Sub request CRUD

### Tournaments (`/api/tournaments/`)
- Full tournament CRUD
- Division CRUD
- Registration (create, cancel, refund, withdraw)
- Partner invitations (send, accept)
- Bulk CSV import
- Stripe checkout
- Discount codes
- Match generation (bracket building)
- Score entry
- Match lifecycle (ready, reschedule)
- Day-of check-in
- Staff management
- iCal export

### Players (`/api/players/`)
- Fetch player list (for combobox/pickers)
- Invite player
- Post-session player ratings

### Payments (`/api/stripe/`)
- Stripe webhook handler
- Stripe Connect onboarding
- Stripe Connect status check

### Account
- Delete account
- Unsubscribe from emails

### Cron
- Session reminders (24h before)
- League partner invite expiry

---

## 16. Organizer & Admin Tooling

### Tournament Organizer Tools
| Tool | Location |
|---|---|
| Setup checklist | Tournament overview |
| Division management | Create, edit, set bracket format |
| Registration management | View, cancel, refund, waive payment |
| Discount code management | Create, track usage, set expiry |
| CSV import | Bulk add pre-registered players |
| Bracket generation | Per-division, auto or manual seeding |
| Solo pairing | Auto-pair solo doubles registrations |
| Day-of check-in | QR scanner + manual toggle |
| Live scoring | Score entry, court assignment |
| Staff management | Add/remove co-organizers and volunteers |
| Announcements | Tournament-wide notifications |

### League Organizer Tools
| Tool | Location |
|---|---|
| League configuration | Create/edit all league settings |
| Registration control | Open, close, waitlist |
| Roster management | View all members, remove |
| Session runner | Attendance, round gen, score entry |
| Sub management | View requests, assign subs |
| Standings | Season-long standings table |
| Group chat | League-wide messaging |

### Session Captain Tools
- Create, edit, delete sessions
- Reassign captain role
- View participant payment status (paid clinics)
- Duplicate sessions

---

## 17. Navigation & UX Structure

### Top Navigation (Authenticated)
Home · Play · Leagues · Tournaments · Players · Profile

### Mobile Navigation
- Bottom navigation bar for primary surfaces
- Hamburger/tab navigation for sub-sections

### Desktop Navigation
- Left sidebar (`ManageNav`) for management pages (tournament overview, edit, etc.)
- Desktop shell wrapper for wider layout

### URL Structure
```
/play                             # Session discovery
/play/[id]                        # Session detail
/play/create                      # Create session
/leagues                          # League list
/leagues/[id]                     # League detail
/leagues/[id]/sessions/[sid]/live # Live session runner
/tournaments                      # Tournament list
/tournaments/[id]                 # Tournament detail + organizer view
/tournaments/[id]/staff           # Staff management
/players                          # Player directory
/profile                          # User profile
/profile/edit                     # Edit profile
/profile/setup                    # First-time setup
/settings/payouts                 # Stripe Connect for organizers
```

---

## 18. What Is NOT Yet Built

| Feature | Status |
|---|---|
| Push notifications (iOS/Android/Web) | Not implemented |
| In-app notification center | Not implemented |
| SMS notifications | Not implemented |
| Audit log | Not implemented |
| Platform stats / analytics dashboard | Not implemented |
| Players directory advanced features (connections, leaderboards, detailed history) | Minimal — basic directory only |
| Public marketing site SEO overhaul (per-court pages, neighborhood pages) | Not implemented |
| Unified competitions schema (leagues + tournaments under one model) | Designed, not migrated |
| Native mobile app | Web-only (PWA-capable) |
| Spectator view | Not implemented |
| Sponsorships / branded tournaments | Not implemented |
| Multi-season league management | Not implemented |
| DUPR API integration | Not implemented |
| Waiver system | Not implemented |
| Referee assignment | Not implemented |

---

## 19. Key Differentiators (Current State)

1. **Unified platform:** All three surfaces (casual play, leagues, tournaments) under one login and one player identity — no separate apps needed
2. **Smart home feed:** Personalized event recommendations weighted by skill match, proximity, and recency
3. **Sub system for leagues:** Structured substitute management with credit tracking — prevents schedule disruptions
4. **Dual registration model:** Both team (with partner invite) and solo (auto-matched) registration for doubles events
5. **Stub accounts:** Partner invites create placeholder accounts so teams can be registered even before the partner signs up
6. **Discount codes:** Tournament organizers can offer promo pricing with usage caps and expiry
7. **Live bracket scoring:** Real-time match updates on tournament day
8. **Multi-provider calendar:** Google, Yahoo, Apple, Outlook export with correct timezone handling
9. **Payment processing built-in:** Stripe for session fees, league dues, and tournament entry fees — no third-party fee app needed
10. **Court database:** 65+ Las Vegas courts pre-loaded with coordinates for proximity-based recommendations

---

*Document generated: May 2026. Reflects deployed production state.*
