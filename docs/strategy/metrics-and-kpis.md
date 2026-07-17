# Joinzer — Metrics & KPIs

_Last updated: July 17, 2026_

> Confidence: what's technically measurable is 🔵 grounded; the **targets and the "north star" choice are 🟡 hypothesis** — unvalidated until there's real usage. Honest state today: **analytics are thin.** A `platform_stats_mv` materialized view exists but its UI was pulled (it showed zeros with no real data). So this doc is mostly "what we *will* measure and why," not a live dashboard.
>
> Guiding principle: **measure the stage you're in.** Pre-first-organizer, vanity metrics (signups, page views) are noise. The only metric that matters right now is *did an organizer commit and run an event.*

## The one number (candidate north stars — 🟡)

Pick one and let it anchor everything. Candidates, by stage:

- **Now (pre-traction):** _committed organizer events._ (Are real organizers running real events on Joinzer?)
- **Growth stage:** _weekly active players who played a game found/managed through Joinzer._ (True marketplace value delivered.)
- **Monetization stage:** _paid registration volume (GMV) running through the platform._

Recommendation: hold the **"did an organizer run a real event"** count as the north star until it's reliably > 0 and repeating — then graduate to weekly active players.

## Metrics by stage

### Stage 0 — First organizer (where Joinzer is now) 🟡

This is a **funnel, not a dashboard.** Track it in a spreadsheet if needed:

- Organizers **identified** → **contacted** → **conversation booked** → **event committed** → **event run end-to-end** → **would run the next one (paid)**.
- Time from first contact to committed event.
- The qualitative verdict (captured in `user-research.md`) matters more than any count at this stage.

### Stage 1 — Pilot event health

For each real event:
- Registrations vs. capacity; % of an organizer's roster that showed up.
- **Player activation:** % of invited players who created a profile.
- No-show / substitute rate handled *in-app* (a core value prop — is it actually used?).
- Payment volume + refund rate (if paid).
- Did the event complete without the organizer falling back to spreadsheets/texts?

### Stage 2 — Retention & loops (the real business)

- **Organizer retention:** events per organizer per quarter (the LTV driver).
- **Player return rate:** % who find/play a *second* game after their first — especially a game *not* run by their original organizer (proof the directory/discovery works).
- **Rating/résumé engagement:** do players view their Score/profile? (the retention hook's actual pull)
- **Two-sided balance:** organizers vs. active players in a metro; are both growing together, or is one side starving?

### Stage 3 — Monetization

- **GMV** (paid registration volume) and **take rate** realized.
- Revenue per organizer / per event.
- Free → paid conversion (organizers who start free and later run a paid event).
- Stripe processing cost vs. Joinzer application fee (margin reality).

## Grouped funnel (AARRR-style, for reference)

- **Acquisition:** organizers contacted; players onboarded per organizer; public-browse/organic visits (later, with SEO court pages).
- **Activation:** organizer runs first event; player creates profile + plays first game.
- **Retention:** organizer runs event #2+; player returns for game #2+.
- **Revenue:** paid events, GMV, take rate.
- **Referral:** organizers referring organizers; players inviting partners/opponents.

## Guardrail / counter-metrics 🟡

Watch these so growth isn't hollow:

- **Event-day failure rate** — events where the organizer had to abandon Joinzer mid-event. Near-zero is non-negotiable; day-of reliability is the whole promise.
- **Support load per event** — how much of Marty's time each event costs. Concierge doesn't scale; watch the trend.
- **Rating trust complaints** — disputes that the Score/standings are unfair. Trust is fragile and compounding.
- **Refund/payment issues per paid event.**

## What to instrument first (🟡 recommendation)

Don't build analytics infrastructure yet. In order:
1. A **manual organizer funnel** (spreadsheet) — zero engineering, highest signal now.
2. Light **event-level counts** from data you already store (registrations, completion, payment) — queryable from Supabase without new tooling.
3. Only later: revive/replace `platform_stats_mv` and a real analytics layer, once there's usage worth measuring.

Premature dashboards on zero data is exactly the trap that put zeros on the homepage. Measure what's real, when it's real.
