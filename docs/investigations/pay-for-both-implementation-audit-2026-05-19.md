# Pay for Both — Implementation Audit
**Date:** 2026-05-19  
**Status:** READ-ONLY. Zero code changes.  
**Scope:** Invite flow, acceptance flow, DB state matrix, checkout gate, UI buttons, gap list, Roderick's specific case.

---

## 1. The Invite Flow

### Which route gets called

`POST /api/tournaments/[id]/divisions/[divisionId]/invite-partner`  
Source: `app/api/tournaments/[id]/divisions/[divisionId]/invite-partner/route.ts`

Called from `DivisionsSection.tsx:294–300` inside `handleSendInvite`:
```typescript
const res = await fetch(
  `/api/tournaments/${tournamentId}/divisions/${justRegistered.divisionId}/invite-partner`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registration_id: justRegistered.regId, partner_email: partnerEmail.trim() }),
  }
)
```

### What the route writes to the DB

The route writes **only to `tournament_team_invitations`**. It does not touch `tournament_registrations` at all.

Step 1 — expire any existing pending invite for this registration (route.ts:41–45):
```typescript
await service
  .from('tournament_team_invitations')
  .update({ status: 'expired' })
  .eq('inviter_registration_id', registration_id)
  .eq('status', 'pending')
```

Step 2 — look up whether the invitee already has a Joinzer account (route.ts:48–52):
```typescript
const { data: inviteeProfile } = await service
  .from('profiles')
  .select('id, name')
  .ilike('email', partner_email.trim())
  .maybeSingle()
```

Step 3 — insert into `tournament_team_invitations` (route.ts:55–65):
```typescript
const { data: invitation } = await service
  .from('tournament_team_invitations')
  .insert({
    tournament_id: params.id,
    division_id: params.divisionId,
    inviter_registration_id: registration_id,
    invitee_email: partner_email.trim().toLowerCase(),
    invitee_user_id: inviteeProfile?.id ?? null,
  })
  .select('id, token')
  .single()
```

**`tournament_registrations.partner_user_id` — NOT set.**  
**`tournament_registrations.partner_registration_id` — NOT set.**  
The inviter's registration row is untouched by this route.

### If the partner isn't a Joinzer user yet

`inviteeProfile` is null → `invitee_user_id` is inserted as `null`. The invite row is created and the email is sent regardless. The email contains an accept link at `/tournaments/invite/${invitation.token}`. The invite page shows a "Sign in to Accept" button when the visitor is not authenticated (page.tsx:157).

### Full route code

```typescript
// app/api/tournaments/[id]/divisions/[divisionId]/invite-partner/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { registration_id, partner_email } = body

  if (!registration_id || !partner_email) {
    return NextResponse.json({ error: 'registration_id and partner_email are required' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify the registration belongs to the caller
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, tournament_id, division_id')
    .eq('id', registration_id)
    .eq('division_id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg || reg.user_id !== user.id) {
    return NextResponse.json({ error: 'Registration not found or not yours' }, { status: 403 })
  }

  // Cancel any existing pending invitation for this registration
  await service
    .from('tournament_team_invitations')
    .update({ status: 'expired' })
    .eq('inviter_registration_id', registration_id)
    .eq('status', 'pending')

  // Look up if invitee already has an account
  const { data: inviteeProfile } = await service
    .from('profiles')
    .select('id, name')
    .ilike('email', partner_email.trim())
    .maybeSingle()

  // Create invitation record
  const { data: invitation, error: invErr } = await service
    .from('tournament_team_invitations')
    .insert({
      tournament_id: params.id,
      division_id: params.divisionId,
      inviter_registration_id: registration_id,
      invitee_email: partner_email.trim().toLowerCase(),
      invitee_user_id: inviteeProfile?.id ?? null,
    })
    .select('id, token')
    .single()

  if (invErr || !invitation) {
    return NextResponse.json({ error: invErr?.message ?? 'Failed to create invitation' }, { status: 500 })
  }

  // Fetch context for email
  const [{ data: inviterProfile }, { data: tournament }, { data: division }] = await Promise.all([
    service.from('profiles').select('name').eq('id', user.id).single(),
    service.from('tournaments').select('name, start_date').eq('id', params.id).single(),
    service.from('tournament_divisions').select('name').eq('id', params.divisionId).single(),
  ])

  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'}/tournaments/invite/${invitation.token}`
  // ... email send ...

  return NextResponse.json({ ok: true, invitation_id: invitation.id })
}
```

---

## 2. The Acceptance Flow

### Where the landing logic lives

Page: `app/(app)/tournaments/invite/[token]/page.tsx`  
API: `POST /api/tournaments/invite/[token]` (`app/api/tournaments/invite/[token]/route.ts`)

The page loads the invite details via `GET /api/tournaments/invite/${token}` on mount (page.tsx:33). If the visitor is not authenticated, `handleAction` redirects to `/login?redirect=/tournaments/invite/${token}` (page.tsx:45). Once authenticated, `handleAction('accept')` posts to the API.

### What the acceptance route writes

`app/api/tournaments/invite/[token]/route.ts`, POST handler, lines 83–159.

**Step 1 — Create the invitee's registration** (route.ts:122–132):
```typescript
const { data: newReg } = await service
  .from('tournament_registrations')
  .insert({
    tournament_id: inv.tournament_id,
    division_id: inv.division_id,
    user_id: user.id,
    partner_user_id: null,   // set below in the Promise.all
    status: regStatus,
  })
  .select('id')
  .single()
