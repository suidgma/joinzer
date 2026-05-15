# Joinzer Build Sequence
**A working backlog for Claude Code, sequenced for solopreneur execution**

Findings from five UX reviews, organized into batches you can hand to Claude Code one session at a time. Not estimated in dev hours — implementation is fast; what matters is **scope per session**, **decisions you need to make**, and **what to verify before moving on**.

How to read each ticket:
- **What** — the change
- **Where** — files / surfaces affected
- **Prompt** — copy-paste starter for the Claude Code session
- **Verify** — what to look at before saying done
- **Blocks** — what won't ship until this lands

---

## Workflow

1. Drop this file + `joinzer-taxonomy-migration-plan.md` into `docs/` in the repo.
2. Start each Claude Code session with **one ticket**. Smaller scope = better PRs.
3. After each session: skim the diff, run locally, ship to prod, mark the ticket done in this file (`[x]`).
4. When you make a decision from §Decisions, write it into `docs/decisions.md` so Claude Code reads it next time.

---

## Batch 0 — Stop the bleed (one afternoon of sessions)

Independently shippable. Nothing here depends on anything else. Start here Monday morning.

### [x] 0.1 Fix doubles bracket render (display-only patch)
- **Where:** Tournament division schedule renderer (likely a match-row component in `app/tournaments/[id]/`).
- **What:** When division is doubles and a team has 2 players, render "Carter / Smith vs Denzer / Jones." When a team has 1 player (partner missing), render "Carter / **?**" in yellow.
- **Prompt:** *"In the tournament division match schedule, fix the render so doubles matches show both players per side. If a team has fewer than 2 players, render a yellow '?' placeholder for the missing partner. Don't change any data model — just rendering. The bug currently shows 'Alex Carter vs Ben Denzer' instead of 'Carter / Smith vs Denzer / Jones'."*
- **Verify:** Open the Pro Men tournament, scroll to the schedule. Should now show partner placeholders since none of those registrants are paired.
- **Blocks:** Nothing. This is cosmetic and ships independently of the real model fix in Batch 1.

### [x] 0.2 Clean seed/test data on the public Leagues index
- **Where:** `/compete` query / list endpoint.
- **What:** Added `dummy boolean NOT NULL DEFAULT false` to `leagues` and `tournaments` (matches `profiles.dummy`). Added `is_admin boolean NOT NULL DEFAULT false` to `profiles`. Backfilled 4 leagues and 16 tournaments as `dummy=true`. Both list pages filter `dummy=false` by default. `?showTest=1` bypasses filter for users with `profiles.is_admin = true` only.
- **Decision:** Option A (tag-and-filter). See `docs/decisions.md`.

### [x] 0.3 Replace Division ID textbox with a dropdown on Import
- **Where:** `/tournaments/[id]/import` form.
- **What:** Today the org has to paste a UUID found in dev tools. Replace with a `<select>` populated from the parent tournament's divisions.
- **Prompt:** *"On the tournament import page, replace the Division ID textbox with a dropdown populated from the parent tournament's divisions. Remove the 'Find the division ID in the tournament URL or browser dev tools' helper text."*
- **Verify:** Open the import page on Pro Men, see "Pro" as a dropdown option.

### [x] 0.4 Fix email lookup normalization in Import Preview
- **Where:** Import Players preview endpoint / RPC.
- **What:** Marty's real account returns "No account." Normalize email server-side before lookup: lowercase, strip `+suffix`, trim.
- **Prompt:** *"In the import-players preview RPC, normalize the lookup email before querying: lowercase, trim, strip everything from '+' up to '@'. Verify that `martyfit50+playwrighttest@gmail.com` resolves to the same user as `martyfit50@gmail.com`."*
- **Verify:** Paste Marty's `+playwrighttest` email into the import CSV, preview, should show a green "Account found" badge or similar.
- **Decision needed:** What happens to "No account" rows on commit — create stub accounts and send invites, or skip? (See §Decisions.)

