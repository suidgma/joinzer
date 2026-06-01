# Partner Invite Flow — Config & Resilience

> Runbook for the league doubles **partner invitation** flow. The flow depends on
> external Supabase Auth config that lives outside the repo. When that config
> drifts, the flow breaks *silently* — the invitee lands on `/home` with no error.
> This doc exists so that failure has a written cause and fix.
> Last revised: June 1, 2026.

---

## Required Supabase config (the silent-break cause)

The invite email contains a Supabase **magic link**. After the invitee
authenticates, Supabase redirects to a `redirectTo` URL that carries a `next`
query param pointing at the accept page:

```
https://joinzer.com/auth/callback?next=%2Fleagues%2F<id>%2Fpartner-accept%3Ftoken%3D<token>
```

Supabase only honors a `redirectTo` if it matches the project's **Redirect URLs
allowlist**. If the allowlist does not cover this URL *including its query
string*, Supabase silently falls back to the **Site URL** and **drops `next`** —
so the invitee is authenticated but dumped on `/home`, never reaching the accept
page.

**Set these in Supabase → Authentication → URL Configuration:**

| Setting | Value |
|---|---|
| **Site URL** | `https://joinzer.com` |
| **Redirect URLs** | `https://joinzer.com/**` (wildcard — covers `/auth/callback` + any `next`) |

For local/preview testing also add the relevant origin, e.g.
`http://localhost:3000/**` and the Vercel preview domain `https://*.vercel.app/**`.

> The `/**` wildcard is what lets the query string (`?next=...`) survive. A bare
> `https://joinzer.com/auth/callback` entry will **not** match the URL once the
> `next` param is appended, and the flow breaks.

---

## Why the flow still works even if the allowlist drifts

The magic link is the *preferred* path, not the *only* path. Three independent
delivery mechanisms each give the invitee a way to reach the accept page, so a
single broken link does not strand them:

1. **Magic-link email** → `/auth/callback?next=<accept>` → accept page.
   (Fastest. Depends on the allowlist config above.)
2. **In-app notification** — created unconditionally in `createInviteAndNotify`
   (independent of `NODE_ENV` and of email delivery). The bell links straight to
   `/leagues/<id>/partner-accept?token=<token>`. This is the resilient path: even
   if the magic link drops `next` and dumps the invitee on `/home`, the bell is
   right there.
3. **League page `pendingInvite` card** — when the invitee opens the league page,
   an amber "You have a partner invitation" card with an **Accept** button
   renders (computed in `leagues/[id]/page.tsx`, surfaced in `LeagueActions`).

If you change the flow, **preserve all three.** They are not redundant by
accident — each covers a different way the others can fail.

---

## `next` must survive every auth method

The accept page lives under the authenticated `(app)` group. An unauthenticated
visit bounces through middleware → `/login?next=<accept>`. For the invite to
survive, **every** sign-in path must carry `next` forward:

- **Email/password sign-in** → `router.push(nextPath)` ✅
- **Email/password signup** → `/profile/setup?next=<nextPath>` ✅
- **Google OAuth** → `redirectTo: /auth/callback?next=<nextPath>` ✅
- **Magic link** → `redirectTo` carries `next` (allowlist-dependent, see above)
- **Stub → profile setup** → `(app)/layout.tsx` preserves `path + search` into
  `?next=` so a stub invitee isn't stripped of their destination at the setup gate

A regression in any one of these silently drops invitees on `/home`. When adding
a new auth method, thread `next` through it.

---

## Quick triage when "partner can't accept"

1. **Does the invitee see the bell notification / the league-page amber card?**
   If yes, the fallbacks are healthy — the issue is just the magic link. Check
   the Supabase allowlist (top of this doc).
2. **Did the email arrive?** `createInviteAndNotify` skips sending unless
   `NODE_ENV === 'production'` (it logs `[partner-invite] skipped …` otherwise).
3. **`generateLink` failure?** Logged as `[partner-invite] generateLink failed …`;
   the email then falls back to the accept-page URL (not the magic link).
4. **Invitee bounced to `/home` after clicking the link?** Allowlist is dropping
   `next`. Fix the allowlist; the in-app notification unblocks them meanwhile.
5. **"This invitation is not for your account" (403)?** The invitee signed in with
   a different email than the one invited. The invite is bound to `invitee_user_id`.
