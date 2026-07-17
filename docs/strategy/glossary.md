# Joinzer — Glossary & Domain Model

_Last updated: July 17, 2026_

> The shared vocabulary. Use these terms precisely — ambiguity here shows up as bad recommendations everywhere else. Terms are ✅ grounded in the shipped product unless noted.

## Product surfaces

- **Coordination / Play** — finding, creating, and joining casual local play sessions ("events"). The original MVP; player-first.
- **Leagues** — recurring competitive play with persistent rosters, sessions, and standings.
- **Tournaments** — discrete competitive events with divisions, registration, and brackets.
- **Players** — the directory of player profiles/résumés, ratings, and history.

## League formats

- **Round Robin (session)** — the classic format: players attend a session; the app generates rounds where everyone plays everyone; standings accrue. The default and most mature.
- **Box** — tiered "boxes" per cycle; round-robin within each box; promotion/relegation between cycles.
- **Ladder** — a season-long continuous ranking updated after king-of-the-court nights; adjacent, movement-based rank (distinct from Box's tiered groups).
- **Team** — roster-based teams play weekly matchups, each made of individual **lines** (e.g., Line 1 singles, Line 2 doubles). Behind a feature flag.
- **Flex** — a self-scheduled round-robin: each entrant gets an opponent list + a deadline, arranges their own court/time, reports the score, and the opponent confirms. The first player-driven format. Behind a feature flag.

## Play structure & data concepts

- **Event** — a Play/Coordination session (the casual side). Distinct from a league "session."
- **Session** — one occurrence of a round-robin league night.
- **Period** — the box/ladder analog of a session (a cycle or ladder night); periods carry no clock.
- **Fixture** — a scheduled game/match within box/ladder/flex/team formats.
- **Matchup / Line** — in Team leagues, a **matchup** is team-vs-team, composed of child **line** fixtures.
- **Round** — a set of simultaneous matches within a session.
- **Standings / Results** — the ranking table; "Results" reflects that past periods can also be browsed.

## Ratings & identity

- **Joinzer Score** — a universal, public **0–100** number computed from match results (Glicko-2 engine). 1500 internal ≈ 50.
- **Joinzer Level** — an **activity-specific label** derived from the Score (e.g., New Player / Beginner / Intermediate / Advanced / Elite for pickleball). Not interchangeable with the Score.
- **DUPR** — the external industry rating. In Joinzer it's **secondary and never treated as verified** unless genuinely verified; no live API sync (manual entry only).
- **Confidence / Established / Rusty** — a Score is shown only when "earned" (enough games/events and low enough rating deviation). "Established" and "Rusty" describe that earned-but-current-vs-stale state.
- **Résumé** — the public `/players/[id]` page framed as a player's career record (rating, stats, recent form, titles/podiums, upcoming).

## Roles

- **Organizer** — the individual who owns a league or tournament. Full control.
- **Co-organizer / co-admin** — a delegated operator with most organizer powers.
- **Volunteer** — a limited tournament staff role.
- **Captain** — a team leader within a Team league; can run their own team's lineup/roster/scoring.
- **Host (player-run)** — in a **player-run league**, the designated player (or first to show up) who runs a round-robin session live, without a dedicated court monitor.
- **Participant** — a registered player in an event.
- **Substitute (sub)** — someone who plays in place of a registered participant for one occasion; the covered participant keeps their standings credit.

## Substitutions

- **Sub request** — a record on `league_sub_requests` that a participant needs covering.
- **Open pool** — a request anyone eligible can accept ("find me a sub").
- **Self-assigned** — the requester picks their own sub, applied immediately.
- **Organizer-assigned** — the organizer places a sub through the unified model.
- **Accept** — an eligible player claims an open request; claim + placement happen in one atomic transaction.
- **Withdraw / Reclaim / Reopen / Expire** — the request lifecycle transitions (sub backs out / requester can attend after all / organizer reopens / it times out).

## Payments

- **Stripe Connect (Express)** — how organizers onboard to receive payouts.
- **Destination charge** — a charge routed to the organizer's account with a **platform application fee** (Joinzer's cut).
- **Application fee** — the portion of a paid registration Joinzer keeps.
- **Multi-division cart** — bundling several tournament divisions into one payment with a bundle discount.
- **Early-bird tiers** — "register by <date> at <price>" price ladders resolved at checkout.
- **Paid-event gate** — the rule that creating *free* events is open to all, but *charging money* requires manual organizer approval (`can_create_paid_events`).
- **Refund window / no-refund date** — the organizer-set cutoff governing refunds.

## Pickleball & play concepts

- **Doubles / Singles / Mixed** — pairing formats; "mens_/womens_" league formats are gender-specific and gate eligibility.
- **Partner mode — Fixed vs. Rotating** — whether doubles partners are locked for a season/division or rotate.
- **King-of-the-court** — the round structure ladder sessions use (winners move up a court, losers down).
- **Waitlist auto-promote** — when a spot opens, the next waitlisted registrant is automatically registered and notified (no confirm step).

## Systems

- **Offline run mode** — running an entire tournament on one device with no connectivity (IndexedDB + outbox + reconcile).
- **Realtime layer** — the shared event-driven infra (`lib/realtime`) driving live chat/attendance/scores/notifications.
- **Action Center** — the home screen's server-derived "Needs your attention" list (dual-audience: player + organizer).
- **Two form factors** — desktop-first setup vs. mobile-first day-of/player-facing surfaces.
