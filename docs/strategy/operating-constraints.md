# Joinzer — Operating Constraints

_Last updated: July 17, 2026_

> Why this doc exists: to keep recommendations **grounded in Joinzer's actual reality** — a solo builder, lean budget, managed-service stack. Without this, advice drifts toward team-scale roadmaps and enterprise tooling that don't fit. When you (Claude) suggest anything, sanity-check it against these constraints first.
>
> Confidence: builder profile and tech limits are 🔵 grounded (from the repo + how Marty works); **budget and time allocation are 🟡 inferred** — Marty should correct these.

## The builder

- **Solo.** One person — Marty Suidgeest — builds, decides, ships, and (for now) would run support and sales.
- **Solopreneur + agency owner + AI builder.** Joinzer shares attention with an agency, so **time is the scarcest resource**, not ideas or code.
- **Intermediate coder, strong with AI-assisted development.** The force multiplier is AI-assisted building, not traditional engineering headcount. Recommendations should assume Claude/AI does much of the heavy lifting under Marty's direction.
- **US English**, throughout.

## Time & capacity (🟡 — inferred, please correct)

- Effectively **part-time founder capacity** (agency to run in parallel).
- No team to delegate to; every "we could also build…" competes for the same single pair of hands.
- **Implication:** prefer the smallest thing that validates or ships. Sequence ruthlessly. A recommendation that assumes weeks of uninterrupted focus is probably wrong.

## Budget (🟡 — inferred, please correct)

- **Bootstrapped / lean.** No indication of outside funding.
- Fixed costs are deliberately low via managed free/cheap tiers (see below).
- **Implication:** avoid recommendations with meaningful fixed monthly cost or per-seat SaaS. Favor usage-priced, free-tier, or already-in-stack tools. Marketing spend is likely time-in-kind (direct outreach), not paid acquisition budget — at least until traction.

## Tech & infrastructure constraints (🔵 grounded)

- **Stack is fixed and lean:** Next.js + React + TypeScript + Tailwind + Supabase + Vercel + Stripe + Resend. **Deliberate exclusions** (no shadcn/Radix/Redux/tRPC/Prisma/custom ORM/Docker/CI beyond Vercel) — see `decision-log.md` ADR-02. Don't recommend adding to the stack casually.
- **Vercel Hobby tier:** notably, it **blocks sub-daily cron jobs** — several features are designed around a once-daily cron because of this. Some capabilities (more frequent crons) would require upgrading to Pro. Factor this into any "just run it every 15 minutes" suggestion.
- **Windows dev environment**, VS Code + Claude Code extension. (Minor gotchas around dev-server file watching are documented in `CLAUDE.md`.)
- **No CI pipeline beyond Vercel's default.** Quality gates are `tsc --noEmit` + `next build` (+ tests where they exist), run locally before shipping.
- **Managed-service posture:** lean on Supabase/Vercel/Stripe primitives rather than self-hosted infra. Ops burden must stay near zero.

## Deploy & workflow reality (🔵)

- **Full deploy autonomy** to `main` → production (Vercel), no per-push confirmation — justified by green gates + easy rollback (ADR-10).
- Non-negotiables: never commit secrets; gates green before shipping; migrations applied to Supabase *before* code that reads new columns; confirm before destructive non-git actions.

## What this means for recommendations

**Favor:**
- Small, shippable-by-one-person slices.
- Managed services and free/usage-tier tools already in the stack.
- Leverage-through-AI (things Claude can largely build/maintain).
- Concierge/manual over automation *until* volume justifies engineering (e.g., a manual organizer funnel before an analytics system).

**Be skeptical of:**
- Anything implying a team, dedicated ops, or a support org.
- New platform dependencies with fixed cost or lock-in.
- "Build a big system" when a spreadsheet or a manual process validates the same thing faster.
- High-frequency infra (sub-daily crons, always-on workers) without noting the Vercel-tier cost.

## Risks that flow from these constraints (❓)

- **Bus factor / single point of failure** — everything depends on one person.
- **Breadth vs. depth** — four surfaces built solo is impressive and thin; quality per surface is the tradeoff (see `open-decisions.md` #7).
- **Support cliff** — when real organizers and their players arrive, support load lands entirely on Marty. Concierge doesn't scale; plan for the moment it has to.
- **Attention split** — the agency is both the funding runway and the competitor for Marty's time.

## Corrections needed

Marty: please replace the 🟡 inferred items (time capacity, budget posture, any funding, target hours/week on Joinzer) with real numbers. Those directly change how aggressively any roadmap or GTM plan should be paced.
