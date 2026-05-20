# Pay for Both — Option B (Symmetric) Audit
**Date:** 2026-05-19  
**Status:** READ-ONLY. Zero code changes.  
**Scope:** Symmetric "Pay for Both" — both sides can pay, first payment locks both spots.  
**Live test users:** Roderick Mendoza (inviter) · precious Haganas (invitee)  
**Division under test:** `3dc096c9-b9c1-438b-bb0e-e675567b7a4a`

---

## 1. Where "Pay for Both" Renders Today (and Why the Asymmetry Exists)

### The JSX block

`components/features/tournaments/DivisionsSection.tsx`, lines 888–916:

```tsx
{(!myReg.payment_status || myReg.payment_status === 'unpaid') && (() => {
  const effectiveCost = div.cost_cents != null ? div.cost_cents : tournamentCostCents
  if (effectiveCost <= 0) return null
  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={discountInputs[div.id] ?? ''}
        onChange={e => setDiscountInputs(prev => ({ ...prev, [div.id]: e.target.value }))}
        placeholder="Discount code (optional)"
        className="w-full input text-xs font-mono uppercase"
      />
      <button
        onClick={() => handlePay(myReg.id, div.id)}
        className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
      >
        Pay My Fee · ${(effectiveCost / 100).toFixed(2)}
      </button>
      {myReg.partner_user_id && (
        <button
          onClick={() => handlePay(myReg.id, div.id, true)}
          className="w-full py-2 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-semibold hover:bg-indigo-200 transition-colors"
        >
          Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
        </button>
      )}
    </div>
  )
})()}
{myReg.payment_status === 'paid' && (
  <p className="text-xs text-green-600 font-medium">$ Payment received</p>
)}
```

### The gate condition

Line 906: `{myReg.partner_user_id && (...)}` — "Pay for Both" renders iff `myReg.partner_user_id` is non-null.

`myReg` comes from the `divisions` React state, initialised from the `initialDivisions` prop passed by the server component. This is **static at page-load time**. It is NOT updated by real-time subscriptions. It is only refreshed by an explicit `router.refresh()` call or a full page reload.

### Why the asymmetry exists

This is a **temporal stale-state problem**, not a different code path per user.

**Invitee (Precious):** Her `tournament_registrations` row is created **during the acceptance flow** (`app/api/tournaments/invite/[token]/route.ts:122–132`) with `partner_user_id` already set to Roderick's `user_id` at creation time (`route.ts:143–146`). When she lands on the tournament page after accepting (via the `setTimeout(() => router.push(...), 2000)` redirect at `page.tsx:59`), the server renders fresh data that already has `partner_user_id` set. She sees both buttons from her first page load.

**Inviter (Roderick):** His row (`ad15f730`) had `partner_user_id = null` when he registered. The acceptance flow sets his `partner_user_id` via an UPDATE (route.ts:140–142), but **Roderick's browser already rendered the page with the old state**. His `myReg.partner_user_id` is `null` in client memory. The "Pay for Both" button condition evaluates false. He never sees it unless he manually refreshes.

There is no invitee-specific code path. The block at lines 888–916 is reached by any user whose `myReg` exists. The asymmetry is purely temporal.

---

## 2. Full Invite + Acceptance Code Path

### "Send invite" handler in DivisionsSection.tsx

`components/features/tournaments/DivisionsSection.tsx:290–306`:

```typescript
async function handleSendInvite() {
  if (!justRegistered || !partnerEmail.trim()) return
  setInviteLoading(true)
  setInviteError(null)

  // Prevent self-invite — check against current user's profile email
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.email && user.email.toLowerCase() === partnerEmail.trim().toLowerCase()) {
    setInviteError("You can't invite yourself as a partner.")
    setInviteLoading(false)
    return
  }
  const res = await fetch(
    `/api/tournaments/${tournamentId}/divisions/${justRegistered.divisionId}/invite-partner`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_id: justRegistered.regId, partner_email: partnerEmail.trim() }),
    }
  )
  const json = await res.json()
  if (!res.ok) { setInviteError(json.error ?? 'Failed to send invite'); setInviteLoading(false); return }
  setInviteSent(true)
  setInviteLoading(false)
}
```

No `router.refresh()` is called after invite is sent. Roderick's `divisions` state in memory is unchanged. `myReg.partner_user_id` stays null client-side.

### API route: invite send — full code

`app/api/tournaments/[id]/divisions/[divisionId]/invite-partner/route.ts` (full file, 116 lines):

