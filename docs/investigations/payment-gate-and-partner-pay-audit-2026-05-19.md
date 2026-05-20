# Payment Gate & Partner-Pay Audit — 2026-05-19

**Status:** READ-ONLY. Zero code changes.  
**Scope:** Event join, league register, tournament division register.

---

## Part 1 — Flow Map

### 1A. Event Join Flow

**Entry point**  
`components/features/events/JoinLeaveButton.tsx` — single `handleJoin` function, `onClick` on the "Join session" / "Pay & Join" button.

**Client-side handler (lines 22–48)**
```tsx
// JoinLeaveButton.tsx:19
const isPaid = priceCents > 0

// JoinLeaveButton.tsx:26–36 — paid path
if (isPaid) {
  const res = await fetch(`/api/events/${eventId}/checkout`, { method: 'POST' })
  const data = await res.json()
  if (data.url) {
    window.location.href = data.url   // ← redirects to Stripe, no DB write yet
    return
  }
}

// JoinLeaveButton.tsx:40–46 — free path only
const supabase = createClient()
const { error } = await supabase.rpc('join_event', { p_event_id: eventId })
```

**Paid path — server side**  
`app/api/events/[id]/checkout/route.ts` — validates event exists, not cancelled, not past deadline, `price_cents > 0`, not already paid/joined, then creates a Stripe Checkout session:
```typescript
// checkout/route.ts:70–88
const stripeSession = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price_data: { currency: 'usd', unit_amount: priceCents, ... }, quantity: 1 }],
  metadata: { event_type: 'session', event_id: params.id, user_id: user.id, join_as: ... },
  success_url: `.../events/${params.id}?payment=success`,
  cancel_url:  `.../events/${params.id}?payment=cancelled`,
})
return NextResponse.json({ url: stripeSession.url })
```
**No DB write at this point.** The `event_participants` row is created by the webhook after Stripe confirms payment.

**Webhook — event_participants insert**  
`app/api/stripe/webhook/route.ts` lines 143–218, fires on `checkout.session.completed` when `meta.event_type === 'session'`:
```typescript
// webhook/route.ts:161–170
await service
  .from('event_participants')
  .upsert({
    event_id: meta.event_id,
    user_id: meta.user_id,
    participant_status: joinAs,   // 'joined' or 'waitlist' — rechecked at webhook time
    payment_status: 'paid',
    stripe_payment_intent_id: paymentIntentId,
    joined_at: new Date().toISOString(),
  }, { onConflict: 'event_id,user_id' })
```

**Free path — RPC**  
`supabase/migrations/20260515000001_standardize_registration_closes_at.sql` — the live `join_event` RPC (lines 81–155):
```sql
-- 20260515 migration, lines 120–122
if v_event.price_cents is not null and v_event.price_cents > 0 then
  raise exception 'Payment required to join this session';
end if;
```
Free-path insert (migration line 154):
```sql
insert into event_participants (event_id, user_id, participant_status, payment_status)
values (p_event_id, v_user_id, v_new_status, 'free');
```

**Where the gate is**  
Two independent gates:
1. **Client gate** (`JoinLeaveButton.tsx:26`) — paid events never call `join_event` at all; they go to `/checkout`.
2. **RPC gate** (`20260515 migration, line 120`) — `join_event` raises an exception if `price_cents > 0`. Added 2026-05-15.

**Bypass theory**  
Before the 2026-05-15 migration, the original `join_event` RPC (`supabase/migrations/20260420000003_rpcs.sql`, lines 12–84) had no payment gate. It inserted the row regardless of `price_cents`. Any user who called `join_event` directly (or through an unguarded UI path) before that migration landed could create an unpaid participant row. See Part 2.

---

### 1B. League Register Flow

**Entry point**  
`app/(app)/compete/leagues/[id]/LeagueActions.tsx` — `handleRegister` function, `onClick` on the register/pay button.

**Client-side gate (from partial read; line 49, 55–57)**
```typescript
const isPaid = costCents > 0

if (isPaid) {
  const res = await fetch(`/api/leagues/${leagueId}/checkout`, { method: 'POST' })
  // ... redirect to Stripe URL
}
```

