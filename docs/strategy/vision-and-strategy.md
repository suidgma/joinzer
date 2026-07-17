# Joinzer — Vision & Strategy

_Last updated: July 17, 2026_

> Reality check: the product below is real and shipped (🔵 grounded). The market thesis and "what winning looks like" are reasoned bets (🟡 hypothesis) that no organizer or player has yet confirmed.

## One line

Joinzer is the app a pickleball community runs its life on — finding a game tonight, running a season, playing a tournament, and knowing where you stand — in one place, on your phone.

## The problem (🟡 hypothesis, but strongly held)

Recreational and competitive pickleball is coordinated with duct tape: **group texts, Facebook groups, spreadsheets, a rating site, a bracket site, a court-reservation tool, and a payment app** — none of which talk to each other. Organizers do heroic manual work to run leagues and tournaments. Players can't easily find the right game, partner, or opponent. The status quo is fragmentation, and fragmentation is the competitor.

## What we're building

Four surfaces, **one app, one auth, one database** — so a player, their profile, their rating, and their history are shared everywhere:

1. **Coordination** — create, discover, and join local play sessions. The original wedge.
2. **Leagues** — recurring competitive play: rosters, weekly sessions, standings, five formats (round-robin, box, ladder, team, flex).
3. **Tournaments** — divisions, registration, brackets, live scoring, check-in, payouts.
4. **Players** — a searchable directory with profiles, résumés, ratings, and connections.

The shared spine (users, profiles, locations, **Joinzer Score/Level ratings**) is the moat: every surface makes the others more valuable.

## North star, per surface (🔵 grounded — this is how the product is designed)

- **Coordination — player-first.** The metric is speed of "find a game and show up."
- **Leagues — organizer-and-captain-first.** Season reliability and roster fairness.
- **Tournaments — organizer-first.** Tournament-day reliability and the player↔organizer loop.
- **Players — discovery-first.** Finding the right partner, opponent, or community.
- **Form factor:** setup is desktop-first; day-of and player-facing surfaces are mobile-first.

## The wedge and sequencing (🟡 hypothesis)

The strategic bet is **organizer-led supply**: land a credible organizer, their players onboard to run *their* league/tournament, and once those players have a profile, a rating, and history, they stick around to find *more* games — which pulls in the next organizer. Coordination is the low-friction entry; leagues/tournaments are the reason organizers commit; the player directory + ratings are the retention flywheel.

Rough order of leverage: **prove one organizer → their players → adjacent organizers/venues → directory network effects in a metro → next metro.**

## Why now (🟡 hypothesis)

Pickleball is still adding players and organized play faster than the tooling around it has matured. Rating (DUPR) has consolidated, but *running* organized play is still fragmented. There's a window to be the connective tissue before an incumbent with distribution closes it.

## What winning looks like (🟡 hypothesis — for pressure-testing, not planning certainty)

- **~90 days:** one organizer runs a real, paid league or tournament end-to-end on Joinzer; their players have active profiles; the organizer says they'd use it again.
- **~12 months:** Joinzer is the default tool for a cluster of organizers in the Las Vegas metro; players discover games through it, not just through their organizer.
- **~3 years:** the go-to platform for organized rec pickleball in several metros, with the player directory + ratings as the durable network effect.

## Strategic principles

- **One app, one identity, one rating** — never fork the player.
- **Player-first speed on the play side; organizer reliability on the run side.** Different surfaces optimize for different people.
- **Push toward player-run / self-service** — captains and players do the work, not just organizers (substitutions, self-scoring, player-run leagues all follow this).
- **Small, focused changes; preserve working code.** The build philosophy is a strategy, not just an engineering habit — it's how one person ships a product this broad.

## Non-goals (for now)

- Not a **court-reservation / facility-management** system (that's CourtReserve's lane).
- Not a **rating authority** competing head-on with DUPR — Joinzer has its own Score/Level but treats DUPR as a secondary, never-manually-verified signal.
- Not a **generic team-comms** app — chat exists to serve organized play, not to be GroupMe.
- Not **multi-sport yet** — the architecture is activity-aware, but pickleball is the only sport until there's a real reason to expand.
