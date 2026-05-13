# Security Rules — Joinzer

> Evergreen. Referenced from `/CLAUDE.md` and from `~/.claude/CLAUDE.md` (global).
> Last revised: May 11, 2026.

These rules apply to every session, every file, every commit on Joinzer.

## Secrets

- Never put API keys, passwords, tokens, or secrets in code files.
- Use environment variables for all sensitive data.
- `.env` and `.env.local` must be in `.gitignore`.
- If you encounter exposed secrets, stop and flag immediately.

## Supabase keys

- `service_role` key is **server-side only**. Never expose. Never commit.
- `anon` key is fine on the frontend; rely on RLS for access control.
- All sensitive writes (state transitions, scoring, payments) go through RPC, not direct table updates.

## RLS

- Enable RLS on every table without exception.
- Public/anon access only for explicitly marked, PII-masked views.
- Test policies with the Supabase SQL editor before assuming they work.

## Player PII

- PII = full name, phone, email beyond display, payment info, exact home location.
- Player PII is **never** returned by public/anon APIs.
- Public browse pages mask PII: first names only, no contact info, no exact home location.
- Players-directory APIs honor `profiles.discoverable=false` to opt out.

## Payments (when implemented)

- Stripe secret key is server-side only.
- Stripe publishable key is fine on frontend.
- Payment state transitions go through server-side RPC + audit log.
