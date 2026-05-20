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

### [x] 1.1 Taxonomy migration — Phase 1 (additive, dual-write) — applied 2026-05-18, commit d5a1c13
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

### [x] 1.6 Switch reads to new format helpers — closed 2026-05-19
- Covered by 3A (events read cutover, merge cd2ffaf) and 3C (tournament divisions read cutover, merge 40767d6). All `team_type`/`category`/`skill_level` reads on tournament surfaces replaced with `isDoublesFormat(format)`, `formatSkillRange(skill_min, skill_max)`, and `FORMAT_LABELS`. Leagues surface tracked separately as ticket 3B.

---

## Batch 2 — Leagues become sellable

Without these, the league flow can't actually run a paid season. P2.1 is the biggest hole.

### [x] 2.1 Roster panel on league overview — shipped 2026-05-18, commit 14b66ae
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

### [x] 2.6 Organizer name on league list and detail pages (PR #13, 2026-05-15)
- **Where:** `app/(app)/compete/page.tsx`, `app/(app)/compete/CompeteClient.tsx`, `app/(app)/compete/leagues/[id]/page.tsx`
- **What:** Added `creator:profiles!created_by (name)` join to the leagues list query. Organizer name renders as a footer strip on each league card on `/compete`, and as the first row in the details card on the league detail page.
- **Decision:** Organizer display names are public on league surfaces. No opt-out at pilot scale. See `docs/decisions.md` 2026-05-15.
- **TypeScript note:** Supabase infers many-to-one FK joins as arrays; the cast `as unknown as Parameters<typeof CompeteClient>[0]['leagues']` reconciles inferred type with the correct runtime object shape. Same pattern used in `compete/page.tsx` and `tournaments/page.tsx`.

---

## Batch 3 — Trust and money

These don't fix anything broken; they raise confidence around payments, identity, notifications. Compounds once real money flows.

### [x] 3.1 Transactional confirmation email after registration
- **Where:** Tournament + League registration completion hook.
- **What:** Today: modal closes, nothing else. Send an email with confirmation + date + location + partner status + add-to-calendar `.ics`.
- **Prompt:** *"Wire up a transactional email on successful tournament/league registration. Include: event name, date, time, location with map link, captain name, partner status (confirmed / invited / pending), entry fee paid, refund policy link, and an .ics attachment for adding to calendar. Use Supabase Edge Functions + Resend (or whatever email provider is already wired)."*
- **Verify:** Register for the 10 league, check inbox.
- **⚠️ Reverted 2026-05-15:** First attempt broke free-league registration on prod. Root cause: the `.select()` in `app/api/league-register/route.ts` added `play_time` as a column on `leagues`, but `play_time` does not exist on that table (it lives on `league_sessions`). This caused the `leagueErr || !league` guard to fire for all free-league registrations. Before re-doing: run `SELECT column_name FROM information_schema.columns WHERE table_name = 'leagues'` against the live DB to confirm available columns — do not infer schema from other files.
- **📋 Spec after 2026-05-15 investigation:** `leagues` has no `play_time` column and no structured time field — only `schedule_description` (free text, e.g. "Wednesdays 6–9 PM"). Decision: use `schedule_description` for the email Schedule row; no play_time anywhere. ICS events use `session_date` (YYYY-MM-DD) as all-day entries — honest about what the schema knows. Salvage `lib/email/ics.ts` and `lib/email/templates.ts` from `feat/confirmation-email-ics` (both correct); rewrite all route code from scratch on a fresh branch from main. Do not branch from `feat/confirmation-email-ics`.

### [x] 3.1.1 Fix session-reminders cron: drop phantom play_time reference
- **Where:** `app/api/cron/session-reminders/route.ts`
- **What:** The cron joins `leagues!league_id (name, location_name, play_time)` — but `play_time` has never existed on `leagues`. PostgREST silently returns null, so the Time row is silently omitted from every league session reminder. Replace with `schedule_description`; rename the email template row label from "Time" to "Schedule".
- **Verify:** Trigger the cron manually against a league with a schedule_description set. Confirm the reminder email shows the schedule line.
- **Note:** Reminders are still sending — just missing the schedule line. Not urgent; ship after 3.1.
- **Known limitation:** `schedule_description` is a recurring description (e.g. "Wednesdays 7–9 PM"), not a per-session start time. The reminder now shows something useful, but not "7 PM tonight." The real fix is a `start_time` field on `league_sessions` — deferred to the play_time storage decision (Option A/B/C from the 3.1 investigation). When that lands, the reminder email improves automatically.

