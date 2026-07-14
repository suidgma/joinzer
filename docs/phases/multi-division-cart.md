# Multi-Division Registration + Discount + Cross-Sell — Design (for review)

> Status: **scoping / not built.** This is the design to pressure-test before Phase 5a.
> Prereqs already shipped: early-bird `price_tiers`, tournament discount codes, per-division
> shareable deep link, and **division timing surfaced to players** (the concurrency read path).

## 1. Goal
Let a player register for **several divisions of one tournament in a single transaction** and get a
**multi-division discount**, and nudge them toward it on the tournament page and the shared
division link ("also enter Saturday's division and save").

## 2. Current state / the gap
- Every checkout is **single-item, single-division**. There is **no cart/order primitive** — the only
  quantity variation is `quantity: 2` for doubles "pay for both."
- Tournament fee resolution: `division.cost_cents` (flat override) ?? tier-resolved `tournaments.cost_cents`
  (early-bird). Discount codes apply on top at checkout.
- Registration = one `tournament_registrations` row per division (per player). Doubles teams = **two**
  cross-linked rows (`partner_registration_id`), each with its own `payment_status`.
- **Solo entry pays its own entry (quantity 1)** — including "solo into a doubles division" for
  auto-matching. "Pay for both" (covering a partner) is a separate quantity-2 checkout.
- Division **day/time** is now known pre-registration via `tournament_division_blocks` →
  `tournament_schedule_blocks(block_date,start_time,end_time)`, so block **overlap = concurrency**.

## 3. Core decision — introduce an order primitive
The multi-division **discount lives on the order total**, not per registration, and one Stripe
payment must map back to N registrations (for fulfillment + refunds). Two shapes:

- **A. Real order tables (recommended).** `tournament_orders` + `tournament_order_items`. Clean home
  for subtotal / discount / total / one Stripe PI, and items link to the created registrations.
- **B. `group_id` on registrations only.** Lighter, but the order-level discount has no natural home
  and per-item refund accounting is awkward. (This is basically how pay-for-both works today.)

**Recommendation: A.** The accounting (discount allocation, per-division refunds) needs the order row.

## 4. Proposed data model
```
tournament_orders
  id                       uuid pk
  tournament_id            uuid fk
  user_id                  uuid fk            -- the paying player (their own entries)
  status                   text               -- 'pending' | 'paid' | 'cancelled' | 'expired'
  subtotal_cents           int                -- Σ per-division base (tier-resolved) prices
  multi_div_discount_cents int                -- the bundle discount applied
  code_discount_cents      int                -- optional discount code, applied after
  total_cents              int                -- what Stripe charged
  stripe_session_id        text
  stripe_payment_intent_id text
  created_at, updated_at

tournament_order_items
  id              uuid pk
  order_id        uuid fk
  division_id     uuid fk
  registration_id uuid fk null   -- set on fulfillment (or reserved up front — see §5)
  base_cents      int            -- that division's price before discounts
  net_cents       int            -- that division's allocated share of total_cents (for refunds)
  outcome         text           -- 'registered' | 'waitlisted' (capacity at fulfillment)
```
Plus a **discount config** on the tournament (jsonb, mirrors `price_tiers` / discount codes):
```
tournaments.multi_division_discount jsonb
  { "type": "percent_additional" | "flat_per_additional" | "percent_order",
    "value": number,      -- percent (0–100) or cents
    "min_divisions": 2 }  -- discount kicks in at this count
```

## 5. Selection → checkout flow — reserve vs pay-first
Two viable orderings; this is **decision #1**:

- **Reserve-then-pay (recommended for paid events).** Create N `pending_payment` registrations +
  the order up front → they hold capacity → one Stripe session → webhook confirms. Needs a **cron**
  to expire abandoned pending regs (~30 min). Best UX: you're never charged then waitlisted.
- **Pay-then-create (simpler).** Order holds the division ids; **webhook creates** the registrations
  on payment. No reservation/cron. Risk: a division fills between add-to-cart and pay → webhook must
  **waitlist** that item (partial fulfillment), which muddies the discount the player already paid.

Given real money, **reserve-then-pay** is the more correct default despite the cron.

## 6. Amount computation (order of operations)
1. Per division: `base = division.cost_cents ?? resolvePriceCents(tournament.cost_cents, price_tiers, now)`.
2. `subtotal = Σ base`.
3. Apply **multi-division discount** → `multi_div_discount_cents` (see §7).
4. Apply optional **discount code** on the post-bundle amount → `code_discount_cents`.
5. `total = subtotal − multi_div − code`.
6. **Allocate** `total` back across items pro-rata by `base` → each item's `net_cents` (for clean refunds).
7. Stripe: one Checkout session. **Line items = one per division** (labels read well, `net_cents` each)
   or a single combined line — combined is simpler; per-line is friendlier on the receipt. Connect:
   `application_fee_amount` on the total + `on_behalf_of` + destination when the organizer has Connect.

