# Multi-Division Cart — Stripe Smoke Test (runbook)

> Validates the reserve-then-pay bundle end to end against **real Stripe (TEST mode)**: create an
> order + hold reservations → pay on Stripe Checkout → webhook fulfillment → per-seat refund.
> The automated gates + 11 unit tests cover the math; this covers the live Stripe wiring they can't.
>
> **NEVER run this with live keys.** Use `sk_test_…` throughout. Recommended path below is local dev +
> Stripe test keys + Stripe CLI, testing the **non-Connect** path (plain platform charge — no test
> Connect account needed). ~15 min. Design: `docs/phases/multi-division-cart.md`.
>
> **✅ Run July 15, 2026 — PASSED.** All four checks green: reserve-then-pay, webhook `tournament_order`
> fulfillment, confirmation email, and per-seat `net_cents` refund (cancelled one bundled division →
> refunded only its `$9` of `$18`, the sibling stayed `paid`). Only the Connect destination-charge
> branch (`reverse_transfer`) remains unverified — needs a test Connect account.

---

## 0. What gets exercised

| Step | Route / code | What it proves |
|---|---|---|
| Reserve + checkout | `POST /api/tournaments/[id]/orders` | 2+ divisions → reservations (`registered`/`unpaid`) + `tournament_orders` (`pending`) + one Stripe Checkout session with the bundled total |
| Fulfillment | `/api/stripe/webhook` → `event_type='tournament_order'` | order + regs flip to `paid`, `order_items.outcome='registered'`, one confirmation email listing all divisions |
| Refund | `POST /api/tournaments/[id]/registrations/[regId]/cancel` | one bundled reg refunds exactly its `net_cents` share |
| Cleanup cron | `/api/cron/expire-tournament-orders` | (optional) abandoned `pending` order cancels its unpaid reservations |

Not covered here (needs a test Connect account): the destination-charge branch — `application_fee_amount`,
`on_behalf_of`, `transfer_data.destination`, and `reverse_transfer` on refund.

---

## 1. Setup (one-time)

1. **Stripe test keys.** Stripe Dashboard → toggle **Test mode** (top right) → Developers → API keys.
   Copy the **Secret key** (`sk_test_…`).