### [x] Registration deadline enforcement (registration_closes_at standardization)
- **Where:** Tournaments, leagues, events — all three registration paths, all three create/edit forms, display pages.
- **What:** Standardized `registration_closes_at timestamptz` column on all three tables. Backfilled from existing data. Hard cutoff enforced server-side on all 4 registration paths. Forms use `datetime-local` input with auto-default (7 days before event at 23:59 PT). Deadline displayed on detail pages.
- **Deferred:** NOT NULL constraint on all three columns — evaluate coverage after deploy. League Match June has NULL start_date → NULL deadline (data quality issue, not blocking).

### [ ] FOLLOWUP — ptLocalToIso DST handling (non-urgent, surfaces ~Nov 2026)
- **Where:** `ptLocalToIso` defined in `components/features/tournaments/CreateTournamentForm.tsx`, `EditTournamentForm.tsx`, `components/features/events/CreateEventForm.tsx`, `EditEventForm.tsx`, `app/(app)/compete/leagues/create/CreateLeagueForm.tsx`, `app/(app)/compete/leagues/[id]/edit/page.tsx`
- **Bug:** Offset is determined by month alone (`month >= 4 && month <= 10 ? '-07:00' : '-08:00'`). This is wrong during DST transition windows: March 8–31 (function says PST, should be PDT) and November 2–30 (function says PDT, should be PST). Deadlines set by organizers in those ~3-week windows store an hour off from their typed intent.
- **Pilot impact:** No deadlines currently affected (Las Vegas, May 2026). Bug surfaces ~November 2026 or when March 2027 transitions hit.
- **Fix:** Replace with `Intl`-based offset extraction for the specific instant, or use `date-fns-tz`. The `Intl` API is doable but cumbersome for this; `date-fns-tz` (`parseInTimeZone` / `formatInTimeZone`) is cleaner. Decide at implementation time.
- **Test cases:** `2026-03-08 02:30` (DST start, should be PDT); `2026-11-01 01:30` (ambiguous — pick second occurrence per Postgres convention); `2027-03-14` (confirm not hardcoded to 2026 DST dates).
- **Note:** `isoToPtLocal` (used in edit forms) is correct — it uses `Intl.DateTimeFormat` with explicit timezone. Only the save path is affected.

### [x] 3.1.3 Hotfix: deadline guard ordering in league routes
- **Where:** `app/api/league-register/route.ts`, `app/api/leagues/[id]/checkout/route.ts`
- **Bug:** `registration_status` check fired before `registration_closes_at` check. A league with `status='upcoming'` and a past deadline returned `"Registration is not open"` instead of `"Registration is closed"` — hiding the actual reason from the player.
- **Fix:** Deadline check moved immediately after the 404 existence guard, before all other business-rule checks, in both routes.
- **Audit:** `tournaments/[id]/divisions/[divisionId]/register` and `events/[id]/checkout` were clean — no 'upcoming' analog on division or event status.
- **Verified:** POST `/api/league-register` with league `ee3785d2` (status=upcoming, past deadline) now returns `400 {"error":"Registration is closed"}`.

### [ ] 3.1.2 ICS download filename uses league/tournament name instead of generic slug
- **Where:** `app/api/leagues/[id]/ics/route.ts` line 58, `app/api/tournaments/[id]/ics/route.ts` line 55
- **What:** Both endpoints return `Content-Disposition: attachment; filename="joinzer-league.ics"` (or `joinzer-tournament.ics`). Users who download multiple calendar files end up with identically named files. Use the entity name to generate a slug, e.g. `wednesday-rec-league.ics`.
- **How:** `league.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')` + `.ics`. Same pattern for tournaments.
- **Verify:** Download two different leagues' ICS files. Filenames should differ and reflect the league name.
- **Note:** Cosmetic only. No functional impact.

### [x] 3.2 Show waitlist position
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
- **What:** `.ics` link on every registered card. Yellow Home banner when registered for an event with a still-pending partner. Reminder email 24h before play.
- **Prompt:** *"Three small adds: (1) On any registered-state card (tournament division, league registration), add an 'Add to calendar' link that downloads an .ics file. (2) On /home, render a yellow banner at the top when the user is registered for any event where their team has a pending partner: 'Pro Men tournament starts in 5 days — finish setting up your team. [Invite partner →]'. (3) Wire a scheduled function to send a reminder email 24 hours before any session/match the user is in."*
- **Verify:** Test all three; the reminder needs a scheduled function so verify it fires by setting a test event to start in an hour.

### [ ] 3.7 Editable event skill range
- **Where:** `components/features/events/EditEventForm.tsx` — Props type, form UI, update payload.
- **What:** Organizers can change a session's skill range after creation. Currently immutable post-creation, forcing delete-and-recreate.
- **Scope:** Add `min_skill_level` and `max_skill_level` to `EditEventForm` Props; add the two numeric inputs to the form UI; include them in the `.update()` payload; call `prepareEventWrite` (from `lib/taxonomy/write-helpers.ts`, added in ticket 4.1) so the new `skill_min`/`skill_max` columns are written at the same time. **Block on ticket 4.1 shipping first** — `prepareEventWrite` must exist before this wires it in.
- **Verify:** Edit an existing event; change the skill range; confirm `min_skill_level`, `max_skill_level`, `skill_min`, `skill_max` all update correctly on the row.

