# Phase: Two-Form-Factor Refactor

> Setup is desktop work. Day-of is phone work. The current product treats both as mobile-vertical, which makes the setup experience feel like data entry on a phone even when the organizer is at a laptop. This phase fixes that.

**Status:** Planning
**Last updated:** May 11, 2026
**Depends on:** Phase 1 complete (it is)
**Blocks:** Phase 2 polish, any future organizer-facing screen work

---

## 1. The Decision

**Architecture:** Responsive single codebase. Same routes, different layouts at breakpoints.

**Reframe:** For organizer setup routes, **desktop is the canonical design.** Mobile is the fallback for the edge case where someone needs to do setup work on a phone. This is the opposite of the current default.

For day-of operational routes and all player-facing routes, mobile remains canonical.

### Why this choice

- The information is the same on both form factors. A Create Tournament form has the same fields on a phone or a laptop. Only layout density differs. That's responsive's sweet spot.
- Solo builder — two codebases is a velocity killer.
- The route structure already separates setup from live ops. The desktop/mobile split maps cleanly onto an existing physical split in `/app`.
- Failure mode (cramped desktop, overstuffed mobile) is preventable by designing desktop-first and collapsing to mobile, not by retrofitting mobile up.

### What this is not

- Not a parallel route tree.
- Not user-agent device detection.
- Not a redesign of player-facing or day-of routes.
- Not a visual redesign — same shadcn/ui primitives, same Tailwind tokens. Only layout shape changes.

---

## 2. Route Inventory

Each route in the organizer/admin surface is classified by canonical form factor.

| Route | Canonical | Mobile behavior |
|---|---|---|
| `/tournaments/new` | Desktop | Vertical stack, single-column wizard |
| `/tournaments/[id]` (manage) | Desktop | Stacked sections, collapsible |
| `/tournaments/[id]/schedule` | Desktop | Stacked rows |
| `/tournaments/[id]/standings` | Desktop | Stacked rows |
| `/tournaments/[id]/players` | Desktop | Stacked rows |
| `/tournaments/[id]/comms` | Desktop | Stacked rows |
| `/tournaments/[id]/live` | **Mobile** | Desktop scales but stays mobile-shaped |
| `/leagues/new` | Desktop | Vertical stack, single-column wizard |
| `/leagues/[id]` (manage) | Desktop | Stacked sections, collapsible |
| `/leagues/[id]/sessions` (list) | Desktop | Stacked rows |
| `/leagues/[id]/sessions/[n]` (session live) | **Mobile** | Desktop scales but stays mobile-shaped |
| `/leagues/[id]/standings` | Desktop | Stacked rows |
| `/leagues/[id]/roster` | Desktop | Stacked rows |
| `/play`, `/play/[id]` | **Mobile** | Untouched |
| `/players`, `/players/[id]` | **Mobile** | Untouched |
| `/profile` | **Mobile** | Untouched |
| `/(marketing)` (all) | Already responsive, separate concern | — |

**Definitions:**
- *Canonical: Desktop* — designed for laptop/desktop width first. Multi-column where useful, sticky side rails, denser typography. Mobile layout collapses gracefully but is acknowledged as the secondary form factor.
- *Canonical: Mobile* — current treatment. Phone-first vertical layouts. Desktop view scales up but doesn't restructure.

---

## 3. Shared Primitives To Build First

Before refactoring any screens, these primitives must exist. Each is small. None should exceed 150 lines.

### 3.1 `<DesktopShell>`
Layout wrapper for desktop-canonical routes. Provides:
- Max-width container (probably `max-w-7xl`)
- Optional left sidebar slot (for navigation within a manage view)
- Optional right rail slot (for outline/summary in wizards)
- Header slot with breadcrumb + primary actions
- Main content area

On mobile breakpoints, sidebar and rail collapse into top tabs or accordion sections.

### 3.2 `<FormRow>`
Replaces ad-hoc field layouts. Standard pattern: label on left, input on right, help text below the input, error below help. On mobile, label stacks above input.

This is the workhorse component. Most setup forms become sequences of `<FormRow>` instances inside `<FormSection>`.

### 3.3 `<FormSection>`
Groups related rows with a heading and optional description. Renders as a card on desktop with title + body; on mobile, becomes a collapsible accordion section with title as the trigger.

### 3.4 `<WizardOutline>`
Sticky right-rail outline for multi-step setup flows. Shows step list, current step highlighted, lets user jump between completed steps. On mobile, collapses to a top progress bar.

### 3.5 `<ManageNav>`
Sticky left sidebar for `/tournaments/[id]` and `/leagues/[id]` manage views. Shows: Overview / Schedule / Standings / Players (or Roster) / Comms / Settings. On mobile, becomes a top horizontal scrollable tab bar.