2. **Stripe CLI.** Install (`scoop install stripe` / `brew install stripe/stripe-cli/stripe` /
   [docs](https://stripe.com/docs/stripe-cli)), then `stripe login`.
3. **`.env.local`** — set the test secret key (keep a backup of any live value you overwrite):
   ```
   STRIPE_SECRET_KEY=sk_test_xxx
   ```
   (The bundle flow redirects to Stripe-hosted Checkout, so no publishable key is needed. Supabase
   keys stay as-is.)
4. **Forward webhooks** in a dedicated terminal — this prints the signing secret:
   ```
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Copy the `whsec_…` it prints into `.env.local`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```
5. **Run the app:** `npm run dev` (a third terminal). Restart it after editing `.env.local`.

> ⚠️ Local dev uses the **prod Supabase DB**. This test therefore creates real rows — use the
> throwaway tournament below and delete it in §5 so you don't leave test data in prod.

---

## 2. Create throwaway test data

Do this in the app UI (logged in as an organizer **without** Stripe Connect, so it takes the plain-charge path):

1. **Create a tournament** with a start date in the future. Set a **base entry fee** (e.g. `$10`).
2. On the create/edit form, set the **"Multi-division discount"** field (e.g. `20`) — this is what makes
   the "Enter multiple divisions & save" panel appear. (Stored as
   `tournaments.multi_division_discount = {type:'percent_additional', value:20, min_divisions:2}`.)
3. Add **two (or three) divisions**, each **open** with capacity ≥ 2. Leave the per-division fee blank so
   they inherit the `$10` base (or set explicit `cost_cents`).
4. Note the **tournament id** (in the URL) — call it `$TID`.

You'll also need a **second account** that is a *player* (not the organizer) — the bundle panel only
renders for a logged-in non-organizer eligible for 2+ open divisions.

---

## 3. The happy path (reserve → pay → fulfill)

As the **player** account:

1. Open `/tournaments/$TID`. Under the divisions you should see **"💸 Enter multiple divisions & save"**
   with `20% off each division after your first`.
2. Check **2 divisions** → the panel shows Subtotal `$20.00`, Bundle discount `−$2.00`, **Total `$18.00`**.
3. Click **Register 2 divisions — $18.00**. You're redirected to Stripe Checkout.
   - **Verify now (before paying):** in a DB tool, the two `tournament_registrations` rows exist with
     `status='registered'`, `payment_status='unpaid'`, and a `tournament_orders` row is `pending` with
     `total_cents=1800`, plus two `tournament_order_items` (their `net_cents` should sum to `1800`).
4. Pay with test card **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP.
5. Watch the `stripe listen` terminal: `checkout.session.completed → 200` to
   `/api/stripe/webhook`.
6. **Verify fulfillment (DB):**
   - `tournament_orders`: `status='paid'`, `stripe_payment_intent_id` set.
   - `tournament_order_items`: `outcome='registered'`.
   - both `tournament_registrations`: `payment_status='paid'`, same `stripe_payment_intent_id`.
   - `email_log`: a **"Payment confirmed — <tournament>"** row to the player, listing both divisions.
7. **Verify UI:** back on `/tournaments/$TID?payment=success`, the player now shows as registered in both
   divisions.

---

## 4. Refund one division (per-seat refund)

Cancel **one** of the player's two bundled registrations (player's own cancel, or organizer withdraw):

- `POST /api/tournaments/$TID/registrations/<regId>/cancel` (or via the UI's cancel/withdraw control).
- **Verify:** Stripe test Dashboard → Payments → that PaymentIntent shows a **partial refund** equal to
  that division's `net_cents` (e.g. `$9.00` of the `$18.00`), **not** the whole payment. The other
  division stays paid. `tournament_registrations.payment_status='refunded'` on the cancelled one.
- This is the point of storing `net_cents` per item — the refund returns exactly that division's share.

---

## 5. Cleanup (important — this is the prod DB)

- Delete the throwaway tournament from the UI (cascades divisions/registrations), **or** via SQL:
  ```sql
  delete from tournament_orders where tournament_id = '<TID>';
  delete from tournaments where id = '<TID>';  -- FK cascades divisions + registrations
  ```
- **Restore `.env.local`** to your live Stripe keys (or clear the test values) and restart dev.
- Stop `stripe listen`.

---

## 6. Optional extras

- **Free bundle:** make the divisions free → the orders route returns `{free:true}` and skips Stripe
  (regs go straight to `waived`/`registered`). Confirms the no-charge branch.
- **Abandoned cart:** create an order (step 3) but **don't pay**; wait, then hit the cron with the secret
  (`curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/expire-tournament-orders`) and
  confirm the `pending` order → `expired` and its unpaid regs → `cancelled` (only rows >30 min old).
- **Pay-for-both (5c):** in the panel, toggle "Also pay for my partner" on a doubles division + a partner
  email (a real second account) → total adds a full-price seat; after payment, the partner gets their own
  `paid` registration cross-linked, and a "your partner paid your entry" email.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No bundle panel on the tournament | `multi_division_discount` not set, fewer than 2 open divisions eligible, or you're logged in as the organizer (panel is players-only). |
| Redirect to Checkout fails / 500 | `STRIPE_SECRET_KEY` missing/live-vs-test mismatch; check the dev server logs. |
| Paid but regs stay `unpaid` | Webhook not delivered — is `stripe listen` running + `STRIPE_WEBHOOK_SECRET` set to its `whsec_`? Look for a signature-verification error in the webhook logs. |
| Refund returns the whole amount | The reg isn't in `tournament_order_items` (not a bundled reg) — that's the standalone path; a bundled reg refunds `net_cents`. |