---

## Batch 4 — Taxonomy Phases 2 + 3

Continue the migration. Phase 2 is user-visible; Phase 3 is cleanup. Ship in parallel with Batch 3 if you want.

### [x] 4.1 Taxonomy Phase 2 — dual-write — shipped 2026-05-18, merge commit 3da35a1
- **See:** `docs/joinzer-taxonomy-migration-plan.md` §5 Phase 2.
- **What:** Switch reads to new columns. Ship Format dropdown on tournament division creation. Ship SkillRangePicker everywhere. Update filters.
- **Prompt:** *"Implement Phase 2 of the taxonomy migration. Switch all read paths to the new columns (format, skill_min, skill_max, self_rating). Build the SkillRangePicker shared component per §4.5 of the migration plan. Update: tournament division create form (replace Category × Team Type with Format), league create + edit forms (canonical Format list), play session create form (numeric Min/Max Skill), profile edit (self_rating picker), all filter UIs across /events, /compete, /tournaments. Keep dual-write on the write side."*
- **Verify:** Create a new tournament division with `format=mens_doubles`. Old `team_type` and `category` columns should still get written for now. New `format` column should drive all display and match generation.

### [x] 4.1.5 Rename tournament_divisions.format_type → bracket_type — applied 2026-05-18, merge 2e56ab8
- **What:** `format_type` is ambiguous next to the new `format` column. Rename to `bracket_type` to make the two axes self-documenting. Pure rename — no behavior change, no data change.
- **Why here:** Must come after Phase 2 (dual-write) has shipped and stabilized, so the rename PR only touches one concern. Must come before Phase 3 (column drop) so the drop PR operates on clean names.
- **Scope:** One migration (`ALTER TABLE tournament_divisions RENAME COLUMN format_type TO bracket_type`), one PR. Files affected: `FormatSettingsFields.tsx`, `DivisionsSection.tsx`, `MatchesSection.tsx`, `app/(app)/tournaments/[id]/page.tsx`, `app/api/tournaments/[id]/generate-all/route.ts`, `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts` — 6 files, ~15 references.
- **Prompt:** *"Rename tournament_divisions.format_type to bracket_type. Write the migration (RENAME COLUMN). Update all TypeScript references: the FormatType type alias, FORMAT_DEFAULTS, FORMAT_META, validateFormatSettings, formatSummaryLines, all state variables (fFormatType → fBracketType, editFormatType → editBracketType), all Supabase select/insert/update strings, and the generate-matches and generate-all API routes. After migrating, run generate_typescript_types and fix any remaining type errors."*
- **Verify:** Run `generate_typescript_types` post-migration. TypeScript compiler catches any missed references. Create a division and generate matches — confirm bracket type selector still works and matches generate correctly.
- **See:** `docs/decisions.md` — 2026-05-18 format_type vs format entry. `docs/investigations/format-type-vs-format-2026-05-18.md` for full investigation.

### [x] 3A — Events read cutover — 2026-05-18, merge cd2ffaf
- **What:** Swap `min_skill_level` / `max_skill_level` reads to `skill_min` / `skill_max` across all events surfaces. Numeric-to-numeric, identical semantics — lowest risk of the three cutover tickets.
- **Files:** `lib/types.ts` (EventListItem / EventDetail type declarations), `app/(app)/events/page.tsx` (select string + JS post-filter lines 84–88), `app/(app)/events/[id]/page.tsx` (select string), `app/(app)/events/create/page.tsx` (template pre-fill select + defaults lines 58–59), `components/features/events/EventCard.tsx` (render).
- **Bonus fix:** EventCard renders `{event.max_skill_level?.toFixed(1)}` which produces blank or "undefined" when `max_skill_level` is NULL — 7 of 20 events have min-only skill ranges. Fix render to show "3.0+" when max is null. Pre-existing bug surfaced during audit.
- **Verify:** Events list renders correctly with skill filter active. Detail page shows skill range. Duplicate-event flow (`?from=`) pre-fills skill correctly. EventCard shows "3.0+" for open-ceiling events rather than "3.0 –".
- **Audit source:** `docs/investigations/phase3-read-cutover-audit-2026-05-18.md` RS-E1/E2/E3/E4, RD-E1/E2/E3/E4.