```typescript
export async function POST(req, props) {
  // 1. Auth check
  // 2. Verify registration belongs to caller
  // 3. Expire any existing pending invite for this registration:
  await service.from('tournament_team_invitations')
    .update({ status: 'expired' })
    .eq('inviter_registration_id', registration_id)
    .eq('status', 'pending')
  // 4. Look up if invitee has a Joinzer account (ilike on profiles.email)
  // 5. Insert into tournament_team_invitations:
  await service.from('tournament_team_invitations').insert({
    tournament_id, division_id, inviter_registration_id: registration_id,
    invitee_email: partner_email.trim().toLowerCase(),
    invitee_user_id: inviteeProfile?.id ?? null,
  })
  // 6. Send email via Resend with acceptUrl = /tournaments/invite/${token}
  return NextResponse.json({ ok: true, invitation_id })
}
```

**DB writes on invite send:**
- `tournament_team_invitations`: one row inserted (or existing pending expired + new inserted)
- `tournament_registrations`: **zero writes** — inviter's `partner_user_id` and `partner_registration_id` are NOT touched

**tournament_team_invitations schema** (`supabase/migrations/20260506000001_tournament_team_invitations.sql:7–16`):
```sql
CREATE TABLE IF NOT EXISTS tournament_team_invitations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id           uuid NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
  inviter_registration_id uuid NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  invitee_email         text NOT NULL,
  invitee_user_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  token                 text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at            timestamptz DEFAULT now()
);
```

**Email service:** Resend, `from: 'Joinzer <support@joinzer.com>'`. Non-Joinzer users receive the same email; the accept page handles unauthenticated visitors with a login redirect.

### API route: acceptance — full code

`app/api/tournaments/invite/[token]/route.ts`, POST handler, lines 50–160:

```typescript
export async function POST(req, props) {
  // 1. Auth check — must be logged in
  // 2. Fetch invitation by token, verify status === 'pending'
  // 3. On 'decline': update status='declined', invitee_user_id=user.id → return
  // 4. On 'accept':
  //    a. Check invitee not already registered in division
  //    b. Count current registered slots vs max_entries
  const regStatus = isFull ? 'waitlisted' : 'registered'
  //    c. Insert invitee's registration:
  const { data: newReg } = await service.from('tournament_registrations').insert({
    tournament_id: inv.tournament_id,
    division_id: inv.division_id,
    user_id: user.id,
    partner_user_id: null,   // set below
    status: regStatus,
    // team_name: NOT set — null
    // registration_type: NOT set — defaults to 'team' per migration constraint
  })
  //    d. Link partner_user_id on BOTH registrations:
  await Promise.all([
    service.from('tournament_registrations')
      .update({ partner_user_id: user.id })              // inviter gets invitee's user_id
      .eq('id', inv.inviter_registration_id),
    service.from('tournament_registrations')
      .update({ partner_user_id: /* inviter's user_id, via nested query */ })
      .eq('id', newReg.id),                              // invitee gets inviter's user_id
  ])
  //    e. Mark invitation accepted:
  await service.from('tournament_team_invitations')
    .update({ status: 'accepted', invitee_user_id: user.id })
    .eq('id', inv.id)
  return NextResponse.json({ ok: true, action: 'accepted', tournament_id, registration_id: newReg.id })
}
```

