/**
 * Per-user daily request cap for the Places proxy (owner requirement, 2026-08-06).
 *
 * Places Autocomplete bills on a different SKU from Geocoding — the relevant published SKUs are
 * *Autocomplete Requests*, *Autocomplete Session Usage* and the *Place Details Essentials / Pro /
 * Enterprise* tiers, and which one applies is decided by the field mask. CURRENT RATES AND
 * FREE-TIER CAPS MUST BE CHECKED AGAINST GOOGLE'S PRICING PAGE; no number is quoted here, in the
 * proxy, or in the PR, because an invented one would be worse than none.
 *
 * Session tokens already collapse a keystroke burst into one billable session. This cap is the
 * second line: it bounds what a single authenticated account can spend in a day even if the client
 * misbehaves or someone scripts the endpoint.
 *
 * IN-MEMORY, AND THAT IS A DELIBERATE LIMITATION. Vercel runs several serverless instances, so
 * each holds its own counter and the true ceiling is (cap × instances) rather than (cap). It still
 * turns "unbounded" into "bounded by a small multiple", with zero new dependencies (ADR-02) and no
 * schema change. A hard global cap needs shared state — Postgres or a KV store — and that is a
 * deliberate decision with its own cost, not something to slip into this slice. If the meter ever
 * looks wrong, this is the first thing to make durable.
 */

/** Requests per user per UTC day, across autocomplete + details combined. Generous for a human
 *  filling in one venue (a debounced session is a handful of calls), restrictive for a script. */
export const DAILY_REQUEST_CAP = 150

type Bucket = { day: string; count: number }

const buckets = new Map<string, Bucket>()

/** UTC day key. Deliberately not Pacific: this is a spend guard, not a user-facing date, and
 *  lib/utils/pacific-day.ts exists for things the user reads. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Record one request for this user and report whether it is allowed.
 *
 * Counts the request even when it is refused, so a client hammering the endpoint after the cap
 * cannot reset itself by waiting inside the same day.
 */
export function consumeQuota(
  userId: string,
  now: Date = new Date()
): { allowed: boolean; remaining: number } {
  const day = today(now)
  const existing = buckets.get(userId)
  const bucket = existing && existing.day === day ? existing : { day, count: 0 }

  bucket.count += 1
  buckets.set(userId, bucket)

  // Opportunistic sweep: drop other users' stale days so the map cannot grow without bound on a
  // long-lived instance. Cheap because it only runs on the first request of a new day.
  if (!existing || existing.day !== day) {
    for (const [key, value] of buckets) if (value.day !== day) buckets.delete(key)
  }

  const allowed = bucket.count <= DAILY_REQUEST_CAP
  return { allowed, remaining: Math.max(0, DAILY_REQUEST_CAP - bucket.count) }
}

/** Test seam — resets the module's state between cases. Not used by application code. */
export function __resetQuota(): void {
  buckets.clear()
}