### [x] 3A.1 — Garbage division cleanup — 2026-05-18
- **What:** Delete the 4 `tournament_divisions` rows with NULL `format`: "single" (id 46985294), "Open" (d4330f4c), "double" (6c69c827), "Women" (ababe148). Confirmed test/malformed rows created via now-removed broken UI options (the `'Open'` skill entry removed 2026-05-18 and similar artifacts). All have single-word names, no skill data.
- **How:** Verify zero `tournament_registrations` and `tournament_matches` reference these IDs. Then delete via migration or direct SQL.
- **Verify:** `SELECT COUNT(*) FROM tournament_divisions WHERE format IS NULL` returns 0.
- **Blocks:** 3C — Phase 3C cannot safely enforce NOT NULL on `format` until these rows are gone.

### [x] 3C — Tournament divisions read cutover — merged 2026-05-19, merge SHA 40767d6
- **What:** Swap `category`, `team_type`, and `skill_level` reads on `tournament_divisions` to `format`, `skill_min`, `skill_max`. Most complex of the three tickets: `team_type` drives logic in 5 places, `category` drives the player-search gender filter.
- **Key changes:**
  - All `team_type === 'doubles'` checks → `['mens_doubles','womens_doubles','mixed_doubles','coed_doubles'].includes(format)` — affects `DivisionsSection.tsx` lines 258/822/1028, `MatchesSection.tsx` line 110, `ScheduleManager.tsx` line 32, `MyMatchesSection.tsx` line 110, register route line 52
  - `div.category` passed to `searchPlayers` for gender filter → replace with format-based check (`format === 'mens_doubles'` → male, `format === 'womens_doubles'` → female)
  - `CATEGORY_LABELS[div.category]` display → replace with format label map
  - `div.skill_level` display badge → replace with `skill_min`/`skill_max` range display
  - Add `format`, `skill_min`, `skill_max` to select strings; remove `category`, `team_type`, `skill_level`
- **Prerequisite:** 3A.1 (4 null-format rows deleted).
- **Verify:** Create a mens doubles division — player search filters to male players. Generate matches for a doubles division — match rows show "LastName / LastName". Solo registration correctly blocked/allowed per division format. Division badge renders format label and skill range.
- **Audit source:** `docs/investigations/phase3-read-cutover-audit-2026-05-18.md` RS-D1/D2, RD-D1 through D9.

### [ ] 3B — Leagues read cutover
**Status:** Pending — audit prompt drafted, not yet fired. Restart with: league_sub_requests mini-audit + form shape decision A/B/C (see Prerequisites below).
- **What:** Swap `skill_level` reads on `leagues` to `skill_min` / `skill_max`. Includes a form shape change: the skill level `<select>` (string enum) becomes a numeric range picker backed by the new columns. The `CompeteClient` filter (`SKILL_LEVEL_TO_TIER` string lookup) must be replaced with a range-to-tier reverse lookup.
- **Prerequisite (must complete before starting):** Mini-audit of `league_sub_requests` table — `PlayerCheckIn.tsx` posts `league.skill_level` as `requested_skill_level` to this table. Audit what reads `requested_skill_level` downstream (organizer screens, notifications, any dashboards) before dropping the source column. Add findings to `docs/decisions.md` before the PR opens.
- **Key changes:**
  - `compete/page.tsx` select: add `skill_min`, `skill_max`; remove `skill_level`
  - `home/page.tsx`, `schedule/page.tsx`: same
  - `CompeteClient.tsx`: replace `SKILL_LEVEL_TO_TIER` filter with numeric range comparison (lines 18–86)
  - `leagues/[id]/edit/page.tsx`: skill dropdown → range picker (UX design call needed)
  - `leagues/create/CreateLeagueForm.tsx`: same
  - `leagues/[id]/page.tsx` `SKILL_LABELS` badge: replace with range display
  - `league-register/route.ts`, `members/route.ts`: email copy update
  - `PlayerCheckIn.tsx`: update `requested_skill_level` payload to numeric range or drop the field
- **Verify:** League list filter works with skill range active. Edit league shows existing skill range. Create league persists skill range correctly.
- **Audit source:** `docs/investigations/phase3-read-cutover-audit-2026-05-18.md` RS-L1 through L7, RD-L1 through L8.

### [ ] 4.2 Phase 4 — Drop legacy columns
**Status:** Blocked on 3B.
- **Gate:** All of 3A, 3A.1, 3C, 3B must be live and stable in production for at least 7 days before this ticket starts.
- **What:** Stop dual-writing to legacy columns, then drop them from the schema. Remove legacy columns from `prepareLeagueWrite`, `prepareDivisionWrite`, `prepareEventWrite` helpers. Write and apply migration with DROP COLUMN statements. Remove any remaining backward-compat code paths.
- **Columns to drop:**
  - `events`: `min_skill_level`, `max_skill_level`
  - `leagues`: `skill_level`
  - `tournament_divisions`: `category`, `team_type`, `skill_level`