### [x] 0.5 Differentiate org vs participant on Home cards
- **Where:** `/home` league session cards.
- **What:** Today every card shows "Open Session Manager →" — intimidating to a plain player. Show "View →" as primary for participants; reserve manager CTA for users with `league_role = 'organizer' | 'captain'`.
- **Prompt:** *"On the /home page, the league session cards currently always show 'Open Session Manager →'. Make it state-aware: only show the manager CTA when the current user has an organizer or captain role on that league. Otherwise show a regular 'View →' link to the league overview."*
- **Verify:** Log in as a non-org user (or simulate one) and check that Home doesn't show manager CTAs.

### [x] 0.6 Confirmation modal on Cancel Registration
- **Where:** Tournament division card, when user is registered/waitlisted.
- **What:** Today: one click → registration gone. Add a confirm modal.
- **Prompt:** *"Add a confirmation modal to the Cancel Registration button on tournament divisions. Modal copy: 'Cancel your registration? Your spot will be released to the next person on the waitlist.' Two buttons: 'Cancel registration' (destructive style) and 'Keep my spot' (default)."*
- **Verify:** Try to cancel, should require two clicks.

---

## Batch 1 — Doubles bug, fixed at the model

Taxonomy migration is the foundation; everything else in this batch depends on it. Don't reorder.

### [ ] 1.1 Taxonomy migration — Phase 1 (additive, dual-write)
- **See:** `docs/joinzer-taxonomy-migration-plan.md` §5 Phase 1.
- **What:** Add `format`, `skill_min`, `skill_max`, `self_rating` columns. Backfill from existing data. Dual-write on create/update. **Zero user-visible change.**
- **Prompt:** *"Implement Phase 1 of docs/joinzer-taxonomy-migration-plan.md. Add the new columns to divisions, leagues, users, and sessions tables. Write the backfill migration with the safety audit query. Update create/update paths to dual-write to old and new columns. Do not change any reads or any UI yet."*
- **Verify:** Run the audit query from §3.2 of the migration plan and review any coerced rows before committing. After dual-write ships, create one new tournament division and verify both old and new columns are populated correctly.
- **Blocks:** 1.2, 1.3, 1.6, and the entirety of Batches 4 and parts of Batch 2.

### [ ] 1.2 Make org-side Add Player team-aware
- **Where:** Tournament division Manage panel → `+ Add Player` modal.
- **What:** When the division's `format` requires a partner, the modal has two player typeaheads + team name. Reuse the same component as self-service registration.
- **Prompt:** *"Refactor the org-side Add Player modal on tournament divisions. When the division's format requires a partner (use the requiresPartner helper from lib/format.ts), show two player typeahead fields and a Team Name field. When singles, show one field. Reuse the modal component from the self-service registration flow if possible — they're the same shape."*
- **Verify:** Pro Men division: clicking Add Player should now show a two-player form. Adding a single test division with `format=open_singles` should show one-player.
- **Blocks:** 1.4 (match generation gate is meaningless if orgs can still add unpaired individuals).

### [ ] 1.3 CSV importer respects division format
- **Where:** `/tournaments/[id]/import`.
- **What:** For doubles divisions, schema is `player1_email, player2_email, team_name`. For singles, `email`. Preview groups paired rows into one team card.
- **Prompt:** *"Update the CSV import flow on /tournaments/[id]/import to be format-aware. When the selected division's format requires a partner, the expected CSV columns are player1_email, player2_email, team_name. When singles, just email. Update the placeholder, sample, helper copy, and the Preview rendering — paired rows should show as a single team card with both players inside."*
- **Verify:** Try the importer with a doubles division and a singles division. Sample data and preview should differ.
- **Decision needed:** Add file upload (drag-and-drop) too, or just paste-in for now? Recommend doing both in this session — it's small.
- **Done (bonus):** File upload added to import page (Upload file button + filename chip). ✅

### [ ] 1.4 Block match generation on incomplete teams
- **Where:** Tournament division Manage panel "Generate Matches" CTA.
- **What:** Disable when any team has fewer than required players. Banner: "N unpaired registrants. They won't be scheduled."
- **Prompt:** *"On the tournament division Manage panel, disable the Generate Matches button when any team in a doubles division has fewer than 2 confirmed players. Show a yellow banner: 'N unpaired registrants. They will not be scheduled until paired.' with a 'Resolve' link that scrolls to the registrants list."*
- **Verify:** Pro Men division has 6 unpaired registrants. Generate button should be disabled with the banner.