**Done means:** these five components exist, are documented with a one-page demo route at `/dev/primitives`, and pass a visual review at three viewport widths (375px, 768px, 1280px).

---

## 4. Slice Order

The refactor ships in slices. Each slice uses the kickoff template and has a single CC prompt. No slice depends on a later slice.

### Slice 0: Primitives ✅ Shipped
Build the five components in Section 3. Add `/dev/primitives` demo route.
**Done means:** all five render correctly at the three viewport widths.

### Slice 1: Create Tournament ✅ Shipped
Refactor `/tournaments/create` (actual route — not `/tournaments/new` as originally named) to use `<DesktopShell>` + `<WizardOutline>` + `<FormSection>` + `<FormRow>`. The existing form was already flat (no multi-step wizard); desktop now gets a sticky outline rail and FormSection grouping. Mobile gets FormSection accordion. `CreateTournamentForm.tsx` updated; insert path to `tournaments` table unchanged.
**Note:** The form inserts into a `tournaments` table directly (not `competitions` + RPC). Schema reconciliation is explicitly deferred.

### Slice 2: Tournament Manage ✅ Shipped (chrome polish ✅ Shipped)
Refactor `/tournaments/[id]` to use `<DesktopShell>` + `<ManageNav>`. Manage view becomes a sidebar + content layout on desktop; horizontal scrollable tab bar on mobile.
**Note:** No sub-routes exist under `/tournaments/[id]/` yet (Schedule, Standings, Players, Comms, Live tabs are client-side state inside `TournamentOrganizerView`, not separate routes). ManageNav currently exposes Overview + Edit only. Slice 3 creates the sub-routes and expands the nav.

### Slice 3: Tournament sub-routes (schedule, standings, players, comms)
Apply the manage shell to the four sub-routes. Pure layout work — content already exists.

### Slice 4: Create League
Mirror Slice 1 for `/leagues/new`. Should be largely a copy-paste with template-specific field differences.

### Slice 5: League Manage + sub-routes
Mirror Slices 2–3 for league routes.

### Slice 6: QA pass
Run through all refactored routes at 375px / 768px / 1280px / 1920px. Fix anything that didn't get caught earlier.

---

## 5. Out of Scope

To prevent CC scope creep, these are explicitly out of scope for this phase:

- Any changes to `/tournaments/[id]/live` or `/leagues/[id]/sessions/[n]` (day-of routes — mobile stays canonical)
- Any changes to `/play`, `/players`, `/profile`, or any player-facing route
- Any changes to marketing routes under `/(marketing)`
- Any schema changes
- Any RPC changes
- Any new features — this is layout work, not functional work
- Visual redesign (color, typography, iconography) — only layout shape changes
- Performance optimization — separate concern
- Accessibility audit — separate concern (but don't regress)
- Removing or deprecating existing components without an explicit grep proving zero callers

---

## 6. Acceptance Criteria

The phase is complete when:

1. All five primitives in Section 3 exist with the demo route working
2. All eleven desktop-canonical routes in Section 2 use the new primitives
3. No regression in existing functionality — all forms still submit, all manage screens still load data correctly
4. At 1280px viewport, organizer setup feels like desktop software, not a phone app stretched wide
5. At 375px viewport, every screen remains usable, no horizontal scroll, no truncated controls
6. No new dependencies added beyond what's already in `package.json`
7. No deletions of existing components without grep-proof of zero callers, reviewed by Marty

---

## 7. Risks and Open Questions

- **Risk:** the primitives don't survive contact with real screens. Mitigation: Slice 1 is allowed to revise the primitives if needed; if Slice 2+ needs further revisions, stop and revisit Section 3.
- **Open question:** does the manage sidebar (`<ManageNav>`) need a "back to dashboard" link, or do we rely on breadcrumb? Decide during Slice 2.
- **Open question:** for the wizard outline (`<WizardOutline>`), do completed steps show a checkmark, or do they show a summary preview of the values entered? Lean toward summary preview — more useful, only marginally more work. Decide during Slice 1.
- **Open question:** behavior of `<DesktopShell>` between 768px (tablet portrait) and 1024px — does the sidebar persist or collapse? Decide during Slice 0 primitives work.

---

## 8. Out-of-band Required Work

This is not a coding task but it's required before this phase ships value:

**Show Slice 1 to one Vegas pickleball organizer.** As soon as `/tournaments/new` is refactored, before continuing to Slice 2, get one organizer in front of it. The point isn't to sell them. It's to learn whether the desktop-first reframe actually solves the problem we think it solves. If they say "this looks like every other tool, the magic is somewhere else" — that's data that changes the rest of this phase.

---

*Owner: Marty. Implementation: Claude Code, one slice per session.*