- **Verify:** All forms still work. All filters still work. Run a tournament + league end-to-end. `SELECT column_name FROM information_schema.columns WHERE table_name IN ('leagues','tournament_divisions','events')` — confirm dropped columns are absent.

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

## Bugs

Live-discovered defects, ordered by severity. Ship B6 before B2 before B1.

### [x] Issue 3 — Partner invite modal missing for paid tournament registrations — verified 2026-05-19, merge d958b6b
- **Root cause:** Commit `7032cbc` added an immediate Stripe redirect for paid registrations, inserting a `return` before the `setJustRegistered()` call that opens the partner invite modal. Paid doubles team registrations bypassed Step 2 entirely, leaving `partner_user_id` unlinked and "Pay for Both" unavailable.
- **Fix:** Three-way fork in `handleRegister` — paid doubles team shows partner invite first, payment fires on modal close via `handleClosePartnerModal`; paid solo/non-doubles still redirect immediately; free path unchanged. `justRegistered` type extended with `requiresPayment: boolean`.
- **Verified live:** Two-user smoke test (Roderick as inviter, Precious as invitee) — inviter saw modal, Stripe redirect fired; invitee saw Pay for Both option in their view.
- **Full context:** `docs/investigations/payment-gate-and-partner-pay-audit-2026-05-19.md` §Issue 3

### [x] B6 — Refund payment_status CHECK constraint mismatch — verified 2026-05-19, migration 20260519000001_fix_payment_status_refunded.sql
- **What:** `tournament_registrations.payment_status` CHECK only allows `('unpaid','paid','waived')`. The cancel route (`app/api/tournaments/[id]/registrations/[regId]/cancel/route.ts:59`) writes `'refunded'` — silently failing the constraint check. The `status='cancelled'` update succeeds. Result: all cancelled-after-paid registrations show `payment_status='paid'` permanently. The `refunded_at` column write likely fails too (column may not exist).
- **Fix:** Migration to add `'refunded'` to the CHECK constraint + verify `refunded_at timestamptz` column exists (add if missing). No code changes needed once the schema matches.
- **Evidence:** Marty's test row `2493b247` in division `3dc096c9` — `status='cancelled'`, `payment_status='paid'`, confirming the silent failure. Full context: `docs/investigations/pay-for-both-option-b-audit-2026-05-19.md` §3 incidental finding.
- **Verified:** 0 rows in broken state post-migration; Marty's row `payment_status='refunded'`, `refunded_at='2026-05-18 22:24:51.792561+00'`; new constraint confirmed via `pg_get_constraintdef`.

### [ ] B6.1 — Harden cancel route DB error checking (depends on B6)
- **What:** `app/api/tournaments/[id]/registrations/[regId]/cancel/route.ts` does not check return values from either Supabase `update()` call. After B6 fixes the CHECK constraint, the silent-fail vector is closed for that specific case, but the route still has no error handling on either DB write. Specifically: if the `payment_status='refunded'` write fails post-Stripe-refund, money has moved but the DB doesn't reflect it. Same risk on the `status='cancelled'` write.
- **Design needed before build:** What should the route do when a DB write fails after Stripe has already processed the refund? Options: return 500 and surface to the caller; retry with backoff; write to a dead-letter table; fire an alert. Each has tradeoffs. Resolve the design question before opening the PR.
- **Scope:** ~30–60 min audit + design + build.
- **Gate:** B6 must be deployed first. Out of scope for B6.

### [ ] B2 — Concurrent "Pay for Both" double-charge race (HIGH financial bug)
- **What:** No DB-level or route-level guard prevents both partners from clicking "Pay for Both" simultaneously. Both requests pass the `payment_status='unpaid'` check, both create Stripe sessions at 2× price, both complete → $20 charged for a $10 fee. Webhook uses unconditional UPDATE — silently overwrites `stripe_payment_intent_id` with the second payment, losing audit trail for the first.
- **Fix required (two layers):**
  1. Checkout route: after fetching partner's reg, if `partnerReg.payment_status === 'paid'`, return 409 "Already covered by your partner" instead of degrading to quantity=1.
  2. Webhook: add `AND payment_status = 'unpaid'` filter on the partner row UPDATE so a second firing doesn't clobber the first PI ID.
  3. (Optional, architecturally correct): Wrap payment status transitions in an RPC with `SELECT FOR UPDATE` per `docs/architecture-target.md` principle.
- **Must land before:** B1. Do not ship symmetric Pay for Both UI until this guard exists.
- **Full context:** `docs/investigations/pay-for-both-option-b-audit-2026-05-19.md` §5, §7 B2.