### [ ] 1.5 Add the Confirm Import button
- **Where:** `/tournaments/[id]/import`.
- **What:** Today Preview shows but there's no commit action. Always render an "Import N rows" button after Preview, disabled when blocking errors exist.
- **Prompt:** *"On the tournament import page, after a successful Preview, render a green primary button 'Import N rows' below the preview. Disable it (with tooltip explaining why) if any row has blocking errors. Summary text above the button: 'Will import: X paired teams + Y solo. Z emails will be invited.'"*
- **Verify:** Preview with a clean CSV → see Import button → click it → registrants appear in the division.
- **Decision needed:** What happens to "No account" rows when commit fires? Stub-account-and-invite, or skip? (See §Decisions.)

### [ ] 1.6 Switch reads to new format helpers
- **Where:** Match generator, bracket renderer, anywhere `team_type` or `category` is read.
- **What:** Grep for old column reads, replace with `isDoubles(format)` etc. The render fix from 0.1 becomes the *correct* render once teams have real partner data.
- **Prompt:** *"Find every place in the codebase that reads `divisions.category`, `divisions.team_type`, or the legacy skill enums. Replace each with reads from `divisions.format`, `divisions.skill_min`, `divisions.skill_max`, using the helpers in lib/format.ts and lib/skill.ts. Be exhaustive — match generation, registration forms, schedule rendering, filters, exports. Keep dual-write (writes) in place; this PR is read-side only."*
- **Verify:** Create a fresh doubles division, register two players with the team-aware Add Player from 1.2, generate matches. Should show "Player1 / Player2 vs Player3 / Player4."
- **Blocks:** Batch 4.

---

## Batch 2 — Leagues become sellable

Without these, the league flow can't actually run a paid season. P2.1 is the biggest hole.

### [ ] 2.1 Roster panel on league overview (org view)
- **Where:** `/compete/leagues/[id]` for users with org/captain role.
- **What:** Today: no way to see, add, remove, or message registered players. Add a Roster panel: list of registrants/teams, status per row, +Add Player, Import CSV.
- **Prompt:** *"On the league overview page, add a Roster panel visible only to org/captain roles. Mirror the tournament Manage panel: list of registrants with team name, status (Registered / Pending payment / Pending partner), Mark Paid / Remove actions, plus '+ Add Player' (using the team-aware modal from ticket 1.2) and 'Import CSV' (linking to /compete/leagues/[id]/import — create that page too, mirror the tournament importer)."*
- **Verify:** As league owner, see the roster panel. As a non-org member, don't see it.

### [x] 2.2 League Edit form parity with Create
- **Where:** `/compete/leagues/[id]/edit`.
- **What:** Create has Win By, Sub Credit Cap, Points to Win, Max Players, Games/Play — Edit doesn't. Add them. Lock Format and skill range when `registrant_count > 0`.
- **Prompt:** *"On /compete/leagues/[id]/edit, add the missing fields that exist in the Create form: Win By toggle, Sub Credit Cap dropdown, Points to Win, Max Players, Games/Play. Match the Create form layout. Also: when the league has 1 or more registrants, disable the Format dropdown and the skill range pickers with a tooltip 'Locked after first registration to protect existing registrants.'"*
- **Verify:** Edit an existing league. See all fields. Try editing the cbcvxbvcx league (which has zero registrants) — fields should be editable. Try editing one with registrants — Format should be locked.

### [x] 2.3 Link League Play Manager from league overview
- **Where:** `/compete/leagues/[id]`.
- **What:** Today the Play Manager is buried at `/sessions/[id]/live`, only reachable from Home → session card. Add a "Manage Session N →" link per session row on the league overview (org-only).
- **Prompt:** *"On the league overview Schedule section, add a 'Manage →' link per session row, visible only to org/captain roles. Link goes to /compete/leagues/[id]/sessions/[sessionId]/live."*
- **Verify:** As org, see Manage link on each session row.

