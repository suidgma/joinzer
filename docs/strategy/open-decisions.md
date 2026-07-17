# Joinzer — Open Decisions

_Last updated: July 17, 2026_

> This is the "where to push" doc. It lists the live, unresolved calls, the options, what's blocking each, and what evidence would resolve it. When Claude is asked for recommendations, these are the questions worth pressure-testing rather than assuming away. **Update this doc as decisions resolve** — move settled items into a short "Decided" log at the bottom.

## 1. Schema: Path A vs. Path B ❓

**The decision:** the live database has **separate `tournaments` and `leagues` domains.** A unified `competitions` schema has been *designed* (`docs/architecture-target.md`) but not built.

- **Path A — keep them separate.** Less risk, no migration, ships features faster today. Cost: duplicated concepts and logic across two domains forever.
- **Path B — unify into `competitions`.** Cleaner long-term model, one engine for brackets/standings/registration. Cost: a large, risky migration of a live, feature-rich system.

**What's blocking:** it's genuinely premature without knowing how organizers think about "an event." Unifying before customer contact risks building the wrong abstraction beautifully.

**What would resolve it:** the first organizer conversations — do real organizers run things that blur the league/tournament line (e.g., league-with-playoffs, tournament-series) in ways that make unification pay off? **Current lean: defer** (Path A) until there's a concrete reason to unify.

## 2. Pricing model ❓

**The decision:** what does Joinzer charge, and who pays?

- Transaction fee % (organizer-absorbed vs. player-paid), subscription, or a mix.
- Where the free/paid feature line sits.

**What's blocking:** zero real willingness-to-pay data; no competitive fee benchmark for this market.

**What would resolve it:** direct answers from the first organizers (see `business-model-and-pricing.md`) plus competitor fee research. **Current lean: transaction fee on paid events first; who-pays undecided.**

## 3. First committed event / organizer ❓ — the #1 blocker

**The decision:** who is the first real organizer, running what, when?

**Status:** none booked. No organizer has seen the product. This blocks Path A/B, pricing, *and* the beachhead-persona question below.

**What would resolve it:** outreach → conversation → a committed concierge pilot event (see `go-to-market.md`). **This is the single highest-priority open item.**

## 4. Beachhead organizer persona ❓

**The decision:** which organizer archetype do we build and sell for first — independent league runner, tournament director, or club/rec-center coordinator?

**Why it matters:** they differ in needs, volume, price sensitivity, and payment behavior. Optimizing the product/roadmap for the wrong one wastes solo-builder time.

**What would resolve it:** the first handful of organizer conversations. **Current lean: none — deliberately open until there's evidence.**

## 5. Organizations / business layer ❓

**The decision:** when (if ever) to add an `organizations` / multi-organizer business layer.

**Status:** today every tournament and league is owned by a **single individual organizer.** There's no org account, no multi-organizer business entity, no facility layer.

**What's blocking:** no demand signal yet. Clubs/facilities might need it — or might not be the customer at all.

**What would resolve it:** an organizer or facility asking for multi-admin/business features with real intent. **Current lean: defer** until a paying customer needs it.

## 6. DUPR API partnership ❓ (external dependency)

**The decision:** whether/when to pursue a real DUPR API integration (Phase 3 of the rating system).

**Status:** Joinzer has its own calculated Joinzer Score/Level engine (Glicko-2, live). Manual DUPR entry exists; there's **no API sync** — that needs DUPR partner API credentials/contract, which is an external, not-just-build-time dependency.

**What would resolve it:** a business decision to approach DUPR + their partnership terms. **Current lean: not now** — the in-house rating is sufficient pre-scale, and the dependency is external.

## 7. Breadth vs. depth (ongoing tension) ❓

**The decision:** keep expanding surface area, or harden depth/quality on the surfaces that a real organizer actually uses?

**Why it matters:** four surfaces built solo is the vision's strength and quality's risk. Post-first-organizer, the honest move may be to *narrow* to what that organizer needs and make it excellent.

**What would resolve it:** watching a real organizer + their players use it and seeing what actually matters vs. what was built on spec.

---

## Decided (log)

_(Move resolved decisions here with the date and the call made. Empty for now — the big ones are all still open, which is itself the most important fact about where Joinzer is.)_