### [ ] Update add-division form to use canonical format values directly
- **What:** Add-division form's `fCategory` + `fTeamType` state still holds legacy column values (`mens_doubles`, `singles`, `open` + `doubles`/`singles`), requiring `prepareDivisionWrite()` translation on every insert. Cleaner design: drop the separate Team Type field, change Category dropdown to a single Format dropdown using canonical values (`mens_doubles`, `mens_singles`, `mixed_doubles`, `open_singles`, etc.). Reduces Phase 4 cleanup surface.
- **Out of scope for 3C.** Addressable alongside 3B leagues form refactor.

### [ ] B1 — Symmetric "Pay for Both" UI (depends on B2)
- **What:** Inviter's React state is stale after invitee accepts — `myReg.partner_user_id` is null in client memory until a manual page refresh, so "Pay for Both" button never appears for the inviter. Both DB rows have `partner_user_id` set; only the client is stale.
- **Scope (three sub-items):**
  1. Stale state fix: call `router.refresh()` after the partner invite is sent (post-`setInviteSent`) so the next server render picks up the accepted state — OR add a Supabase real-time subscription on the own registration row.
  2. "Already paid by partner" display: when `myReg.payment_status === 'paid'` and `myReg.stripe_payment_intent_id === partnerReg.stripe_payment_intent_id`, show "Partner covered your fee" instead of the generic "$ Payment received". Requires partner's reg data in the page query.
  3. `handlePay` double-click guard: add a per-reg-id `payLoading` state, disable both payment buttons while checkout POST is in-flight. Prevents same-browser double-fire.
- **Gate:** B2 must be deployed and verified before this ships.
- **Full design:** `docs/investigations/pay-for-both-option-b-audit-2026-05-19.md` §6, §7 B1/B3/B5.

### [ ] B7 — Tournament registration pattern inconsistency (Pattern A vs Pattern C)

**Root cause (from paid-reg survey 2026-05-20):** Tournaments use Pattern A — registration row created immediately on register, BEFORE payment, with `payment_status='unpaid'`. Leagues and events use Pattern C — row created only after payment succeeds via webhook. Pattern A produces: unpaid rows in rosters, payment-blind isRegistered checks, no cleanup for abandoned checkouts, spot-holding without payment.

**Decision:** Standardize tournaments on Pattern C. Do NOT add a cleanup cron for Pattern A — that maintains two patterns. Pattern B (held-team, league split-payer 2.4) remains the intentional exception for two-party payment flows.

**Tickets — ship in this order:**

### [ ] B7.1 — Tournament player roster is payment-blind (HIGHEST — ship today)
- **What:** `app/(app)/tournaments/[id]/page.tsx` player-path registration processing includes unpaid and cancelled rows. Players without payment appear in division rosters and the "you're registered" banner shows for them.
- **Scope of fix:** Filter `regsRaw` at the player-view processing step (before building `regsByDivision`, ~line 350) to include only `payment_status IN ('paid', 'waived')` AND `status != 'cancelled'`. Do NOT filter the raw query (line 74–76) — the organizer path uses the same `regsRaw` and legitimately needs unpaid rows for payment management.
- **Verify:** A `tournament_registrations` row with `payment_status='unpaid'` should not appear in any player-facing division roster or isRegistered check.

### [ ] B7.2 — Tournament isRegistered check is payment-blind (HIGHEST — ship today)
- **What:** `page.tsx:368` — `reg.status === 'registered'` check gates the "you're registered" banner but doesn't require payment. After B7.1 filters the player path, this is implicitly fixed — add explicit `payment_status === 'paid' || payment_status === 'waived'` as defense-in-depth.
- **Verify:** Register for a tournament, don't pay. Should not see "you're registered" banner.

### [ ] B7.3 — Refactor tournament solo registration to Pattern C (HIGH)
- **What:** Move INSERT from `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` to the `checkout.session.completed` webhook handler. Register route becomes: validate → capacity check (advisory) → create Stripe session with registration metadata → return URL. Webhook fires on payment → INSERT registration → send confirmation email.
- **Impact:** `DivisionsSection.tsx` `handleRegister` flow changes: no longer adds a registration to local state immediately; instead redirects to Stripe (or shows partner invite modal first for doubles).
- **B1 realtime subscription:** Will need adjustment or removal — subscription fires on UPDATE, not INSERT. After Pattern C, the INSERT happens in webhook. Review whether the subscription still serves a purpose.
- **Scope:** `register/route.ts` (full rewrite), webhook `checkout.session.completed` handler (new tournament solo path), `DivisionsSection.tsx` `handleRegister` (remove optimistic INSERT add, adjust flow).
- **Note:** Free divisions skip Stripe and still INSERT inline — that path is fine as-is.