### [ ] 2.4 Partner invite step in league registration
- **Where:** League registration modal flow.
- **What:** Tournament registration has a Step 2 partner invite. League registration jumps straight to payment. Mirror the tournament pattern.
- **Prompt:** *"Update the league registration flow to add a Step 2 'Invite Your Partner' modal after Step 1 Team/Solo selection, mirroring the tournament registration flow. Step 2 has: Partner's Email field, Send Invite, and Skip. For paid leagues, the partner invite should fire after Stripe Checkout succeeds, not before — the captain pays first, then invites."*
- **Verify:** Register for a paid league as a team. Should: select Team → Stripe Checkout → return → see partner invite step.
- **Decision needed:** Does the partner pay separately or does the captain pay for both? (See §Decisions.)

### [x] 2.5 Sub system state and unified UI
- **Where:** League detail, "I'm interested in subbing" button.
- **What:** Today: same button for everyone, no state feedback after click. Member view has per-session toggles; non-member doesn't. Unify.
- **Prompt:** *"On the league detail page, unify the sub-availability UI for members and non-members. After tapping 'I'm interested in subbing', the button becomes 'On the sub list · Manage' and reveals the per-session 'I can sub' toggles inline. State persists; tapping Manage lets the user remove their interest."*
- **Verify:** Tap the sub button, see per-session toggles, refresh, state persists.

---

## Batch 3 — Trust and money

These don't fix anything broken; they raise confidence around payments, identity, notifications. Compounds once real money flows.

### [x] 3.1 Transactional confirmation email after registration
- **Where:** Tournament + League registration completion hook.
- **What:** Sends confirmation email (free + paid paths) with event details, partner status, .ics attachment. Shared `registrationEmail()` helper in `lib/email/templates.ts`. ICS generator in `lib/email/ics.ts`.
- **Done:** Free league, free tournament, paid league (webhook), paid tournament (webhook). All fire-and-forget; send failure never blocks registration.
- **Follow-ups filed below (non-blocking):** HTML escaping in template, RFC 5545 line folding, type the nested location select.

### [ ] 3.2 Show waitlist position
- **Where:** Division / league card after a player joins the waitlist.
- **What:** Today: "On waitlist" with no number. Show "Waitlist #N of M."
- **Prompt:** *"On tournament division and league registration cards, when the current user is waitlisted, show their position: 'Waitlist #2 of 4'. Pull from the waitlist row's index sorted by created_at."*
- **Verify:** Be the second waitlisted person on Pro Men. See "Waitlist #2 of 2."

### [ ] 3.3 Privacy settings on profile
- **Where:** `/profile` + `/profile/edit`.
- **What:** Email and phone are plaintext. Add a privacy toggle: who can see them.
- **Prompt:** *"Add a Privacy section to /profile/edit with two settings: 'Email visibility' and 'Phone visibility', each with options: 'Just me', 'Captains of events I join', 'All players'. Default to 'Just me'. Update any page that displays another user's email/phone to respect these settings."*
- **Verify:** Set to "Just me," check that captain views of player rosters don't show your email.

### [ ] 3.4 Refund + cancellation policy display
- **Where:** Anywhere a paid registration CTA appears + `/refund-policy` page.
- **What:** Today: no policy visible. Add a one-liner under "Pay $X to Register" and a linked policy page.
- **Prompt:** *"Add a refund policy page at /refund-policy (content TBD by Marty — see docs/decisions.md). Below every 'Pay $X to Register' button, show 'Refundable until [registration_deadline]. [Refund policy →]'."*
- **Verify:** Pay flow on 10 league shows the refund line.
- **Decision needed:** What is your refund policy? (See §Decisions.)