**Acceptance DB writes:**
- `tournament_registrations`: one INSERT (invitee's new row, `partner_user_id=null` at insert time)
- `tournament_registrations`: UPDATE inviter's row — `partner_user_id = invitee's user_id`
- `tournament_registrations`: UPDATE invitee's new row — `partner_user_id = inviter's user_id` (via a nested extra query at line 144)
- `tournament_team_invitations`: UPDATE status to `'accepted'`

**`partner_registration_id`: NOT set on either row, anywhere in this flow.**

---

## 3. DB State Snapshots — Roderick + Precious (Live)

All four rows in division `3dc096c9-b9c1-438b-bb0e-e675567b7a4a`, ordered by `created_at`:

| id | player | team_name | partner_user_id | partner_reg_id | status | payment_status | stripe_pi |
|---|---|---|---|---|---|---|---|
| `2493b247` | Marty Suidgeest | null | null | null | **cancelled** | **paid** | `pi_3TYZKh…` |
| `eafd5fd6` | Roderick Mendoza | Rick & Xang! | null | null | **cancelled** | unpaid | null |
| `ad15f730` | Roderick Mendoza | rick & Xang | **`e540bddb`** | **null** | registered | unpaid | null |
| `ca05fc90` | precious Haganas | **null** | **`0617d0e4`** | **null** | registered | unpaid | null |

**Invitation records** for registrations in this division:

| inviter_registration_id | invitee_email | invitee_user_id | status | created_at |
|---|---|---|---|---|
| `eafd5fd6` (cancelled) | `precious.haganas@143@gmail.com` | null | pending | 15:52:24 |
| `ad15f730` (active) | `precious.haganas143@gmail.com` | `e540bddb` | **accepted** | 16:09:55 |

**What the state tells us:**

1. Roderick made two registration attempts. The first (`eafd5fd6`, 15:52:05) sent an invite to the malformed address, then was cancelled. The second (`ad15f730`, 16:09:37) sent the corrected address 18 seconds later; Precious accepted 2:36 minutes after that.

2. Both active rows have `partner_user_id` set. According to the current code gate (`DivisionsSection.tsx:906`), both Roderick and Precious should see "Pay for Both" — IF their pages show fresh data. The asymmetry Roderick experienced is stale client state: he registered at 16:09:37, and his `initialDivisions` prop was fetched with `partner_user_id=null`. Precious accepted at 16:12:31 (inviter's page was already loaded by then). Roderick never triggered a `router.refresh()` after that, so his page still shows the pre-acceptance state.

3. Neither active row has `partner_registration_id` set. This gap (identified in the previous audit) persists throughout the real flow.

4. **Incidental finding (HIGH severity):** Marty's row (`2493b247`) shows `status='cancelled'`, `payment_status='paid'`. The cancel route (`app/api/tournaments/[id]/registrations/[regId]/cancel/route.ts:59–62`) attempts to set `payment_status='refunded'` before cancelling. The `tournament_registrations.payment_status` CHECK constraint (`20260506000001` migration, line 4) only permits `('unpaid', 'paid', 'waived')` — `'refunded'` is not in the allowed set. The `UPDATE { payment_status: 'refunded' }` fails silently (Supabase service-role `update` returns error in the result object, which the cancel route does not check). The subsequent `UPDATE { status: 'cancelled' }` succeeds. Result: any cancelled-after-paid registration shows `payment_status='paid'` in perpetuity, and `refunded_at` is also silently not written (assuming the column doesn't exist either). This affects the organizer's payment tracking UI for all cancelled-post-payment registrations.

---

## 4. The "Pay for Both" Backend Gate — Full Paste

`app/api/tournaments/[id]/checkout/route.ts`, lines 22–103:

```typescript
// Verify registration belongs to caller and is unpaid
const { data: reg } = await service
  .from('tournament_registrations')
  .select('id, user_id, payment_status, division_id, partner_user_id')
  .eq('id', registration_id)
  .eq('tournament_id', params.id)
  .single()

if (!reg || reg.user_id !== user.id) {
  return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
}
if (reg.payment_status === 'paid') {
  return NextResponse.json({ error: 'Already paid' }, { status: 409 })
}

// ... price resolution, Connect check ...

// Find partner registration if paying for both
let partnerRegId: string | null = null
if (pay_for_partner && reg.partner_user_id) {
  const { data: partnerReg } = await service
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('division_id', reg.division_id)
    .eq('user_id', reg.partner_user_id)
    .eq('tournament_id', params.id)
    .maybeSingle()
  if (partnerReg && partnerReg.payment_status !== 'paid') {
    partnerRegId = partnerReg.id
  }
}
```

**Guard against concurrent payment — analysis:**

Line 33: `if (reg.payment_status === 'paid')` — blocks the caller if they themselves are already paid. Does NOT block if the PARTNER is already paid.

Line 100: `if (partnerReg && partnerReg.payment_status !== 'paid')` — if the partner is already paid (e.g., partner paid for both first), `partnerRegId` stays null and the session becomes quantity=1 (only paying for the caller). This is partial protection against the "partner already paid, don't double-charge" case — it degrades to a single-player charge rather than erroring. The caller receives no error or warning; they proceed to Stripe for their own fee only.

**Missing guard:** There is no check that says "if my partner already paid for me via Pay for Both, block this checkout entirely." If partner paid for both: partner's `payment_status='paid'`, caller's `payment_status='paid'` (set by webhook). Caller's own `paid` check at line 33 would catch this — but ONLY if the page refreshed after the webhook fired. If the caller's page is stale (payment_status still showing 'unpaid'), the checkout proceeds and creates a duplicate charge for the caller alone.

---

## 5. Concurrent-Payment Race Condition

**Scenario:** Roderick and Precious both click "Pay for Both" within 2 seconds of each other.

**Step-by-step:**

1. Roderick POSTs to `/checkout` with `{ registration_id: 'ad15f730', pay_for_partner: true }`.  
2. Precious POSTs to `/checkout` with `{ registration_id: 'ca05fc90', pay_for_partner: true }`.
3. Both requests pass line 33 — both `payment_status='unpaid'`. ✓
4. Roderick's checkout reads Precious's reg (`ca05fc90`, `payment_status='unpaid'`) → `partnerRegId = 'ca05fc90'`. Quantity = 2.
5. Precious's checkout reads Roderick's reg (`ad15f730`, `payment_status='unpaid'`) → `partnerRegId = 'ad15f730'`. Quantity = 2.
6. Both create Stripe sessions at $10 each (2 × $5).
7. Both users complete Stripe payment. **Two real charges of $10 each → $20 collected for a $10 total fee.**
8. Webhook fires for Roderick's session (`registration_id='ad15f730'`, `partner_registration_id='ca05fc90'`):
   ```typescript
   // webhook/route.ts:55–65
   await service.from('tournament_registrations')
     .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId_R })
     .eq('id', 'ad15f730')
   await service.from('tournament_registrations')
     .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId_R })
     .eq('id', 'ca05fc90')
   ```
9. Webhook fires for Precious's session (`registration_id='ca05fc90'`, `partner_registration_id='ad15f730'`):
   ```typescript
   await service.from('tournament_registrations')
     .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId_P })
     .eq('id', 'ca05fc90')  // already 'paid' — overwrites stripe_payment_intent_id
   await service.from('tournament_registrations')
     .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId_P })
     .eq('id', 'ad15f730')  // already 'paid' — overwrites stripe_payment_intent_id
   ```

**Result:**
- $20 charged ($10 from Roderick, $10 from Precious) instead of $10 total.
- Both rows end up `payment_status='paid'` with `stripe_payment_intent_id` = whichever webhook fired second (the first PI ID is silently overwritten — losing the audit trail for the first payment).
- No error, no duplicate detection, no refund triggered.

**Idempotency gap:** The webhook `UPDATE` at lines 55–65 is unconditional — no `WHERE payment_status = 'unpaid'` filter. It will happily overwrite an already-paid row with a different PI ID. Stripe itself may deduplicate events, but under genuine concurrent checkout sessions (not duplicate deliveries of the same event), Stripe fires distinct `checkout.session.completed` events with distinct session IDs.

**DB-level guard required:** None currently exists. No `SELECT FOR UPDATE`, no unique constraint that prevents two active Stripe sessions from referencing the same `registration_id` pair. No RPC wrapping the payment-status transition.

---

## 6. Exact UI Changes Needed for Option B

### Where inviter's payment buttons render

`DivisionsSection.tsx:888–916` — the IIFE inside `{myReg && (...)}`. There is no separate inviter-vs-invitee render path. The same block renders for all users with a registration.

### What conditional currently hides "Pay for Both" from inviter

`DivisionsSection.tsx:906`: `{myReg.partner_user_id && (...)}`.

Roderick's page at the time of testing had `myReg.partner_user_id = null` in client state (stale). The condition evaluated false. The fix is not adding a new render path — it is ensuring the client state is refreshed after the invitee accepts.

### New state that needs to be tracked client-side for Option B

**1. `partner_accepted` (or `partner_user_id` freshness).**  
Currently `myReg` is populated from `initialDivisions` at page load. For Roderick to see "Pay for Both" without a manual refresh, one of these is required:
- `router.refresh()` called on the tournament page after acceptance (would require the accept page to somehow notify the tournament page, or the user to navigate back)
- A Supabase real-time subscription on `tournament_registrations` that updates `myReg.partner_user_id` in place
- The invitation-accept redirect (`page.tsx:59`) lands on the tournament page, which causes a full server render — this only helps Precious, not Roderick

**2. `payment_in_flight` flag.**  
To prevent concurrent "Pay for Both" submissions, the UI should disable both payment buttons while a checkout POST is in flight. `handlePay` does not currently set any loading state (`regLoading` is not set in `handlePay` — it only calls `fetch` and then navigates or calls `alert`). A `payLoading` state per-reg-id would prevent the user from clicking twice. This does not prevent concurrent payments from two different browsers/devices — that requires a backend guard.

**3. "Already paid by partner" display.**  
Required: distinguish `payment_status='paid'` that I paid vs. that my partner paid for me. Detection path (no schema change): compare `myReg.stripe_payment_intent_id` with partner's reg's `stripe_payment_intent_id`. If both match, partner paid for both. Currently the UI shows only `'$ Payment received'` (line 917) with no partner attribution. The payment buttons block (`payment_status === 'unpaid'`, lines 888–916) would disappear correctly once `payment_status='paid'`, but the "already paid by partner" label would require the payment intent comparison.

---

## 7. Gaps and Risks

| # | Description | Size | Notes |
|---|---|---|---|
| B1 | Inviter's client state is stale after invitee accepts — "Pay for Both" button doesn't appear without page refresh | **Medium** | Fix: `router.refresh()` on tournament page after acceptance, OR real-time subscription on `tournament_registrations` for own row |
| B2 | Concurrent "Pay for Both" from both sides → double charge, no DB guard | **Large** | Requires: backend check in checkout route ("is partner already paid?"), OR `SELECT FOR UPDATE` / RPC, OR unique constraint on active Stripe session per registration. Webhook also needs conditional update (`WHERE payment_status = 'unpaid'`) |
| B3 | No "Already paid by partner" UI state — both cases show "$ Payment received" | **Medium** | Detection: compare own `stripe_payment_intent_id` vs partner's. Requires partner's reg data to be in `myReg` or a separate query. No schema change needed |
| B4 | `partner_registration_id` never set by acceptance flow | **Medium** | Checkout route works around this via `partner_user_id` lookup, but state is inconsistent and could break if partner re-registers. Fix: set in acceptance route alongside `partner_user_id` updates |
| B5 | `handlePay` has no loading state — user can double-click and fire two checkout requests | **Small** | Add `payLoading` state per registration, disable buttons while in-flight. Prevents same-browser double-fire |
| B6 | `payment_status='refunded'` is not in the CHECK constraint — cancel route's refund status update fails silently | **HIGH INCIDENTAL** | `20260506000001` migration CHECK only allows `('unpaid','paid','waived')`. Cancel route writes `'refunded'` — silently fails. Cancelled-post-payment rows show `payment_status='paid'` forever. `refunded_at` column likely also missing. Needs migration to add `'refunded'` to CHECK and `refunded_at timestamptz` column |
| B7 | Invitee's `team_name` is null on their registration (not copied from inviter) | **Small** | Cosmetic — acceptance route doesn't copy `team_name` |
| B8 | Decline sends no notification to inviter | **Small** | Inviter never learns invite was declined |
| B9 | No email to partner when covered by "Pay for Both" | **Small** | Webhook sends confirmation only to the paying registrant |
| B10 | "Pay for Both" degrades silently to single-player charge if partner already paid | **Small** | Current behavior: `partnerRegId` stays null, Stripe session is quantity=1. No error surfaced to user. Should show "partner already paid" message instead |

### DB-level guard recommendation for B2

Minimum required for production safety on the concurrent-payment path:

Option A (application-level, no schema change): In the checkout route, after fetching `reg`, also fetch `partner_reg` and check `partner_reg.payment_status === 'paid'` — if true, return 409 with "Already covered by your partner." Add `AND payment_status = 'unpaid'` filter on webhook UPDATE.

Option B (DB-level, stronger): Wrap payment status transitions in an RPC with `SELECT ... FOR UPDATE` on both rows. Matches the architecture target in `docs/architecture-target.md` ("Sensitive writes go through RPC, not direct table updates").

Option A is smaller; Option B is architecturally correct. Both are needed in combination with webhook conditional updates.

---

## Appendix — Timeline Reconstruction (Roderick + Precious)

```
15:52:05  Roderick registers (eafd5fd6, team='Rick & Xang!', partner_user_id=null)
15:52:24  Invite sent to precious.haganas@143@gmail.com (malformed — likely undelivered)
~15:5x    Roderick cancels eafd5fd6 (unpaid, no refund attempted)
16:09:37  Roderick re-registers (ad15f730, team='rick & Xang', partner_user_id=null at creation)
16:09:55  Invite sent to precious.haganas143@gmail.com (correct) → accepted immediately by Precious
            → Roderick's ad15f730.partner_user_id set to Precious's user_id
16:12:31  Precious's registration created (ca05fc90, partner_user_id=Roderick's user_id, team_name=null)
~16:12:xx Precious visits tournament page (server renders fresh data, partner_user_id set) → sees both buttons
~16:12:xx Roderick still on page from 16:09 load (partner_user_id still null in client state) → sees one button
```

The asymmetry Roderick experienced is fully explained by stale React state. Both rows have `partner_user_id` set in the DB. No code branch treats inviter and invitee differently.