### [ ] B7.4 — Refactor tournament partner invite acceptance to Pattern C (HIGH)
- **What:** `app/api/tournaments/invite/[token]/route.ts` — acceptance path currently creates the invitee's `tournament_registrations` row with `payment_status='unpaid'` (unset default). Under Pattern C: acceptance creates only the invitation acceptance record and redirects to Stripe (if paid division). Webhook creates the invitee's row.
- **Scope:** `invite/[token]/route.ts` accept branch (create Stripe session instead of INSERT), webhook (new tournament partner-accept path), `app/(app)/tournaments/invite/[token]/page.tsx` (flow update).
- **Dependency:** B7.3 must design the tournament webhook path first; B7.4 extends it.

### [ ] B7.5 — Refactor tournament team Pay for Both to Pattern C (HIGH)
- **What:** `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` + `app/api/tournaments/[id]/checkout/route.ts` — under Pattern C, the checkout route no longer receives an existing `registration_id` to reference. The registration row doesn't exist until the webhook fires. This is the biggest structural change in the B7 family.
- **Design note:** The "Pay for Both" concept (one person pays 2× for themselves and partner) may simplify under Pattern C — the partner's row is created by the webhook at the same time as the payer's. Revisit B2 RPC backlog ticket after this ships.
- **Dependency:** B7.3 and B7.4 must be fully designed before B7.5 scoping begins.

### [ ] B7.6 — One-time cleanup of existing bad data (MEDIUM)
- **What:** Delete or cancel `tournament_registrations` rows with `payment_status='unpaid'` older than 24 hours. SQL migration. Confirm zero live unpaid rows before running.
- **Gate:** After B7.1 and B7.2 ship (so the app no longer surfaces these rows), and before B7.3 (so cleanup is complete when Pattern C lands).
- **Note:** Run `SELECT COUNT(*) FROM tournament_registrations WHERE payment_status = 'unpaid'` before writing migration to understand blast radius.

### [ ] B7.7 — Standardize capacity-check timing across surfaces (LOW)
- **What:** Events check capacity at checkout-session-creation time using `participant_status = 'joined'` (excludes waitlist). Leagues use `IN ('registered', 'pending_partner')`. After B7.3–B7.5 land, audit that all three surfaces use equivalent filters and document the canonical rule in decisions.md.
- **Dependency:** B7.3–B7.5 must be complete.

---

### [ ] B11 — Cancel-and-re-register orphans partner linkage (HIGH integrity bug)
- **What:** When an inviter cancels their registration and re-registers, the new row is created with `partner_user_id=null`. Their previous partner's row still has `partner_user_id` pointing to the cancelled row, leaving the partner's "Pay for Both" / partner-relationship logic pointing into the void. The cancel route (`app/api/tournaments/[id]/registrations/[regId]/cancel/route.ts`) only updates the cancelling user's row — does not null out the partner's `partner_user_id` or notify them. The invite-acceptance route does not re-link an existing partner on re-registration.
- **Reproduced live:** 2026-05-19, division `3dc096c9-b9c1-438b-bb0e-e675567b7a4a` — Roderick re-registered after cancellation; Precious's row still pointed to cancelled reg `ad15f730`; new row `fb73cbc0` has no partner link.
- **Design note:** Belongs to the architectural partner-flow ticket family with B1/B2. Likely should be solved as one design pass (what does cancel mean for both halves of a partnership?), not patched in isolation. Out of scope for tonight.

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

## Process Notes

Rules that apply to every session with Claude Code on this repo. Written here so they survive any local memory wipe and are visible to anyone reading this file.

### Merge gating
All PRs must wait for Marty's explicit "merge it" signal before merging. Claude Code does not click the merge button. Claude Code opens the PR, reports the URL, and stops. PR #10 (ticket 3.1 retry, 2026-05-15) was merged without a code review — that is the incident this rule prevents going forward.

---

## How Claude Code should work in this repo

A few patterns that compound across sessions:

1. **`docs/decisions.md`** — every product decision lives here. Format: `## Decision YYYY-MM-DD: [topic]` + the decision + the reasoning. Claude Code reads this at the start of every session.
2. **`docs/architecture.md`** — for things like the taxonomy migration. Implementation plans live here. Update as decisions land.
3. **One ticket per session.** Smaller scope = cleaner diffs = faster review = fewer regressions.
4. **Verify in prod between batches.** Especially after 1.1 (taxonomy Phase 1) and 4.1 (Phase 2). Dual-write should run for at least a few days before you trust the data.
5. **When in doubt, run the audit query.** The §3.2 audit in the migration plan should be run after backfill and before any column drops.
6. **Don't let Claude Code design.** It executes well, designs poorly. When you find yourself in a "Claude is improvising the UX" loop, drop the prompt and write the spec first.
7. **Place new business-rule checks at the right priority level, not the end of the chain.** When adding a new guard to an existing route, determine where it belongs in the check hierarchy — don't append to the end. Deadline checks (hard time gates with specific user-facing messages) belong immediately after the 404 existence guard, before status/capacity/payment checks. Appending to the end masks the real error with a staler one. Caught in PR #11 review, fixed in PR #12 (fix/deadline-guard-ordering).