### [ ] 3.5 Solo auto-matcher — ship it or change the copy
- **Where:** Tournament/League registration → Individual (solo) path.
- **What:** Copy promises auto-matching with email notification. Either implement it or change the copy.
- **Decision needed:** Ship the matcher or change the copy? (See §Decisions.)
- **Prompt (copy-only fix):** *"On the registration modal Individual (solo) path, replace the auto-match copy with: 'You'll be added to the solo queue. The organizer will pair solo players before the registration deadline.' Remove any reference to automatic email matching."*
- **Prompt (ship the matcher):** *"Implement a solo auto-matcher: scheduled function that runs daily for each open doubles division/league with `auto_match_solo = true`. Pairs two solo registrants on FIFO basis, creates the team row, sends both an email with their new partner's contact info. Update the registrant card to show 'Solo - matched daily at 6 PM' with the queue position."*

### [ ] 3.6 Add to calendar + partner-pending nudges
- **Where:** Registered-state cards, Home banner.
- **What:** Three items; item 1 done.
- **[x] Item 1 — "Add to calendar" link on registered cards.** Done: `LeagueActions.tsx` (registered state) and `DivisionsSection.tsx` (registered badge). Both hit auth-gated GET endpoints that stream the .ics.
- **[ ] Item 2 — Partner-pending banner on /home.** Yellow banner when registered for any event with still-pending partner.
- **[ ] Item 3 — Reminder email 24h before session.** Scheduled Edge Function or cron. See `app/api/cron/session-reminders/route.ts` for existing session-reminder scaffolding.

---

## Batch 4 — Taxonomy Phases 2 + 3

Continue the migration. Phase 2 is user-visible; Phase 3 is cleanup. Ship in parallel with Batch 3 if you want.

### [ ] 4.1 Taxonomy Phase 2 — read cutover + new UI
- **See:** `docs/joinzer-taxonomy-migration-plan.md` §5 Phase 2.
- **What:** Switch reads to new columns. Ship Format dropdown on tournament division creation. Ship SkillRangePicker everywhere. Update filters.
- **Prompt:** *"Implement Phase 2 of the taxonomy migration. Switch all read paths to the new columns (format, skill_min, skill_max, self_rating). Build the SkillRangePicker shared component per §4.5 of the migration plan. Update: tournament division create form (replace Category × Team Type with Format), league create + edit forms (canonical Format list), play session create form (numeric Min/Max Skill), profile edit (self_rating picker), all filter UIs across /events, /compete, /tournaments. Keep dual-write on the write side."*
- **Verify:** Create a new tournament division with `format=mens_doubles`. Old `team_type` and `category` columns should still get written for now. New `format` column should drive all display and match generation.

### [ ] 4.2 Taxonomy Phase 3 — drop old columns
- **See:** `docs/joinzer-taxonomy-migration-plan.md` §5 Phase 3.
- **What:** Stop writing to old columns, drop them.
- **Prompt:** *"After Phase 2 has run clean in prod for at least a week, implement Phase 3: stop writing to the old columns (category, team_type, skill_level, joinzer_level, min_skill, max_skill), drop them from the schema, and remove any backward-compat code paths."*
- **Verify:** All forms still work. All filters still work. Run a tournament + league end-to-end.

---

## Batch 5 — Marketing + discovery

Once the product works, unlock growth. Don't ship before Batch 1–3 land.

### [ ] 5.1 Public read-only `/events` and `/compete`
- **What:** A visitor can browse upcoming sessions, leagues, tournaments without logging in. Auth required only to *join*.
- **Prompt:** *"Make /events, /compete, and /tournaments work for unauthenticated visitors. Show all upcoming events (read-only). Replace 'Join' / 'Register' CTAs with login prompts that redirect back to the same URL after auth. Make sure RLS policies allow anonymous SELECT on the relevant tables (with appropriate column filtering — no email addresses leaked)."*
- **Verify:** Open in incognito, browse the events feed without logging in.

### [ ] 5.2 Public `/courts/[slug]` pages
- **What:** One SEO-indexable page per location. Pulls upcoming sessions at that court. Big organic-search unlock.
- **Prompt:** *"Generate /courts/[slug] dynamic pages — one per location in the seed data. Each page shows: court name, address, parking notes, indoor/outdoor, court count, and a list of upcoming sessions/leagues/tournaments at that location. Generate slugs from location names. Add to sitemap.xml. SEO meta tags per page."*
- **Verify:** Visit `/courts/sunset-park-pickleball-complex` (or whatever slug pattern) and see upcoming events there.