```
Note: `team_name` is not set on the invitee's row. It will be null.  
Note: `registration_type` is not set. Defaults to `'team'` (migration `20260508000001` default).

**Step 2 — Link `partner_user_id` on both rows** (route.ts:139–146):
```typescript
await Promise.all([
  service.from('tournament_registrations')
    .update({ partner_user_id: user.id })
    .eq('id', inv.inviter_registration_id),
  service.from('tournament_registrations')
    .update({ partner_user_id: (await service
      .from('tournament_registrations')
      .select('user_id')
      .eq('id', inv.inviter_registration_id)
      .single()).data?.user_id })
    .eq('id', newReg.id),
])
```

**`partner_registration_id` — NEVER SET on either row by this route.**  
The inviter gets `partner_user_id = invitee's user_id`.  
The invitee gets `partner_user_id = inviter's user_id` (via an extra nested query).  
Neither row ever gets `partner_registration_id` set through this flow.

**Step 3 — Mark invitation accepted** (route.ts:149–152):
```typescript
await service
  .from('tournament_team_invitations')
  .update({ status: 'accepted', invitee_user_id: user.id })
  .eq('id', inv.id)
```

---

## 3. DB State Matrix

| Step | `partner_user_id` (inviter row) | `partner_registration_id` (inviter row) |
|---|---|---|
| After `POST /register` (team type) | `null` | `null` |
| After `POST /invite-partner` (invite sent) | `null` | `null` |
| After invitee `POST /invite/[token]` (accepted) | invitee's `user_id` (set at route.ts:141) | `null` — **never set** |

The invitee's newly created row:

| Step | `partner_user_id` | `partner_registration_id` | `team_name` |
|---|---|---|---|
| After acceptance | inviter's `user_id` (route.ts:144) | `null` — never set | `null` — never copied |

---

## 4. The "Pay for Both" Backend Gate

`app/api/tournaments/[id]/checkout/route.ts`, lines 91–103:

```typescript
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

**Does it accept `partner_user_id = null`?**  
No. Line 92: `if (pay_for_partner && reg.partner_user_id)` — if `partner_user_id` is null the entire block is skipped, `partnerRegId` stays null, and a quantity-1 Stripe session is created instead.

**What does it require?**  
`reg.partner_user_id` must be non-null. `partner_user_id` is only set by the acceptance flow. An invite that has been sent but not yet accepted leaves `partner_user_id = null`, so "Pay for Both" at the backend **requires the invite to be accepted**, not merely sent.

**How the webhook uses the partner ID** (`app/api/stripe/webhook/route.ts`, lines 60–65):
```typescript
if (meta.partner_registration_id) {
  await service
    .from('tournament_registrations')
    .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId })
    .eq('id', meta.partner_registration_id)
}
```
The webhook updates the partner row by `partner_registration_id` from Stripe metadata — NOT by `partner_user_id`. The checkout route puts `partnerRegId` (looked up via `partner_user_id`) into metadata at line 180. So the round-trip is: `partner_user_id` → lookup → `partner_registration_id` in metadata → webhook update. This works, but requires the lookup to succeed.

---

## 5. Where "Pay for Both" Lives in the UI

`components/features/tournaments/DivisionsSection.tsx`, lines 888–916:

```typescript
{(!myReg.payment_status || myReg.payment_status === 'unpaid') && (() => {
  const effectiveCost = div.cost_cents != null ? div.cost_cents : tournamentCostCents
  if (effectiveCost <= 0) return null
  return (
    <div className="space-y-1.5">
      <input ... placeholder="Discount code (optional)" />
      <button
        onClick={() => handlePay(myReg.id, div.id)}
        className="... bg-indigo-600 ..."
      >
        Pay My Fee · ${(effectiveCost / 100).toFixed(2)}
      </button>
      {myReg.partner_user_id && (
        <button
          onClick={() => handlePay(myReg.id, div.id, true)}
          className="... bg-indigo-100 ..."
        >
          Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
        </button>
      )}
    </div>
  )
})()}
```

**Gate on "Pay My Fee":** `(!myReg.payment_status || myReg.payment_status === 'unpaid') && effectiveCost > 0`

**Gate on "Pay for Both":** `myReg.partner_user_id` truthy — line 906.

**What `myReg` is at render time:** The `tournament_registrations` row as returned by the page's server-side data fetch (the `initialDivisions` prop). The `partner_user_id` field is present in the select — confirmed by the register route's `.select('id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, registration_type')` (register/route.ts:121).

**What would need to change to gate on "invite sent" instead of "partner accepted":**  
Currently the UI checks `myReg.partner_user_id` (set only on acceptance). Per locked product design, the button should appear when invite is sent, not just when accepted. That requires either:  
(a) joining `tournament_team_invitations` in the divisions query to expose a `has_pending_invite` flag, or  
(b) setting a flag on `tournament_registrations` when an invite is sent (e.g., a new `invite_pending` boolean or surfacing `partner_invite_email`).  
Neither exists today.

---

## 6. Gaps

### GAP 1 — `partner_registration_id` is never set by the acceptance flow (severity: HIGH — "Pay for Both" partially broken)

`app/api/tournaments/invite/[token]/route.ts` lines 139–146 set `partner_user_id` on both rows but never touch `partner_registration_id`. The checkout route works around this by looking up the partner's registration via `partner_user_id` at runtime (checkout/route.ts:93–102), so Pay for Both does succeed today for accepted invites. But `partner_registration_id` remains null forever in the DB, which is inconsistent with the schema intent and with how the solo auto-match flow populates both fields (register/route.ts:147–155 sets both `partner_user_id` AND `partner_registration_id`).

### GAP 2 — "Pay for Both" button requires accepted invite; product design says invite-sent is sufficient (severity: MEDIUM — UX gap)

Locked product design: button appears when "an invite has been sent OR partner has accepted."  
Current gate: `myReg.partner_user_id` (DivisionsSection.tsx:906), which is only set on acceptance (route.ts:141).  
After merely sending an invite: `partner_user_id = null` → button never appears.  
The divisions query would need to surface pending invite state to implement the locked design.

### GAP 3 — Backend "Pay for Both" also requires accepted invite (severity: MEDIUM — consistent with GAP 2 but a separate layer)

checkout/route.ts:92: `if (pay_for_partner && reg.partner_user_id)` — if someone crafted a request with `pay_for_partner: true` but `partner_user_id` is null, the checkout silently degrades to a single-player charge with no error. This is safe but silent.

### GAP 4 — Invitee's registration has no `team_name` (severity: LOW — cosmetic)

`invite/[token]/route.ts:124–131` inserts the invitee's registration without a `team_name`. The invitee's row will show no team name in any UI or email that reads it. The inviter's `team_name` is not copied across.

### GAP 5 — No UI after "Pay for Both" confirms payment for the partner (severity: LOW — informational)

The webhook marks the partner's `payment_status = 'paid'` (webhook/route.ts:62–65) but sends a confirmation email only to the inviter (the registrant who paid). The partner receives no payment-confirmed email when covered by "Pay for Both." The webhook email block (lines 72–130) reads `reg.user_id` from the primary registration only.

### GAP 6 — Invite-sent state is invisible to the inviter once the modal closes (severity: MEDIUM — UX)

After `handleSendInvite` succeeds, `inviteSent = true` and the modal shows "Invite Sent!" The inviter clicks "Done" and the modal closes. The tournament division list renders with no indicator that an invite is pending — no "Awaiting partner" label, no pending invite badge. The inviter has no way to know whether their partner accepted without re-examining the page in a future session (and even then, only `partner_user_id` being set would indicate acceptance, which isn't currently displayed in the division card).

### GAP 7 — Decline action notifies nobody (severity: LOW)

`invite/[token]/route.ts:75–81` on decline: updates `tournament_team_invitations.status = 'declined'`, returns `ok`. No email sent to inviter. The inviter never learns that their invite was declined unless they check the DB directly or Joinzer builds a notification for it.

### GAP 8 — Invitee's registration uses slot capacity count (severity: LOW — correctness risk)

`invite/[token]/route.ts:98–117` recounts registered slots at acceptance time and applies `waitlist_enabled` logic. The slot count (line 100) counts ALL registrations with `status='registered'` — including the invitee's new row if they're attempting to accept into a now-full division. This could result in an invitee being waitlisted even though they were specifically invited by an already-registered player. Whether this is intentional is not documented.

---

## 7. Roderick's Specific Case

**His registration row** (queried live from `tournament_registrations`):

| Field | Value |
|---|---|
| `id` | `eafd5fd6-9b4f-4260-83f4-cc2ff9b8bfba` |
| `team_name` | `Rick & Xang!` |
| `status` | `registered` |
| `payment_status` | `unpaid` |
| `partner_user_id` | `null` |
| `partner_registration_id` | `null` |
| `registration_type` | `team` |
| `created_at` | `2026-05-19 15:52:05 UTC` |

**Did the invite fire?**

Yes. One record exists in `tournament_team_invitations`:

| Field | Value |
|---|---|
| `id` | `d87bcbbb-a05a-427f-b8cd-acf76d8fe28f` |
| `inviter_registration_id` | `eafd5fd6-9b4f-4260-83f4-cc2ff9b8bfba` |
| `invitee_email` | `precious.haganas@143@gmail.com` |
| `invitee_user_id` | `null` |
| `status` | `pending` |
| `created_at` | `2026-05-19 15:52:24 UTC` (19 seconds after registration) |

The invite route ran successfully and created the record. The invite is `pending`.

**Critical finding — malformed email address (severity: HIGH)**

The invitee email is `precious.haganas@143@gmail.com` — two `@` signs. This is not a valid RFC 5321 email address. Resend will have attempted delivery; whether it bounced or was silently dropped depends on Resend's validation behavior. The invite link almost certainly never reached the intended recipient.

The invite-partner route at line 51 does no email format validation before inserting or sending:
```typescript
const { data: inviteeProfile } = await service
  .from('profiles')
  .select('id, name')
  .ilike('email', partner_email.trim())
  .maybeSingle()