---

## Repo hygiene

Low-urgency maintenance tasks. Pull from here between feature sessions.

### [ ] Audit untracked files in main working tree
- **What:** Several untracked files exist in the working tree that are neither committed nor in `.gitignore`: `CLAUDEv1.md`, `Joinzer_Platform_Overview.md`, `Joinzer_Platform_Overview.pdf`, `next-start-3001.log`, `test-results/`, `verification-report.md`, `.claude/worktrees/`.
- **Action:** For each: decide committed to repo / added to `.gitignore` / deleted. Run `git status` to get a fresh list — this may drift.

### [ ] Audit and drop profiles.display_name column
- **What:** `profiles.display_name` is NULLABLE, never populated, never queried. Every surface uses `profiles.name`. Decision needed: backfill from `name` or drop.
- **Action:** Run `SELECT COUNT(*) FROM profiles WHERE display_name IS NOT NULL` against prod. If zero rows, file a migration to drop the column. If any rows exist, audit what populated them before dropping.
- **Note:** Flagged during PR #13 organizer-display-on-leagues (2026-05-15). Recorded in `docs/decisions.md` open questions.

### [ ] Clean up (as any) cast on league detail creator join
- **Where:** `app/(app)/compete/leagues/[id]/page.tsx` — `(league as any).creator?.name`
- **What:** The creator join uses a raw `(league as any)` cast. Should use the `Parameters<typeof Component>[0]['propName']` pattern from `compete/page.tsx` for consistency.
- **Note:** No functional impact — cosmetic TypeScript improvement only. Low priority.

### [ ] Install pg_dump on dev machine for future destructive migrations
- **What:** Pre-migration backups currently rely on table exports via the Supabase MCP (SELECT * → JSON). This does not capture DDL, sequences, triggers, RLS policies, or FK ordering. For rename-only or additive migrations it is an acceptable safety net; for column drops or data-destructive migrations it is not sufficient.
- **Action:** Install PostgreSQL client tools (`pg_dump`) on the dev machine OR wire up `supabase db dump` via the Supabase CLI. Either produces a proper binary/SQL dump including schema. Store DB credentials in `.env.local` (gitignored).
- **Note:** Flagged during 1.1 staging (2026-05-15) and again during 4.1.5 (2026-05-18) — `pg_dump` was not found on the machine during both pre-migration backup steps. Primary recovery for both migrations remains the Supabase scheduled backup.

### [ ] Standardize backup file location and migration header reference
- **What:** The pre-1.1 backup file was saved to an absolute OS path (`C:\Users\marty\joinzer-backups\`) and that path was written into the migration file header. Absolute paths are machine-specific and will break if the project moves or a second contributor joins.
- **Action:** Decide on a standard backup location (e.g., `~/joinzer-backups/` documented in a README, or a relative `backups/` dir outside the repo). Migration headers should reference `date + git commit SHA`, not an OS path.
- **Note:** Flagged during 1.1 staging (2026-05-15). Low urgency — applies from 1.2 onwards.

### [ ] Build repeatable waitlist UI test
- **What:** Ticket 3.2 shipped unverified on prod — no league_registrations with status='waitlist' exist in the DB at pilot stage (no leagues are full yet).
- **Options:** (a) SQL seed inserting a waitlist row directly; (b) set max_players=1 on a test league, fill it with account A, then register account B (auto-waitlisted). Option (b) tests the real code path end-to-end and is preferred for any future waitlist work.
- **Action:** When a second test account is available, use option (b) to exercise the full waitlist flow and verify "Waitlist #N of M" renders correctly.

### [ ] Add vitest.config.ts to restrict include to lib/**/*.test.ts
- **What:** Vitest's default include glob (`**/*.spec.ts`) sweeps `tests/e2e/*.spec.ts`, which are Playwright E2E specs. Running `npx vitest run` (or `npm run test:unit`) currently produces 8 "failed" suites from Playwright tests — the error is a framework identity conflict ("Playwright Test did not expect test.describe() to be called here"), not an assertion failure. The 15 real unit tests in `lib/` all pass, but the misleading red output obscures the signal.
- **Action:** Add `vitest.config.ts` with `test: { include: ['lib/**/*.test.ts'] }` (or equivalent). This scopes vitest strictly to the unit test tree and eliminates the Playwright sweep entirely.
- **Note:** Surfaced during Ticket 4.1.5 post-migration verification (2026-05-18). Low priority — the unit tests themselves are healthy. Becomes more important if test files accumulate outside `lib/`.