**Free path — API route**  
`app/api/league-register/route.ts` — the explicit server-side gate (lines 63–65):
```typescript
if ((league as any).cost_cents > 0) {
  return NextResponse.json({ error: 'Payment required', requiresPayment: true }, { status: 402 })
}
```
Free upsert (lines 100–105):
```typescript
await admin
  .from('league_registrations')
  .upsert(
    { league_id: leagueId, user_id: user.id, status, registration_type },
    { onConflict: 'league_id,user_id' }
  )
```
Note: this upsert does NOT set `payment_status` — column defaults apply.

**Paid path — checkout + webhook**  
`app/api/leagues/[id]/checkout/route.ts` creates Stripe session with `metadata: { event_type: 'league', league_id, user_id, join_as }`.  
Webhook (`webhook/route.ts` lines 220–233) upserts `league_registrations` with `payment_status: 'paid'` and `stripe_payment_intent_id` on `checkout.session.completed`.

**Where the gate is**  
Two independent gates:
1. **Client gate** (`LeagueActions.tsx:55`) — paid leagues go to checkout, not `/api/league-register`.
2. **API gate** (`league-register/route.ts:63`) — explicit 402 if `cost_cents > 0`.

**No bypass theory** — both gates are present and consistent. League register is clean.

---

### 1C. Tournament Division Register Flow

**Entry point**  
`components/features/tournaments/DivisionsSection.tsx` — `handleRegister` async function, button `onClick` at line 908.

**Flow (registration-first, then payment)**  
Unlike events and leagues, tournaments create the DB row FIRST, then gate on payment:

```typescript
// DivisionsSection.tsx:240–244 — POST to register route first
const res = await fetch(
  `/api/tournaments/${tournamentId}/divisions/${div.id}/register`,
  { method: 'POST', body: JSON.stringify({ team_name, registration_type }) }
)
const json = await res.json()
```

**Register route** (`app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts`) inserts the row (lines 111–122):
```typescript
const { data: registration } = await service
  .from('tournament_registrations')
  .insert({
    tournament_id: params.id,
    division_id: params.divisionId,
    user_id: targetUserId,
    team_name: ...,
    status,
    registration_type,
    // payment_status NOT set here — defaults to 'unpaid' (migration 20260506000001)
  })
  .select('id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, registration_type')
  .single()
```

**Post-registration payment gate** (added 2026-05-18, commit `7032cbc`):
```typescript
// DivisionsSection.tsx:257–265
const effectiveCost = div.cost_cents != null ? div.cost_cents : tournamentCostCents
if (effectiveCost > 0 && json.registration.status === 'registered') {
  setTeamName('')
  setRegLoading(false)
  setRegisteringDiv(null)
  await handlePay(json.registration.id, div.id)  // ← immediately calls checkout route
  return
}
```

`handlePay` (lines 490–508) posts to `/api/tournaments/${tournamentId}/checkout`, which creates the Stripe session and returns a URL → `window.location.href = json.url`.

**Where the gate is**  
Only one gate: the **client-side post-registration redirect** in DivisionsSection, added 2026-05-18.  
- No server-side payment gate on the register route itself — it inserts unconditionally.
- A window exists between insert and Stripe redirect: if the client crashes, loses network, or the user closes their tab between the POST response and the Stripe redirect, the row persists with `payment_status='unpaid'`.
- Waitlisted registrations intentionally bypass the gate (`json.registration.status === 'registered'` check on line 259).

**Before 2026-05-18:** No post-registration redirect at all. `handleRegister` just closed the modal. The "Pay My Fee" button was a manual follow-up. Users could register and never pay.

---

## Part 2 — gngnf Forensics

**The row:** `event_participants` for event "gngnf", user Marty Suidgeest, `payment_status='unpaid'`, no `stripe_payment_intent_id`.

**How it was created**

Path (a) — through the normal `join_event` RPC before the payment gate existed.