```
And at line 84:
```typescript
await resend.emails.send({ to: partner_email.trim(), ... })
```
No validation. The malformed address passed through.

**Current state:** Roderick is registered, unpaid, with `partner_user_id = null`. His invite is technically pending but likely undelivered due to the malformed address. The "Pay for Both" button is not visible to him (GAP 2 — requires accepted invite, and even if invite were pending, `partner_user_id` is null). The "Pay My Fee" button is visible and functional.

**What Roderick would need to do right now:** Re-send the invite from his tournament page with the correct email address. The invite-partner route's expire-then-insert logic (lines 41–45) will expire the bad invite and create a new one.

---

## Summary of Issues by Priority

| # | Description | Severity | Blocking |
|---|---|---|---|
| R1 | Roderick's invitee email is malformed — invite almost certainly undelivered | HIGH | His partner can't accept |
| G2 | "Pay for Both" button requires accepted invite; product design says invite-sent is sufficient | MEDIUM | Product design gap |
| G3 | Backend Pay for Both gate also requires `partner_user_id` (accepted) | MEDIUM | Consistent with G2 |
| G1 | `partner_registration_id` never set by acceptance flow | HIGH | Schema inconsistency; checkout works around it via user_id lookup but state is wrong |
| G6 | No pending-invite state visible to inviter after modal closes | MEDIUM | UX — inviter can't tell what happened |
| G5 | Partner gets no email when covered by "Pay for Both" | LOW | Email gap |
| G7 | Decline action sends no notification to inviter | LOW | Notification gap |
| G4 | Invitee's registration has no `team_name` | LOW | Cosmetic |
| G8 | Invitee could be waitlisted despite being specifically invited | LOW | Correctness edge case |
| — | No email format validation on invite-partner route | LOW | Doesn't block R1 fix (re-send), but allows recurrence |