### [ ] 5.3 Kill the password field on login
- **What:** Recreational pickleball app does not need passwords. Google + magic link only.
- **Prompt:** *"On the login page, remove the email+password form entirely. Keep Google OAuth and add a magic-link option using Supabase Auth's signInWithOtp method. Remove the Forgot Password flow. Migrate any existing password-only users via a one-time magic-link prompt on next login."*
- **Verify:** Login page only shows Google + magic link. Existing accounts can still log in.

### [ ] 5.4 Organizer-facing copy on the homepage
- **What:** Marketing site is entirely player-facing. Add a section that speaks to organizers.
- **Prompt:** *"On the marketing homepage, add a section above the footer: 'For Organizers' with three bullets — Reliable RSVPs + waitlists, No-show tracking, Built-in chat. Plus a CTA: 'Run your league on Joinzer'. Link to /login (or a future /for-organizers landing page)."*
- **Verify:** Visit the marketing homepage, see organizer section.

### [ ] 5.5 Live counter on homepage
- **What:** "3 sessions tonight near Henderson." Pulled from Supabase, cached.
- **Prompt:** *"On the marketing homepage hero, add a live counter pulled from Supabase: 'X sessions this week · Y players in Vegas · Z courts covered'. Cache for 5 minutes server-side."*
- **Verify:** Counter shows real numbers, not zeros.

### [ ] 5.6 "Notify me when registration opens" on Coming Soon leagues
- **What:** Capture intent now, email later. Free retention.
- **Prompt:** *"On any league with registration_status = 'upcoming', show a 'Notify me when registration opens' button next to 'I'm interested in subbing'. Tapping it records an email subscription. When the league's status flips to 'open', send all subscribers an email."*
- **Verify:** Tap notify on cbcvxbvcx, manually flip to Open in the DB, confirm email fires.

---

## Tech debt / follow-ups from Batch 3

Small, non-blocking. Do these after 3.2 and remaining 3.6 items.

- **[ ] Email HTML escaping** — Add `escapeHtml()` to `lib/email/templates.ts` and apply to all interpolations (heading, firstName, intro, label/value rows, footerNote). User-controlled data flows in unescaped today. Low risk now (internal), but needs fixing before any user-supplied content (e.g. league name with `<`) reaches the template.
- **[ ] ICS line folding** — Fold output lines at 75 octets per RFC 5545 §3.1. Most clients tolerate unfolded. Implement in `lib/email/ics.ts` `buildVevent()`. Test with Apple Calendar and Google Calendar.
- **[ ] Type the locations nested select in `/api/tournaments/[id]/ics`** — Remove `(tournament.location as any)` cast. Add a manual interface for the `locations!location_id` nested-select result shape from Supabase PostgREST.

---

## Backlog (everything else, lower leverage)

Don't pull from here unless you're between batches or a specific item becomes a customer ask.