The original RPC (`supabase/migrations/20260420000003_rpcs.sql`, lines 12–84) contained no price check. Key section:
```sql
-- 20260420000003_rpcs.sql lines 73–79 (original join_event)
if v_has_existing then
  update event_participants
  set participant_status = v_new_status, joined_at = now()
  where event_id = p_event_id and user_id = v_user_id;
else
  insert into event_participants (event_id, user_id, participant_status)
  values (p_event_id, v_user_id, v_new_status);
end if;
```
No `payment_status` column, no price check. Any call to `join_event` succeeded for any event.

The payment gate was added by migration `20260515000001_standardize_registration_closes_at.sql` (the `CREATE OR REPLACE FUNCTION join_event` block at lines 81–155), which added:
```sql
-- lines 120–122
if v_event.price_cents is not null and v_event.price_cents > 0 then
  raise exception 'Payment required to join this session';
end if;
```

**Conclusion:** The gngnf row was created before 2026-05-15. Either through the original unguarded RPC directly, or through an old version of `JoinLeaveButton` that called `join_event` for paid events (before the `isPaid` branch was added). The current code makes this impossible: `JoinLeaveButton.tsx:26` intercepts paid events before the RPC is called, and the RPC itself now raises an exception.

**Every path that can INSERT into event_participants:**

| Path | How | Payment check? |
|---|---|---|
| `join_event` RPC (current) | `supabase.rpc('join_event')` from `JoinLeaveButton.tsx:41` | Yes — raises exception if `price_cents > 0` (20260515 migration) |
| Stripe webhook | `service.from('event_participants').upsert(...)` in `webhook/route.ts:161` | N/A — only fires after successful Stripe payment |

No other TypeScript file does `.from('event_participants').insert(`. The `app/api/events/[id]/participants/[userId]/payment/route.ts` only does `.update({ payment_status })` — it updates an existing row, never inserts.

The gngnf row can no longer be created by the current code. It is a legacy artifact.

---

## Part 3 — Partner-Pay Design Landscape

### 3A. Schema support per entity type

**event_participants**  
Original schema (`20260420000001_schema.sql` lines 63–71): only `id, event_id, user_id, participant_status, joined_at`.  
No `partner_user_id`, no `partner_registration_id`.  
`payment_status` and `stripe_payment_intent_id` exist on the table (used by webhook and `payment/route.ts`) but are NOT in any tracked `CREATE TABLE` or `ALTER TABLE` migration. These columns were added directly through the Supabase dashboard or in an untracked operation. **This is the migration documentation gap flagged in the Issues section below.**

**league_registrations**  
The `CREATE TABLE league_registrations` is NOT found in any tracked migration file. The table exists in production (the app works), but its initial definition is untracked.  
Columns confirmed by `ALTER TABLE` in `20260508000001_solo_registration_type.sql` (lines 8–12):
```sql
ALTER TABLE league_registrations
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'team'
    CHECK (registration_type IN ('team', 'solo')),
  ADD COLUMN IF NOT EXISTS partner_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_registration_id uuid REFERENCES league_registrations(id) ON DELETE SET NULL;
```
`partner_user_id` and `partner_registration_id`: **present since 2026-05-08.**

**tournament_registrations**  
`CREATE TABLE` in `20260501000001_tournament_divisions.sql` lines 47–58:
```sql
CREATE TABLE tournament_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id     uuid NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- ← from day 1
  team_name       text,
  status          text NOT NULL DEFAULT 'registered' ...
);
```
`partner_registration_id` added in `20260508000001_solo_registration_type.sql` line 6.  
`payment_status text NOT NULL DEFAULT 'unpaid'` added in `20260506000001_tournament_team_invitations.sql` lines 3–4.

### 3B. UI partner flow per entity type

**Events:** No partner concept in the UI at all. `JoinLeaveButton.tsx` has no partner step.

