import { createHmac, timingSafeEqual } from 'crypto'
// Relative, not the `@/` alias: vitest has no path-alias config, so a runtime `@/` import
// here would make this module untestable. Next resolves both forms identically.
import { getSiteUrl } from '../utils/site-url'

// Signed unsubscribe links. Two defects this closes:
//   1. The old link was keyed on the bare profile UUID, so anyone holding or guessing a
//      profile id could opt that user out. The signature makes the id unforgeable.
//   2. The old route mutated on GET, so an email link prefetcher (Gmail, Outlook Safe
//      Links) could silently opt someone out. The token only gets a user to a confirm
//      page — the mutation lives behind a POST, which prefetchers never issue.
//
// The token is the authorization for the write (ADR-03: the route is the security
// boundary, and this is a server-derived claim, never a client-supplied user id).

const TOKEN_VERSION = 'v1'
const TTL_DAYS = 365

// Long-lived on purpose: an unsubscribe link sits in an inbox for as long as the email
// does, and a dead link is a worse outcome than a stale one. The bound exists so a
// leaked link doesn't stay valid forever.
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60

// One-shot latch for the missing-secret log below. `verifyUnsubscribeToken` runs on an
// anonymous, attacker-reachable route, and the log is five lines, so an unauthenticated
// prober could otherwise mint ~250 lines per 50 requests and bury everything else.
let missingSecretLogged = false

function readSecret(): string | null {
  const secret = process.env.UNSUBSCRIBE_SECRET || null
  // Observing the secret present re-arms the latch, so "log once" means once per outage
  // rather than once per process. A later outage is loud again.
  if (secret) missingSecretLogged = false
  return secret
}

// Deliberately shouty, matching scripts/lib/revalidate-directory.mjs's `!!!` convention for
// the same class of failure. A missing secret is not a runtime hiccup — it silently kills
// every unsubscribe link in every inbox, and under ADR-10 this code reaches production with
// no further human gate. A one-line console.error was indistinguishable from routine noise.
//
// Logged once per outage: the message describes a constant, not an event, so repeating it
// adds no information. Loud once beats loud 250 times, which reads as noise and gets muted.
function logMissingSecret(context: string): void {
  if (missingSecretLogged) return
  missingSecretLogged = true
  console.error(
    `\n!!! UNSUBSCRIBE_SECRET is not set — ${context} cannot function.` +
      `\n!!! Every unsubscribe link is dead in this environment until it is set.` +
      `\n!!! Generate one with:  openssl rand -base64 32` +
      `\n!!! Then set it in Vercel (Production + Preview, Sensitive) and in .env.local.\n`
  )
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload: string, key: string): string {
  return base64url(createHmac('sha256', key).update(`${TOKEN_VERSION}.${payload}`).digest())
}

export function signUnsubscribeToken(userId: string, nowMs: number = Date.now()): string {
  const key = readSecret()
  // Throws rather than returning something unsigned: a caller must never be able to mint a
  // token-shaped string that isn't actually authenticated.
  if (!key) throw new Error('UNSUBSCRIBE_SECRET is not set')
  const exp = Math.floor(nowMs / 1000) + TTL_SECONDS
  const payload = `${userId}.${exp}`
  return `${payload}.${sign(payload, key)}`
}

export type UnsubscribeTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'malformed' | 'invalid' | 'expired' | 'misconfigured' }

export function verifyUnsubscribeToken(
  token: string | null | undefined,
  nowMs: number = Date.now()
): UnsubscribeTokenResult {
  if (!token) return { ok: false, reason: 'malformed' }

  // Fails CLOSED — an absent secret can never verify anything — but reports the reason so
  // the caller can render a page instead of throwing a 500 at the recipient. The asymmetry
  // this replaces was: senders degraded gracefully while token holders got a stack trace.
  const key = readSecret()
  if (!key) {
    logMissingSecret('verifyUnsubscribeToken')
    return { ok: false, reason: 'misconfigured' }
  }

  // A profile id is a UUID and the expiry is digits, so neither can contain a separator.
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }

  const [userId, expStr, providedSignature] = parts
  if (!userId || !/^\d+$/.test(expStr)) return { ok: false, reason: 'malformed' }

  // Signature before expiry, deliberately: an unsigned token must never be able to learn
  // whether the id or the expiry it guessed was otherwise well-formed.
  const expected = sign(`${userId}.${expStr}`, key)
  const provided = Buffer.from(providedSignature)
  const expectedBuf = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so the length check has to come first.
  if (provided.length !== expectedBuf.length) return { ok: false, reason: 'invalid' }
  if (!timingSafeEqual(provided, expectedBuf)) return { ok: false, reason: 'invalid' }

  if (Number(expStr) * 1000 <= nowMs) return { ok: false, reason: 'expired' }

  return { ok: true, userId }
}

export function buildUnsubscribeUrl(userId: string): string {
  try {
    const token = signUnsubscribeToken(userId)
    return `${getSiteUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}`
  } catch {
    // A missing secret must never block a send. Fall back to the in-app preference so the
    // recipient still has a working way to opt out.
    logMissingSecret('buildUnsubscribeUrl')
    return `${getSiteUrl()}/profile/edit`
  }
}