- Confirmation modals on all destructive actions (delete tournament, delete league, leave session)
- Persistent "Install Joinzer App" floater — make dismissible per session
- Date display polish: DOW after picking a date; "Sat, May 16" in summary blocks
- Time picker as single input with "9:30am" string parsing instead of three dropdowns
- Tournament "Prep →" stage made explicit (Prep / Live / Complete stepper, state-aware UI)
- Per-row state-aware match CTA (Edit / Enter score / View score depending on stage)
- "OPEN" vs "FULL — Waitlist open" badge distinct from publication state
- Tournament Setup Checklist gates: don't let "Open registration" succeed with zero divisions
- "Generate Matches" tooltip when disabled, explaining why
- Tiebreaker rules visible next to "Ranked by wins"
- QR Check-in tooltip / explainer copy
- Court-allocation conflict detection across simultaneous divisions
- Skill validation on registration (soft warning when player's rating is outside division range)
- Description rich-text or structured rows (parking, bring, contact, rules link)
- Recent locations as quick-pick chips for organizers
- "Import as: Registered / Waitlist" toggle on CSV import
- Duplicate detection in CSV preview
- Bulk pairing UI for unpaired registrants
- Public share preview / OG cards per session
- "Near me" sort/filter on Play feed using location data
- Per-session "My matches" filter on the round-robin schedule
- Player tournament registrations panel on Home + Profile ("Your tournaments")
- Live Scoreboard pre-play state (bracket / schedule / teams instead of blank)
- Schedule auto-gen needs day-of-week and time, not just dates
- Session count display on league overview ("7 weeks · 7 sessions")
- Standings page hides "Enter results" link from non-orgs
- Bulk announce to subs / roles in League Chat
- Export roster CSV, export standings CSV
- Per-session reminder copy + audience picker on Send Reminder
- Sub Credit Cap copy made friendlier (the term is jargon)
- Players directory (`/players`) — **never reviewed**
- Mobile-viewport pass — **never reviewed**

---

## Decisions

Things only you can decide. Each one blocks at least one ticket above. Write the decision into `docs/decisions.md` so Claude Code reads it in future sessions.

### [ ] Test data handling on /compete
Blocks: 0.2
- **Option A:** Tag with `is_test`, filter from public lists, give yourself a `?showTest=1` query param.
- **Option B:** Delete the test rows outright.
- **Recommendation:** A — keeps your test surface intact.

### [ ] Import — "No account" rows: invite or skip?
Blocks: 0.4, 1.5
- **Option A:** Create stub accounts (placeholder user rows) and send email invites. Account is "claimed" when they sign up.
- **Option B:** Skip those rows, surface them in the Preview as red, let the org collect emails another way.
- **Option C:** Both — let the org choose at commit time via a checkbox: "Send invites to emails without accounts."
- **Recommendation:** C — fits real org workflows where some lists are "send to all" and others are "skip strangers."

### [ ] Mixed Doubles gender enforcement
Blocks: nothing critical, but informs taxonomy work.
- **Decided:** Advisory only — no code-level enforcement. ✅

### [ ] League partner billing
Blocks: 2.4
- **Option A:** Captain pays for both (team fee = 2× per-person).
- **Option B:** Each partner pays separately (captain pays first, partner pays when accepting the invite).
- **Option C:** Org chooses per league at creation.
- **Recommendation:** B for MVP — matches how most paid rec leagues actually run, no awkward "I owe you $10."

### [ ] Refund policy
Blocks: 3.4
- **Option A:** Auto-refund until registration deadline, no refund after.
- **Option B:** Manual refunds only, org decides case-by-case.
- **Option C:** Tiered — 100% before deadline, 50% within X days, 0% within Y days.
- **Recommendation:** A — simple, automatable via Stripe API, no chargebacks.

### [ ] Solo auto-matcher
Blocks: 3.5
- **Option A:** Ship the real matcher (FIFO, daily cadence, email notification).
- **Option B:** Change the copy to honest manual fallback.
- **Recommendation:** B first (ships in an hour), A later when there's enough solo traffic to make it worth building.

### [ ] Login flow
Blocks: 5.3
- **Decided:** Move to Google + magic link, kill password. ✅ (Implied earlier.)

---

## How Claude Code should work in this repo

A few patterns that compound across sessions:

1. **`docs/decisions.md`** — every product decision lives here. Format: `## Decision YYYY-MM-DD: [topic]` + the decision + the reasoning. Claude Code reads this at the start of every session.
2. **`docs/architecture.md`** — for things like the taxonomy migration. Implementation plans live here. Update as decisions land.
3. **One ticket per session.** Smaller scope = cleaner diffs = faster review = fewer regressions.
4. **Verify in prod between batches.** Especially after 1.1 (taxonomy Phase 1) and 4.1 (Phase 2). Dual-write should run for at least a few days before you trust the data.
5. **When in doubt, run the audit query.** The §3.2 audit in the migration plan should be run after backfill and before any column drops.
6. **Don't let Claude Code design.** It executes well, designs poorly. When you find yourself in a "Claude is improvising the UX" loop, drop the prompt and write the spec first.