## 7. Discount shape — decision #2
Configured per tournament. Candidates:
- **`percent_additional`** — 2nd+ divisions at X% off (recommended: intuitive, "each extra division 20% off").
- **`flat_per_additional`** — $Y off each division after the first.
- **`percent_order`** — whole order X% off at `min_divisions`+.

Recommend shipping **one** in v1 (organizer picks type + value). Any of them is a small change to step 3.

## 8. The partner / doubles edge — the hard part
The cart pays for the **registering player's own entries**. Mapping to formats:
- **Singles division** → one own entry (quantity 1). ✅ Clean.
- **Solo into a doubles division** (auto-match later) → one own entry (quantity 1). ✅ Clean.
- **Team doubles, each pays own share** → the player's own row (quantity 1); partner registers/pays
  separately (existing invite flow, per-division). ✅ Works if we treat it as the player's own entry.
- **Team doubles, "pay for both"** (one payer, quantity 2 across N divisions) → **excluded from v1.**
  Bundling a partner's fees across divisions is a separate person's money + invites; do it per-division
  as today. → **Phase 5c.**

So **v1 cart = the player's own quantity-1 entries across divisions.** Pay-for-both stays single-division.
This is **decision #3** (confirm this boundary is acceptable).

## 9. Concurrency (uses the timing we just shipped) — decision #4
Two divisions whose blocks **overlap** can't both be played. Options: **hard-block** adding both vs
**soft-warn**. Recommend: the **cross-sell suggests only non-overlapping** divisions; the cart **warns**
(doesn't block) if the user manually adds conflicting ones. Divisions with **no assigned block** →
unknown → allowed. (A tournament that wants to sell bundles should time-block its divisions first.)

## 10. Fulfillment (webhook)
New `event_type: 'tournament_order'`, `order_id` in Checkout metadata. On `checkout.session.completed`:
mark order `paid`; for each item confirm the reserved registration → `registered`/`paid`, store the
shared PI + `order_id` (or create it, under pay-then-create); waitlist if full; increment the discount
code use once; send **one** confirmation listing all divisions.

## 11. Refunds of a bundled order — decision #5
Cancelling **one** division refunds that item's **`net_cents`** (its allocated share) — clean because
we stored it. Open question: if dropping below `min_divisions` kills bundle eligibility, do we **claw
back** the discount from the remaining divisions? **Recommend: no clawback** in v1 (keep the earned
discount). The organizer-cancel-tournament path refunds all items.

## 12. Cross-sell UI
- On the tournament page + the `?division=` deep-link landing: a **"Add more divisions & save"** panel —
  multi-select of the player's other **eligible, non-conflicting** divisions, showing the running total
  and the bundle discount, leading into the one bundled checkout.
- Keep the existing per-division **Register** button (single-division path) untouched; the bundle is an
  additive surface. This is the largest UI slice → **Phase 5b.**

## 13. Edge cases to handle
- Free divisions mixed with paid (free ones = $0 items, still registered in the same order).
- A division that fills between selection and payment (reserve-then-pay avoids the worst of this).
- Discount code + bundle discount stacking (allowed; code applies after bundle — §6).
- Abandoned carts (reserve-then-pay cron) / idempotent webhook (don't double-create on retry).
- Gender/skill/age eligibility per division (already enforced in the register RPCs — reuse, don't fork).
- Waitlisted item in an otherwise-registered order (partial outcome; store per-item `outcome`).

## 14. Phasing
- **5a — Order primitive + bundled checkout** (singles + solo-doubles only; no cross-sell UI yet):
  tables, discount config + math, reserve-then-pay + webhook, per-item refund. The engine.
- **5b — Cross-sell UI + concurrency**: the "add more & save" surface using the timing read path.
- **5c — Pay-for-both / partner bundling in the cart** (hard; deferred until 5a is proven).

## 15. Open decisions to pressure-test
1. **Reserve-then-pay** (capacity hold + cron) vs **pay-then-create** (simpler, waitlist-on-full).
2. **Discount shape**: `percent_additional` / `flat_per_additional` / `percent_order` — which, and default value?
3. **Doubles boundary**: v1 = player's own quantity-1 entries only; pay-for-both stays single-division. OK?
4. **Concurrency**: hard-block vs soft-warn on overlapping divisions.
5. **Refund clawback** when dropping below `min_divisions`: recommend **no**.
6. **Order tables** (A) vs `group_id`-on-registrations (B).
