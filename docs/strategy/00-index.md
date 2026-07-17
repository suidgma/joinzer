# Joinzer — Project Knowledge Index

_Last updated: July 17, 2026_

This folder holds the **strategic and business context** for Joinzer — the "why, who, and where we're going." It is meant to be read alongside (not instead of) the codebase.

- **The codebase + `CLAUDE.md` + `docs/phases/`** are the source of truth for *what's built and how it works technically.* They drift fast and stay in the repo.
- **These `docs/strategy/` files** are the source of truth for *vision, customers, market, money, and go-to-market.* They should be evergreen and change slowly. If a doc here would be wrong after the next code change, it's in the wrong place.

## Read-me-first

Joinzer is a mobile-first pickleball platform with four product surfaces sharing one app, one auth, one database: **Coordination** (find/join local play), **Leagues** (recurring competitive play), **Tournaments** (discrete events), and **Players** (searchable directory + profiles/ratings). Pilot market: **Las Vegas metro.** Built solo by Marty Suidgeest. As of this writing the product is feature-rich and demo-ready, but **no organizer has used it yet, there is no committed first event, and there is no revenue.** That pre-validation state is the single most important thing to remember when reading everything else here.

## The documents

**Tier 1 — strategy & business (the gaps the codebase can't fill):**

| Doc | What it answers |
|---|---|
| `vision-and-strategy.md` | What Joinzer is, the wedge, and what winning looks like |
| `customers-and-personas.md` | Who we serve, their jobs-to-be-done, and what would make them switch |
| `market-and-competitive.md` | The landscape, the real competitor, and our differentiation thesis |
| `business-model-and-pricing.md` | How money flows today and the open pricing questions |
| `go-to-market.md` | How we land the first organizer and grow from there |
| `open-decisions.md` | The live, unresolved calls — where to push |

**Tier 2 — context & reference (distilled from the repo):**

| Doc | What it answers |
|---|---|
| `product-overview.md` | A narrative, phase-level snapshot of what's shipped vs. not |
| `brand-and-voice.md` | How Joinzer talks — positioning, tone, do/don't |
| `decision-log.md` | The "why" behind foundational technical & product choices (ADRs) |
| `glossary.md` | The shared vocabulary and domain model |

**Tier 3 — ongoing capture (thin now, grows with usage):**

| Doc | What it answers |
|---|---|
| `user-research.md` | Real organizer/player input as it arrives (interview template + synthesis) |
| `metrics-and-kpis.md` | What success is measured by, stage by stage |
| `operating-constraints.md` | The solo-builder reality that bounds every recommendation |

## Confidence legend

Because most of the business context is not yet market-tested, docs label claims:

- **✅ Validated** — confirmed by real evidence (shipped code, or genuine user input).
- **🔵 Grounded** — derived from the product/codebase, but not market-tested.
- **🟡 Hypothesis** — a reasoned assumption that still needs validation.
- **❓ Open** — explicitly undecided.

When you (Claude) give recommendations from these docs, respect the labels: treat 🟡 and ❓ as things to pressure-test, not facts to build on.

## Maintenance

- One concern per doc; keep them short.
- Update the "Last updated" line whenever a doc changes.
- Prune stale strategy aggressively — outdated context is worse than none, because it reads as current.
- Keep the reality/aspiration split: `CLAUDE.md` = reality, `docs/architecture-target.md` = aspiration. Don't let a plan here get mistaken for a fact.