**Leagues:** Auto-match only. `app/api/league-register/route.ts` lines 112–228: if `registration_type === 'solo'`, the route searches for an unmatched solo in the same league (gender-filtered for men's/women's), links both registrations via `partner_user_id` / `partner_registration_id`, and sends match emails. No manual partner invite UI for leagues. The `LeagueActions.tsx` has a Solo toggle (inferred from the route's `registration_type` param support), but no "invite your partner" modal step.

**Tournaments:** Both auto-match and manual invite. `DivisionsSection.tsx`:
- Team registration → shows partner invite modal (Step 2) after registration. The modal calls `/api/tournaments/[id]/divisions/[divisionId]/invite-partner` with the partner's email.
- Solo registration → triggers auto-match via register route (lines 131–222 of register route).
- Partner invite appears **after** registration, **before** or **independent of** payment. Since commit `7032cbc`, paid team registrations redirect to Stripe immediately — the partner invite step is skipped (see DivisionsSection lines 259–265: `return` after `handlePay` call, never reaches the `justRegistered` block).

### 3C. Payment split mechanics

**Events:** No partner concept → no split. Single Stripe line item, quantity=1. Webhook creates one `event_participants` row.

**Leagues:** No "pay for partner" in the checkout route.  
`app/api/leagues/[id]/checkout/route.ts` creates a session with:
```typescript
line_items: [{ price_data: { unit_amount: costCents, ... }, quantity: 1 }],
metadata: { event_type: 'league', league_id, user_id, join_as }
```
No `pay_for_partner` param, no `partner_registration_id` in metadata, quantity always 1.  
Webhook (`webhook/route.ts` lines 220–233) upserts one row only.  
**Leagues have the partner schema but zero partner-pay support in checkout or webhook.**

**Tournaments:** "Pay for Both" is implemented.  
`app/api/tournaments/[id]/checkout/route.ts` lines 90–143:
```typescript
// If pay_for_partner: look up partner's registration ID
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

const quantity = partnerRegId ? 2 : 1

// Webhook metadata includes both IDs
metadata: {
  registration_id,
  tournament_id: params.id,
  partner_registration_id: partnerRegId ?? '',
  ...
}
```
Webhook updates both rows on success (lines 60–65).

Design: one Stripe charge covers both partners (quantity=2 at unit price, or quantity=1 with doubled line item effectively). Both registrations share the same `stripe_payment_intent_id`.

### 3D. Honest gaps

| Gap | Details |
|---|---|
| No entity supports paying for your partner via separate Stripe sessions | Only "pay for both in one charge" exists, and only on tournaments |
| League partner schema exists but checkout/webhook has zero awareness of it | `league_registrations.partner_user_id` / `partner_registration_id` are set by auto-match, but the league checkout never passes them to Stripe. If both partners in a paid doubles league need to pay separately, the system has no mechanism for it |
| After commit `7032cbc`, the tournament partner invite step is silently skipped for paid registrations | `handleRegister` returns immediately after `handlePay` for paid sessions, never setting `justRegistered`. Partner invite becomes unavailable for paid team registrations |
| Events have no partner concept at all | No schema, no UI, no intent captured anywhere |
| `league_registrations` CREATE TABLE is not in any tracked migration | Its initial column set is unknown from the repo alone |
| `event_participants.payment_status` and `event_participants.stripe_payment_intent_id` are used by webhook and payment route but never appear in an `ALTER TABLE` migration | Added out-of-band |

---

## Part 4 — Sanity Check

### 4A. Is the JoinLeaveButton claim true?

**Claim:** "events/clinics already gated — JoinLeaveButton redirects to Stripe when priceCents > 0"

**Verdict: TRUE for the current code.**

From `components/features/events/JoinLeaveButton.tsx` lines 22–36:
```typescript
async function handleJoin() {
  setLoading(true)
  setError(null)

  if (isPaid) {
    // Paid session — go to Stripe checkout
    const res = await fetch(`/api/events/${eventId}/checkout`, { method: 'POST' })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
      return   // ← page navigates away; join_event RPC is never called
    }
    setError(data.error ?? 'Could not start checkout')
    setLoading(false)
    return
  }

  // Free session — join directly via RPC
  const supabase = createClient()
  const { error } = await supabase.rpc('join_event', { p_event_id: eventId })
```

Paid events go to Stripe only. `join_event` is never called for paid events in the current client code.

**Why did the gngnf row get through anyway?**  
The gngnf row predates this gate. The original `join_event` RPC (20260420000003) had no payment check. At some point before 2026-05-15, either (a) the client code didn't have the `isPaid` branch yet, or (b) the test was done via direct RPC call (e.g., Supabase dashboard SQL). The 2026-05-15 migration added the RPC gate; the current client code has never allowed unpaid join_event calls. The row is a fossil.

### 4B. What commit was the tournament "just fixed" claim referring to?

`git log --oneline -10 -- components/features/tournaments/DivisionsSection.tsx`:
```
dbed17c feat: auto-refund on tournament registration cancel
7032cbc fix: gate tournament paid registrations behind Stripe checkout   ← this one
a4a34f1 feat: rename tournament_divisions.format_type → bracket_type (4.1.5)
...
```

Commit `7032cbc` (2026-05-18, "fix: gate tournament paid registrations behind Stripe checkout") is the fix. It added lines 257–265 to `handleRegister` in DivisionsSection.

### 4C. Is the fix on main?

Yes. `git log --oneline` shows `dbed17c` (most recent) followed by `7032cbc` — both are on `main`. No branch required; both were committed directly to main.

### 4D. Does the gngnf row contradict the JoinLeaveButton gate?

No contradiction. The sequence:
1. gngnf row created (before 2026-05-15) — original unguarded RPC, no client gate either
2. `20260515000001` migration adds RPC payment gate
3. `JoinLeaveButton` `isPaid` branch added (date unclear, but present in current code)
4. gngnf row remains as-is — no retroactive cleanup ran

The gngnf row is not evidence of a current vulnerability. It's evidence of what the code looked like ~4+ weeks ago.

---

## Issues Found

### ISSUE 1 — Untracked schema columns on event_participants (severity: low, operational risk)
`event_participants.payment_status` and `event_participants.stripe_payment_intent_id` are used by:
- `app/api/stripe/webhook/route.ts` lines 167–168
- `app/api/events/[id]/participants/[userId]/payment/route.ts` line 39
- `supabase/migrations/20260515000001_standardize_registration_closes_at.sql` line 154

But neither column appears in any `CREATE TABLE` or `ALTER TABLE` migration file. They were added directly through the dashboard. If the database is ever rebuilt from migrations alone, these columns would be missing and the payment flow would break.

### ISSUE 2 — league_registrations CREATE TABLE is untracked (severity: low)
No migration creates `league_registrations`. Its initial column set — including whether it originally had `payment_status`, `stripe_payment_intent_id`, or `registered_at` — cannot be determined from the repo.

### ISSUE 3 — Tournament partner invite step silently skipped for paid registrations (severity: medium, UX bug)
Since commit `7032cbc`, `handleRegister` in DivisionsSection calls `handlePay` and returns immediately for paid registered spots. The `justRegistered` state (which triggers the partner invite modal) is never set. Players registering as a team on a paid division have no way to invite their partner through the in-app flow — they land on the Stripe redirect with no partner linked. The "Pay for Both" button requires `reg.partner_user_id` to be set, which can only happen via the invite flow. This makes "Pay for Both" unavailable for all new paid team registrations.

### ISSUE 4 — Hardcoded `['Fee', 'Free']` in league confirmation email (severity: cosmetic)
`app/api/league-register/route.ts` line 263: `['Fee', 'Free']`. Unlike the tournament register route (fixed 2026-05-18), the league route still hardcodes `'Free'`. This is technically correct today because the route only runs for `cost_cents === 0` leagues (paid leagues are blocked at line 63 and go through checkout). But it's a latent copy-paste debt.

### ISSUE 5 — gngnf row with payment_status='unpaid' (severity: informational, not a current bug)
This specific row should be either cleaned up (cancelled) or manually marked `payment_status='waived'` by the captain if the session has already run. It won't cause any runtime errors, but it pollutes the `PaymentTracker` UI on the event detail page, showing an "Unpaid" badge.
