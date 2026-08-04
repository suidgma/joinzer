/**
 * Independent venue geocoding via Nominatim / OpenStreetMap, with precision classification and an
 * on-disk cache.
 *
 * WHY THIS EXISTS: the venue-research workbooks either carry no coordinates at all (Toledo) or carry
 * structurally corrupted ones (Little Rock — every column from `phone` rightward shifted one place
 * right from ~row 8, so the latitude column holds a phone number and the longitude fell out of the
 * row entirely into another tab). Even once realigned, the Little Rock workbook disagreed with an
 * independent geocode by >1 km on 9 of 19 rows, up to 5.35 km. **A workbook coordinate is therefore
 * never a source.** It is recorded only as provenance.coordinate.workbook_crosscheck with a
 * recomputed delta, and the value written to the database always comes from here.
 *
 * ADR-12: no Places- or Google-derived coordinate may be persisted. This module only ever talks to
 * nominatim.openstreetmap.org, and every result it returns carries origin='nominatim' so the
 * importer's preflight can assert on it.
 *
 * ODbL: results are OSM-derived. Every row built from one carries the ODbL marker in provenance;
 * attribution renders via components/features/directory/OsmAttribution.tsx.
 *
 * USAGE POLICY (nominatim.openstreetmap.org is free and unmetered but rate-limited by courtesy):
 *   - one request at a time, >= 1.1 s apart, enforced here and not overridable
 *   - a descriptive User-Agent identifying the application and a contact URL
 *   - results cached to disk, so a re-run of an already-geocoded metro issues ZERO requests.
 *     ~600 venues across 29 metros is ~11 minutes of wall clock ONCE, then free forever.
 *
 * THE RATE LIMIT IS ON THE ENDPOINT, NOT ON THIS PROCESS. The 1.1 s spacing above is enforced per
 * process, so two sessions geocoding at once are two clients against one courtesy budget and both
 * can be told to back off. That is why this module retries 429/503 rather than treating a non-200 as
 * terminal: before 2026-08-04 any transient rate-limit killed a whole metro's extract mid-run.
 *
 * PER-METRO CACHE (2026-08-04). Each metro writes its OWN cache file, `<cache-dir>/<metro>.json`,
 * because a single shared file made two concurrent extracts a lost-update race — last writer wins
 * and silently discards the other's entries. Files that predate the split are consulted READ-ONLY as
 * seeds (see loadSeeds), so nothing accumulated before it is lost or re-fetched.
 *
 * DURABILITY (2026-08-04). Everything a run buys from Nominatim reaches disk as it is bought, not at
 * the end. The callers in workbook-extract.mjs flush once per geocode pass, OUTSIDE the loop, so a
 * throw at venue 24 of 26 discarded all 24 venues' results — each of which may have spent several
 * live requests walking the query ladder at >=1.1 s apiece. Retrying transient rate limits (above)
 * made that the dominant loss path rather than a rare one, because giving up after 5 attempts is a
 * NEW way for the loop to die. Three properties close it, and all three live here so that all three
 * of those passes get them without a single edit at the call sites:
 *
 *   1. auto-flush after every LIVE request (see nominatim)
 *   2. atomic writes, so multiplying the write count ~60x cannot leave a truncated cache
 *   3. a flush failure is reported, never thrown — it must not abort a run that otherwise succeeded
 *
 * PRECISION LADDER (matches the ladder the Little Rock / Greensboro batches established):
 *   high   - exact house-number match, or a named leisure/amenity/building feature that is the venue
 *   medium - correct site, but the anchor is a containing or neighbouring feature, or a large
 *            polygon centroid (a park containing the courts, a campus, a golf clubhouse) — and it
 *            carries NO name of its own, or a name we can tie to the venue's
 *   low    - street band or city/postcode centroid only, OR an anchor that NAMES A DIFFERENT ENTITY
 *            than the venue (owner ruling 2026-07-31 — see classifyPrecision)
 * The publish gate blocks `low`. Never fake a precision to clear the gate; a low-precision row is
 * supposed to sit in the work queue until someone pins the courts.
 *
 * Standalone smoke test:
 *   node scripts/lib/geocode-nominatim.mjs --name="Kanis Park" --address="820 S Rodney Parham Rd" \
 *     --city="Little Rock" --state=AR --zip=72205
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Joinzer-directory-import/1.0 (https://www.joinzer.com; pickleball court directory research)'
const MIN_SPACING_MS = 1100

/**
 * Where a cache goes when a config does not say. `scripts/metros/little-rock.json` is the one config
 * that omits `geocode_cache`, and the per-metro split made that omission permanent rather than
 * incidental — every future config copied from it inherits the fallback.
 *
 * IT POINTS INSIDE `metro-research/` ON PURPOSE. The old default put the cache at `.geocode-cache/`
 * in the REPO ROOT, which is not in `.gitignore` (only `/metro-research/` is). Untracked and
 * unignored is the worst of both: a plain `git clean -fd` reaches it — not just `-fdx` — and
 * `git add -A` would stage it. `metro-research/` is a junction to a repo outside every working tree,
 * which is the only thing on this machine a `git clean` provably cannot follow (re-verified
 * 2026-08-04: `git clean -ndx` in the main checkout does not list it at all).
 *
 * NOTE THE BASENAME IS NOT `nominatim.json`. The standalone smoke test at the bottom of this file
 * defaults to this constant, so naming it `nominatim.json` would make a smoke test REWRITE the
 * 551-entry legacy seed — a file the per-metro split declares read-only. `_default.json` also fails
 * LEGACY_CACHE_NAME, so it is never picked up as a seed by anything either. A leading underscore is
 * already legal in a cache basename (see geocodeCachePath and the `_vt_pme` regression).
 *
 * ADDING `.geocode-cache/` TO `.gitignore` IS NOT AN ALTERNATIVE TO THIS. `git clean -fdx` removes
 * ignored files too — that is precisely what destroyed the cache on 2026-08-03. The entry is there
 * as well, but it buys protection from `-fd` and from `git add -A`, not from `-fdx`.
 */
const DEFAULT_CACHE = 'metro-research/.geocode-cache/_default.json'

/** Files in the cache directory that are LEGACY SHARED caches rather than a metro's own file.
 *
 *  Discovered by pattern, deliberately, instead of being a hardcoded list. There were two such files
 *  when this slice was planned and THREE by the time it was written (`nominatim.json`,
 *  `nominatim-wave1.json`, `nominatim-batch3.json` — 551 + 316 + 146 entries, pairwise overlap
 *  ZERO), because sessions were already splitting the shared file by hand to dodge the very race
 *  this slice fixes. A hardcoded pair would have gone stale within the hour and orphaned 146 entries.
 *
 *  A metro's own cache is `<metro>.json`, which cannot match this pattern unless a metro is literally
 *  named `nominatim*` — so the two namespaces never collide. `county-bbox-*.json` (a different cache,
 *  keyed by county name rather than by query params) is excluded for the same reason. */
const LEGACY_CACHE_NAME = /^nominatim.*\.json$/i

// ---------------------------------------------------------------------------------------------
// Disk cache — keyed by the exact query, so a changed query is a cache miss rather than a stale hit.
//
// ONE FILE PER METRO. `cachePath` is the metro's own file and the ONLY file this module ever writes.
// Legacy shared files are read-only seeds: consulted on a miss, never opened for writing, so the
// migration off the shared file cannot lose an entry and needs no copy step to get wrong.
// ---------------------------------------------------------------------------------------------
let cachePath = DEFAULT_CACHE
let cache = null
let cacheDirty = false
let seedCache = null
let seedPaths = []

/**
 * The cache file a given metro writes: `<dir of the configured path>/<metro>.json`.
 *
 * Derived from the metro KEY rather than read from the config, so a config copy-pasted from another
 * metro cannot silently share a cache file — the key is the config's own filename and is unique by
 * construction. Every metro config keeps its existing `geocode_cache` value untouched; only the
 * basename changes, so the directory (and its gitignore posture) is unchanged.
 *
 * (This said "the 42 metro configs" until 2026-08-04. Don't reintroduce a count here: the corpus is
 * 33 on `main` and 43 on the unmerged `chore/courts-publish-pipeline`, so any number written down is
 * wrong on one of the two trees and goes stale again the moment that branch merges.)
 *
 * The fallback when `configuredPath` is absent is DEFAULT_CACHE's directory, which now sits inside
 * `metro-research/` — see that constant for why. Only the directory is taken from it, so the
 * `_default.json` basename never applies to a metro.
 */
export function geocodeCachePath(metroKey, configuredPath = DEFAULT_CACHE) {
  const key = String(metroKey ?? '').trim()
  // A path separator or `..` here would write outside the cache directory; a blank key would collide
  // with every other blank-keyed caller. Refuse rather than derive something surprising.
  //
  // A LEADING UNDERSCORE IS LEGAL: `scripts/metros/_vt_pme.json` is a real config in the repo, and
  // requiring an alphanumeric first character killed `--metro=_vt_pme` at CLI start. A leading DOT
  // still fails (it is how `.hidden` and `..` begin), so the traversal protection is untouched.
  if (!/^[a-z0-9_][a-z0-9._-]*$/i.test(key) || key.includes('..')) {
    throw new Error(`geocodeCachePath: refusing to derive a cache path from metro key ${JSON.stringify(metroKey)} — expected a config-filename-shaped key such as "toledo"`)
  }
  return join(dirname(configuredPath || DEFAULT_CACHE), `${key}.json`)
}

/** Every legacy shared cache in `cacheDir`, excluding `activePath`, sorted so seed precedence is
 *  deterministic across runs and platforms. An unreadable directory yields no seeds, never a throw. */
export function legacyCachePaths(cacheDir, activePath = null) {
  let names
  try {
    names = readdirSync(cacheDir)
  } catch {
    return []
  }
  const active = activePath ? resolve(activePath) : null
  return names
    .filter((n) => LEGACY_CACHE_NAME.test(n))
    .map((n) => join(cacheDir, n))
    .filter((p) => !active || resolve(p) !== active)
    .sort()
}

/**
 * Merge every legacy shared cache into one read-only lookup.
 *
 * NOTHING HERE EVER WRITES A LEGACY FILE. That is the whole safety argument for the migration: the
 * accumulated entries are preserved by being read, not by being copied, so there is no move, no
 * partition heuristic and no step that could drop an entry it failed to classify.
 *
 * A parse failure on one seed is skipped rather than fatal. That is load-bearing, not defensive
 * padding: a legacy file may be MID-WRITE by another session (writeFileSync is not atomic), and a
 * truncated read must degrade to a cache miss — a live request — rather than killing the run.
 */
function loadSeeds() {
  seedPaths = legacyCachePaths(dirname(cachePath), cachePath)
  seedCache = {}
  for (const path of seedPaths) {
    let entries
    try {
      entries = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    // First file wins a key collision. Measured 2026-08-04: the three live legacy files share ZERO
    // keys, so this tiebreak has never had to fire — it exists so the merge order is defined.
    for (const [k, v] of Object.entries(entries)) if (!(k in seedCache)) seedCache[k] = v
  }
}

function loadCache(path = cachePath) {
  const next = path || DEFAULT_CACHE
  if (cache && resolve(next) === resolve(cachePath)) return cache
  // A path SWITCH inside one process must not write the outgoing cache to the incoming path. The
  // previous implementation repointed `cachePath` while keeping the already-loaded `cache`, so a
  // second metro in the same process would have flushed the FIRST metro's entries into the second
  // metro's file. Inert while every caller passed one path; a live bug the moment they differ.
  //
  // AND IT MUST NOT REPOINT WHEN THAT FLUSH FAILED. Repointing replaces `cache` and resets
  // `cacheDirty`, so the outgoing metro's unwritten entries become unrecoverable — even once the
  // write error clears, because the retry would then be writing the INCOMING metro's file. This is
  // the one place the old throw was load-bearing as a guard, and making flushCache non-fatal removed
  // it; found in review, so it never shipped.
  //
  // Note the asymmetry with the rest of this module, which is deliberate. A same-path flush failure
  // is non-fatal because nothing is lost: the entries sit in memory, the path is unchanged, and the
  // next live request retries the write. Here the entries CANNOT stay, so the only two options are
  // "abort" and "silently discard results that were paid for at >=1.1 s each". Aborting a metro
  // switch costs a re-run; the alternative costs data that cannot be recovered at any price.
  //
  // Latent today — workbook-extract.mjs computes one cachePath per run and never repoints — which is
  // exactly why it needs the guard rather than a comment.
  if (cache && !flushCache()) {
    throw new Error(
      `refusing to switch the geocode cache from ${JSON.stringify(cachePath)} to ${JSON.stringify(next)}: ` +
      `the outgoing cache could not be written (see the ACTION REQUIRED block above) and repointing ` +
      `would discard its unwritten entries permanently. Fix the write error, then re-run.`,
    )
  }
  cachePath = next
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    cache = {}
  }
  cacheDirty = false
  loadSeeds()
  return cache
}

/**
 * Write the cache ATOMICALLY: a sibling temp file, then a rename over the target.
 *
 * `writeFileSync` truncates before it writes, so a process killed mid-write leaves a TRUNCATED file.
 * `loadCache` treats an unparseable cache as `{}` and the next flush then overwrites it, so a torn
 * write is silent total loss of that metro's cache. That window existed before this slice at 3 writes
 * per run; auto-flushing takes it to ~180, which is reason enough to close it rather than widen it
 * 60-fold. A rename cannot half-happen, so a kill at any instant leaves either the previous complete
 * file or the new complete one.
 *
 * The temp name carries the pid so two processes cannot collide on it, and it is a SIBLING of the
 * target because a rename is only atomic within one volume.
 */
function writeCacheFile(path, data) {
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (err) {
    // Never leave the scratch file behind to be mistaken for a cache (it would not match
    // LEGACY_CACHE_NAME, but it would still be confusing litter in a directory people read).
    try { rmSync(tmp, { force: true }) } catch { /* the original error is the one that matters */ }
    throw err
  }
}

/**
 * Ensure the cache directory exists, creating AT MOST its final segment.
 *
 * `mkdirSync(recursive: true)` would happily materialize the whole chain — including a real
 * `metro-research/` directory INSIDE the working tree when the junction is missing (a worktree that
 * was never bootstrapped, or one where a `git clean` removed the link). That is the exact shape of
 * the 2026-08-03 loss: research data sitting at a gitignored path inside a tree a `git clean -fdx`
 * can reach. A cache that silently writes itself somewhere destructible is worse than one that
 * refuses to write, because the refusal is visible and costs only a re-run.
 */
function ensureCacheDir(dir) {
  const parent = dirname(dir)
  if (parent && parent !== dir && !existsSync(parent)) {
    throw new Error(
      `refusing to create ${JSON.stringify(dir)} because its parent ${JSON.stringify(parent)} does not exist. ` +
      `Creating it would put research data inside the working tree, where a "git clean -fdx" can reach it. ` +
      `If this is an un-bootstrapped worktree, link the shared research repo first:\n` +
      `    cmd /c mklink /J metro-research ..\\joinzer-metro-research`,
    )
  }
  mkdirSync(dir, { recursive: true })
}

/**
 * Persist the cache. Returns true when it is safe on disk, false when it is not.
 *
 * THIS DOES NOT THROW, BY DESIGN. It is called from inside three geocode loops in
 * workbook-extract.mjs and now after every live request, and a failed write must not destroy a run
 * that has otherwise succeeded — the whole point of this slice is that a run keeps what it bought.
 * A failure prints the house ACTION REQUIRED block, the same posture as revalidate-directory.mjs and
 * backup-metro-research.mjs, and the next flush retries: because the cache stays dirty, a transient
 * EPERM (an antivirus scanner or an editor holding the file open, which Windows does produce on
 * rename) self-heals on the following request rather than needing a re-run.
 */
/** Cache paths currently in a failed-write episode, so the ACTION REQUIRED block is printed ONCE per
 *  episode rather than once per failure. Auto-flushing means a metro geocoding against (say) a
 *  missing junction fails on every live request: ~180 failures, and at 7 lines each that is ~1,260
 *  lines burying the very summary the block exists to surface. Cleared on a successful write, so a
 *  path that recovers and later fails again reports in full a second time — the episode is the unit
 *  worth shouting about, not the process lifetime. */
const flushFailuresReported = new Set()

export function flushCache() {
  if (!cacheDirty || !cache) return true
  try {
    ensureCacheDir(dirname(cachePath))
    writeCacheFile(cachePath, JSON.stringify(cache, null, 1))
    cacheDirty = false
    flushFailuresReported.delete(cachePath)
    return true
  } catch (err) {
    const entries = Object.keys(cache).length
    const detail = (err && err.message) || String(err)
    if (flushFailuresReported.has(cachePath)) {
      console.log(`  geocode cache STILL unwritable (${entries} result(s) held in memory only): ${detail}`)
      return false
    }
    flushFailuresReported.add(cachePath)
    console.log('\n' + '='.repeat(78))
    console.log('ACTION REQUIRED — the geocode cache could NOT be written.')
    console.log(`  path : ${cachePath}`)
    console.log(`  error: ${detail}`)
    console.log(`  ${entries} cached result(s) are held in memory only. The run continues, and each`)
    console.log('  further live request retries the write — but if this keeps failing, everything')
    console.log('  this run spent against Nominatim is lost when the process exits.')
    console.log('  Further failures on this path print one line each until it succeeds.')
    console.log('='.repeat(78))
    return false
  }
}

export function cacheStats() {
  const c = loadCache()
  return {
    path: cachePath,
    entries: Object.keys(c).length,
    seeds: seedPaths.length,
    seed_entries: seedCache ? Object.keys(seedCache).length : 0,
  }
}

// ---------------------------------------------------------------------------------------------
// Retry policy — TRANSIENT rate-limit responses only
// ---------------------------------------------------------------------------------------------
/**
 * 429 and 503, and nothing else.
 *
 * 429 is Nominatim's documented rate-limit response; the OSM operations tier returns 503 when it is
 * shedding load. Both mean "come back later" BY DEFINITION, which is what makes retrying them safe.
 *
 * 502 and 504 are deliberately EXCLUDED (owner ruling 2026-08-04): neither has ever been observed
 * against this endpoint, and widening the retry set without evidence trades a clear terminal error
 * for five slow ones. Add them if one is ever actually seen.
 *
 * 400/404/500 keep the original behaviour exactly — thrown on the first response, with the original
 * message shape. A genuine error must never be laundered into a retry, and in particular a 200
 * carrying `[]` is still a real "no such place" that gets cached (the Greensboro lesson below).
 */
const RETRY_STATUSES = new Set([429, 503])
/** 4 retries = 5 attempts, then a hard failure — so a persistently rate-limited run TERMINATES with a
 *  clear error instead of hanging.
 *
 *  The worst-case added wait per query depends on whether the server sends a Retry-After:
 *    - without one: the exponential ladder, 2+4+8+16 = 30 s
 *    - with one:    RETRY_AFTER_CAP_MS applies PER RETRY, not to the total, so a server asking for
 *                   an absurd delay costs 4 x 60 s = 240 s before the run gives up.
 *  Both terminate; only the second is slow. Bounding the total instead of the per-retry wait would
 *  mean ignoring a Retry-After we told the server we would honour. */
const MAX_RETRIES = 4
const BACKOFF_BASE_MS = 2000
const BACKOFF_CAP_MS = 30_000
/** A server (or a proxy in front of one) can name any Retry-After it likes. Honour it, but never let
 *  it park the run for an unbounded time — past this we fall back to our own bounded ladder. */
const RETRY_AFTER_CAP_MS = 60_000

const clampRetryAfter = (ms) => Math.max(0, Math.min(ms, RETRY_AFTER_CAP_MS))

/**
 * Parse a `Retry-After` header into milliseconds, or null when it carries nothing usable.
 * Both RFC forms are accepted: delta-seconds (`120`) and an HTTP-date (`Wed, 21 Oct 2026 07:28:00 GMT`).
 * A date already in the past clamps to 0 rather than going negative.
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return clampRetryAfter(Number(raw) * 1000)
  // A SIGNED value is neither RFC form: delta-seconds permits no sign, and no HTTP-date begins with
  // one. Reject before the date branch — V8 reads `-1000` / `-2026` as a PAST YEAR, which clamps to
  // a 0 ms delay and silently disables the backoff for that request. (`-5` was caught by the shape
  // guard below; `-1000` slipped past it because it contains four digits. Same hole, one digit wider.)
  if (/^[+-]/.test(raw)) return null
  // `Date.parse` is far too permissive to use as a validity test on its own. Require something
  // actually date-shaped: a month name (all three RFC 7231 date forms carry one) or a 4-digit year.
  // Anything else falls through to our own bounded ladder, which is the safe direction.
  if (!/[A-Za-z]{3}/.test(raw) && !/\d{4}/.test(raw)) return null
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return clampRetryAfter(at - nowMs)
}

/**
 * How long to wait before re-attempting, or **null meaning DO NOT RETRY** — either because the status
 * is not transient or because the retry budget is spent. `attempt` is 1-based and counts the attempt
 * that just failed.
 *
 * Jitter is ±25%. With one process it buys little; with two sessions backing off against the same
 * endpoint at the same moment — the exact scenario this exists for — it de-synchronizes them.
 */
export function retryDelayMs({
  status,
  retryAfterHeader = null,
  attempt,
  maxRetries = MAX_RETRIES,
  nowMs = Date.now(),
  random = Math.random,
} = {}) {
  if (!RETRY_STATUSES.has(status)) return null
  if (!(attempt >= 1) || attempt > maxRetries) return null
  const fromHeader = parseRetryAfter(retryAfterHeader, nowMs)
  if (fromHeader != null) return fromHeader
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)
  return Math.round(base * (0.75 + random() * 0.5))
}

/**
 * Fetch with bounded exponential backoff on transient rate-limit responses.
 *
 * `beforeAttempt` runs before EVERY attempt including retries — that is what keeps the >=1.1 s
 * endpoint spacing and the live-request counter honest when a retry fires, since a retry is another
 * real request against the same courtesy budget.
 *
 * Injectable `fetchImpl` / `sleepImpl` / `random` exist so the whole ladder is unit-testable with no
 * network and no wall-clock wait.
 */
export async function fetchWithRetry(url, {
  headers = {},
  label = null,
  fetchImpl = fetch,
  sleepImpl = sleep,
  beforeAttempt = null,
  onRetry = null,
  maxRetries = MAX_RETRIES,
  nowFn = Date.now,
  random = Math.random,
} = {}) {
  const describe = label ?? String(url)
  let waitedMs = 0
  for (let attempt = 1; ; attempt++) {
    if (beforeAttempt) await beforeAttempt(attempt)
    const res = await fetchImpl(url, { headers })
    if (res.ok) return res

    const delay = retryDelayMs({
      status: res.status,
      retryAfterHeader: res.headers?.get ? res.headers.get('retry-after') : null,
      attempt,
      maxRetries,
      nowMs: nowFn(),
      random,
    })

    if (delay == null) {
      // Retryable but out of budget gets a DIFFERENT message from a genuine error, so a run log can
      // never confuse "the endpoint kept refusing us" with "this query is malformed".
      if (RETRY_STATUSES.has(res.status)) {
        throw new Error(
          `nominatim HTTP ${res.status} ${res.statusText} for ${describe} — gave up after ${attempt} attempt(s) and ${(waitedMs / 1000).toFixed(1)}s of backoff`,
        )
      }
      // A non-200 is NOT the same as "no such place" — surface it instead of caching an empty
      // result and silently marking the venue ungeocodable (the Greensboro lesson: 8 straight empty
      // responses there were genuine 200-with-[], and assuming rate-limiting would have been wrong).
      throw new Error(`nominatim HTTP ${res.status} ${res.statusText} for ${describe}`)
    }

    // Drain the discarded body so the socket is released before we sleep on it.
    if (typeof res.text === 'function') await res.text().catch(() => {})
    waitedMs += delay
    if (onRetry) onRetry({ attempt, status: res.status, delayMs: delay, totalWaitedMs: waitedMs, label: describe })
    await sleepImpl(delay)
  }
}

// ---------------------------------------------------------------------------------------------
// Rate-limited fetch. Serialized through a single promise chain so concurrent callers still queue.
// ---------------------------------------------------------------------------------------------
let chain = Promise.resolve()
let lastRequestAt = 0
let liveRequests = 0

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * `fetchImpl` is a TEST SEAM, defaulting to the real `fetch`. `fetchWithRetry` already took one for
 * exactly this reason; threading it one level up is what makes the durability property above
 * testable, because that property is only observable on a LIVE request and the existing cache tests
 * are deliberately network-free. Nothing else passes it.
 *
 * NOTE THAT THE >=1.1 s SPACING IS NOT INJECTABLE and is not made so here. A test-only bypass of a
 * courtesy limit on someone else's endpoint is the kind of seam that later leaks into a real run;
 * the tests pay the real wait instead.
 */
async function nominatim(params, { fetchImpl = fetch } = {}) {
  const key = JSON.stringify(params)
  const c = loadCache()
  if (Object.prototype.hasOwnProperty.call(c, key)) return { results: c[key], cached: true }

  // Legacy shared caches are consulted READ-ONLY on a miss, and a hit is PROMOTED into this metro's
  // own cache so the per-metro file becomes self-sufficient over time and the shared files go
  // vestigial — without a single write ever landing on one. Counts as `cached`, because it is: it
  // cost no live request.
  //
  // DELIBERATELY NOT AUTO-FLUSHED. A promotion costs nothing to redo, because the seed it came from
  // is still sitting on disk unchanged, so losing one to a crash loses nothing. Flushing here would
  // mean a fully-seeded re-run — which spends ZERO live requests — paid for hundreds of writes it
  // gains nothing from (measured: ~0.9 s across a 420-entry metro). The end-of-pass flushes in
  // workbook-extract.mjs still persist promotions on a clean run, so the file does become
  // self-sufficient; it just does not buy that with durability it does not need.
  if (seedCache && Object.prototype.hasOwnProperty.call(seedCache, key)) {
    c[key] = seedCache[key]
    cacheDirty = true
    return { results: c[key], cached: true }
  }

  const run = async () => {
    const url = new URL(ENDPOINT)
    for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: '1', namedetails: '1', limit: '5', ...params })) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
    const res = await fetchWithRetry(url, {
      fetchImpl,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      label: String(url.searchParams),
      beforeAttempt: async () => {
        const wait = MIN_SPACING_MS - (Date.now() - lastRequestAt)
        if (wait > 0) await sleep(wait)
        lastRequestAt = Date.now()
        liveRequests++
      },
      onRetry: ({ attempt, status, delayMs, totalWaitedMs }) => {
        console.warn(`    nominatim HTTP ${status} (attempt ${attempt}) — backing off ${(delayMs / 1000).toFixed(1)}s (${(totalWaitedMs / 1000).toFixed(1)}s total) for ${url.searchParams}`)
      },
    })
    return res.json()
  }

  const p = chain.then(run, run)
  chain = p.then(() => {}, () => {})
  const results = await p
  c[key] = results
  cacheDirty = true
  // AUTO-FLUSH: this entry cost >=1.1 s of a rate limit that belongs to the ENDPOINT rather than to
  // this process, so it is worth persisting the moment it exists. Without this, the next throw
  // anywhere in the caller's loop discards it along with every other result the run has bought,
  // because all three flushes in workbook-extract.mjs sit outside their loops.
  //
  // The cost is not a judgement call — it was measured against the real 551-entry / 459 KB cache:
  // flushing on every request costs 78-816 ms across a whole metro run, against 114-462 s of live
  // Nominatim time for the same run. That is under 0.2% in the worst case, and it is bounded by the
  // 1.1 s spacing that gates every request anyway. Never throws (see flushCache).
  flushCache()
  return { results, cached: false }
}

export function liveRequestCount() {
  return liveRequests
}

// ---------------------------------------------------------------------------------------------
// Precision classification
// ---------------------------------------------------------------------------------------------
const STOP = new Set(['the', 'and', 'of', 'at', 'in', 'on', 'a', 'for', 'pickleball', 'courts', 'court', 'center', 'centre', 'park', 'complex', 'club'])

/** Loose name identity: do the distinctive tokens overlap? Deliberately generous — this only ever
 *  upgrades medium to high, and the distance guards elsewhere catch a wrong site.
 *
 *  ONE SHARED TOKEN IS NOT IDENTITY. Scoring the overlap against the SMALLER token set alone made a
 *  single common proper noun sufficient: "Bishop Park" reduces to {bishop} once `park` is dropped as
 *  a stop word, so its one token against "Bishop McDevitt High School" scored 1/1 = 1.0 and Harrisburg's
 *  Bishop Park anchored `high` on a high school. That row was only held back by an unrelated
 *  research_status='probable' — promoting the status would have published a pin on the wrong building.
 *
 *  So when exactly one token is shared, it must be DISCRIMINATIVE to count: it has to account for at
 *  least half of the LONGER name's distinctive tokens too. "Bishop" is 1 of 4 in
 *  {bishop, mcdevitt, high, school} = 0.25, and is rejected. An exact short name ("Stone Park" vs
 *  "Stone Park") is 1 of 1 and still passes. Two or more shared tokens keep the original rule — that
 *  is already more than one distinctive token in agreement.
 *
 *  This can only ever downgrade a `high` to `medium`; nothing here can produce `low`, and the publish
 *  gate blocks only `low`. It therefore cannot remove a row from any publish set. It CAN change a
 *  coordinate, because a false `high` no longer short-circuits the rung ladder in geocodeVenue — which
 *  is the entire point.
 */
function nameOverlap(a, b) {
  const tok = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))
  const ta = tok(a)
  const tb = tok(b)
  if (!ta.size || !tb.size) return false
  const inter = [...ta].filter((w) => tb.has(w)).length
  if (!inter) return false
  if (inter === 1) return inter / Math.max(ta.size, tb.size) >= 0.5
  return inter / Math.min(ta.size, tb.size) >= 0.5
}

// Nominatim `class` values that denote an actual venue-scale feature rather than an area or a road.
const VENUE_CLASS = new Set(['leisure', 'amenity', 'building', 'tourism', 'sport', 'shop', 'club', 'office'])
// `class`/`type` combinations that are only ever an area or a line — never a venue anchor.
const AREA_TYPE = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'postcode', 'administrative', 'county', 'state', 'municipality', 'borough', 'district'])
/**
 * DENYLIST — OSM feature types that can NEVER anchor a venue (owner ruling 2026-07-31).
 *
 * Incidental street furniture and micro-features. These sit at a plausible address without being
 * the venue: a bike rack is not a venue. Caught in the first Toledo run, where the 7-court
 * University of Toledo courts anchored on `amenity/waste_basket` and scored `high`.
 *
 * A hit on one of these is SKIPPED ENTIRELY by geocodeVenue (see isMicroFeature) so the ladder keeps
 * looking, rather than being demoted to a lower precision that can still WIN by default. That
 * distinction is the whole ruling: after the anchor-identity rule started demoting named anchors,
 * Durham's `durham-duke-east-campus-...` lost its (correctly demoted) named anchor to an UNNAMED
 * `amenity/bicycle_parking` node at the same house number — which stayed `medium` precisely because
 * having no name means no competing identity to fail — and still published. Demotion cannot fix
 * that, because the furniture wins whenever nothing better is left. Only skipping can.
 *
 * ROADS ARE DELIBERATELY NOT IN HERE. `class === 'highway'` on an actual road (secondary,
 * residential, service, ...) is still classified, not skipped: a street band is a legitimate `low`
 * anchor and the publish gate holds it. New Haven's Center Road Courts resolves to
 * `highway/secondary "Center Road"` = `low`, which is the documented-correct outcome; skipping the
 * whole class would turn that honest low-precision coordinate into "no coordinate" instead.
 * What IS listed here are the furniture-shaped `highway` node types (bus stops, traffic signals,
 * crossings), which are street furniture that happens to carry the highway class.
 */
const MICRO_FEATURE = new Set([
  // amenity-class street furniture
  'waste_basket', 'waste_disposal', 'recycling', 'bench', 'drinking_water', 'bicycle_parking',
  'motorcycle_parking', 'bicycle_repair_station', 'bicycle_rental', 'post_box', 'letter_box',
  'vending_machine', 'toilets', 'shelter', 'telephone', 'clock', 'surveillance', 'fire_hydrant',
  // parking sub-features — a parking bay or entrance is not the facility it serves
  'parking_space', 'parking_entrance',
  // landscape / boundary micro-features
  'tree', 'street_lamp', 'bollard', 'picnic_table',
  // highway-class nodes that are street furniture rather than roads
  'bus_stop', 'traffic_signals', 'crossing', 'stop', 'give_way', 'turning_circle', 'milestone',
  'speed_camera', 'passing_place', 'elevator',
])

/**
 * True when a Nominatim hit is street furniture / a micro-feature that must never anchor a venue.
 * Callers skip these outright so the query ladder continues. Exported for testability and so the
 * rule has one definition.
 */
export function isMicroFeature(hit) {
  return MICRO_FEATURE.has(hit?.type || '')
}

/**
 * Classify a Nominatim hit as high | medium | low.
 * `wantHouseNumber` is the house number parsed out of the venue's own address, when it has one.
 *
 * ANCHOR-IDENTITY RULE (owner ruling 2026-07-31): when the anchor NAMES a materially different
 * entity than the venue, the result is `low`, not `medium`.
 *
 * `medium` means "correct site, wrong feature" — a park polygon containing the courts, a campus, an
 * unnamed address point. That is a coordinate worth publishing because nothing about it contradicts
 * the venue's identity. It is a different claim from "the geocoder landed on something that calls
 * itself something else": Harrisburg's Bishop Park anchored on Bishop McDevitt High School, and
 * Toledo's university courts on a Subway at the campus street number. Those are not imprecise
 * anchors, they are anchors for a DIFFERENT PLACE, and a public pin on one is wrong rather than
 * fuzzy. A venue whose anchor cannot be tied to its own name is not a coordinate to publish,
 * whatever else is true about it.
 *
 * This reuses the two mechanisms that already exist rather than inventing a third: `nameOverlap` is
 * the identity signal, and `low` is the value the publish gate already blocks. No new gate condition.
 *
 * UNLIKE the nameOverlap single-token fix that preceded it, this CAN remove a row from a publish set
 * — that is the intent. It only ever demotes `medium` -> `low`: a `high` requires either a
 * name match or an anchor with no name at all, so nothing that currently reads `high` is touched, and
 * `geocodeVenue` still short-circuits on the first `high` it finds. What it does change is which hit
 * WINS when no `high` exists: a demoted anchor now loses to any genuinely-medium anchor from a later
 * rung, which is the right preference order.
 */
export function classifyPrecision(hit, { venueName, wantHouseNumber }) {
  const hitName = hit.namedetails?.name || hit.name || ''
  const prec = anchorPrecision(hit, { venueName, wantHouseNumber })
  if (prec === 'medium' && hitName && !nameOverlap(venueName, hitName)) return 'low'
  return prec
}

function anchorPrecision(hit, { venueName, wantHouseNumber }) {
  const cls = hit.class || hit.category || ''
  const type = hit.type || ''
  const addr = hit.address || {}
  const hitName = hit.namedetails?.name || hit.name || ''
  const houseMatch = !!(wantHouseNumber && addr.house_number
    && String(addr.house_number).toLowerCase() === String(wantHouseNumber).toLowerCase())

  // Street infrastructure is never a venue anchor, however well the address matches — a house-number
  // hit on one means "right address, wrong kind of thing". A ROAD still classifies (a street band is
  // a legitimate `low`); MICRO_FEATURE types no longer reach here at all, because geocodeVenue skips
  // them before classifying. The test is kept as defense in depth so any other caller of
  // classifyPrecision still gets the conservative answer rather than a confident wrong one.
  if (cls === 'highway' || MICRO_FEATURE.has(type)) return houseMatch ? 'medium' : 'low'

  // Exact house-number agreement is the strongest signal available without a survey. This MUST be
  // tested before the area rule below: Nominatim returns rooftop address points as `place/house`,
  // so an early `class === 'place'` return misclassifies every one of them as a city centroid.
  // That bug held 9 correctly-rooftopped Toledo venues out of the publish set on the first run.
  //
  // But a house number is shared by every POI at that address, and a large site has many. If the
  // matched feature carries a name that is NOT the venue's, it is a different entity at the same
  // address and the anchor is only site-accurate: the University of Toledo courts matched a Subway
  // at the campus street number. Right address, wrong entity -> `medium` here, which the
  // anchor-identity rule in classifyPrecision then demotes to `low` (a named different entity is
  // not a pin we publish). An unnamed address point or building has no competing identity -> high.
  if (houseMatch) return hitName && !nameOverlap(venueName, hitName) ? 'medium' : 'high'

  // An area centroid covers far more ground than a venue. `place/house` is excluded — an address
  // point is handled above and, without a house-number match to confirm it, falls through to medium.
  if ((cls === 'place' && type !== 'house') || cls === 'boundary' || AREA_TYPE.has(type)) return 'low'

  // A named venue-scale feature whose name matches the venue we asked for.
  if (VENUE_CLASS.has(cls) && hitName && nameOverlap(venueName, hitName)) return 'high'

  // A venue-scale feature that does not name-match, a park/landuse polygon containing the courts,
  // or an unconfirmed address point.
  if (VENUE_CLASS.has(cls) || cls === 'landuse' || cls === 'natural' || type === 'house') return 'medium'

  return 'medium'
}

function houseNumberOf(address) {
  const m = String(address || '').trim().match(/^(\d+[A-Za-z]?)\s+/)
  return m ? m[1] : null
}

function describeAnchor(hit, rung) {
  const cls = hit.class || hit.category || ''
  const type = hit.type || ''
  const name = hit.namedetails?.name || hit.name || ''
  const osm = hit.osm_type && hit.osm_id ? `${hit.osm_type}/${hit.osm_id}` : ''
  const hn = hit.address?.house_number ? `, house number ${hit.address.house_number}` : ''
  return `${cls}/${type} ${osm}${name ? ` "${name}"` : ''}${hn} (query rung: ${rung})`.trim()
}

// ---------------------------------------------------------------------------------------------
// Query ladder
// ---------------------------------------------------------------------------------------------
/**
 * Builds the ordered list of query attempts for a venue. Earlier rungs are more specific; the first
 * rung that returns a hit wins, and the rung is recorded in the anchor so a reviewer can see how
 * hard the geocoder had to work.
 *
 * Rung order is deliberate and evidence-backed:
 *   1 structured street+city+state+postcode — the only form that can produce a house-number match
 *   2 name + full address freeform          — rescues venues whose street is spelled differently in
 *                                             OSM than on the city page ("Bur-Mill" vs "Bur-Mil")
 *   3 address freeform                      — drops the name in case the name is the problem
 *   4 name + city + state                   — last resort; rescued a Greensboro venue with a blank
 *                                             address, but is also the rung most likely to land on a
 *                                             neighbouring feature, so it rarely classifies `high`
 */
/**
 * An address with a trailing suite / unit / building designator removed, or null when there is none.
 *
 * WHY: Nominatim's `street` parameter expects "<house number> <road>". A tenancy designator is not
 * part of the road and pushing one through the structured query is what turns a findable address into
 * zero hits — "547 Church Road, Suite G" returns nothing while "547 Church Road" resolves. Measured
 * across all 30 metros: 17 venues carry a designator, and stripping it takes 2 of them from NO
 * COORDINATE AT ALL to a publishable rooftop (augusta AUG-RIC-005, tucson tucson-ace).
 *
 * RETURNS NULL WHEN NOTHING WAS STRIPPED, deliberately — the caller adds a rung only when the
 * transform actually changed the address, so this is a no-op on the other 1,199 corpus venues BY
 * CONSTRUCTION rather than by a regression check that then confirms it.
 *
 * ACCEPTED RESIDUAL, measured not assumed: of the 17, six resolve to a CO-TENANT at the same street
 * number (a mall, a bookshop, a coffee shop) rather than to the venue. Those are "right address,
 * wrong entity", which the anchor-identity rule (owner, 2026-07-31) correctly scores `low`. Stripping
 * the suite is still the right transform — it is the classifier's job, not the query's, to decide
 * what a co-tenant anchor is worth.
 */
export function stripSuite(address) {
  const raw = String(address || '').trim()
  const stripped = raw.replace(SUITE_SUFFIX, '').replace(HASH_UNIT_SUFFIX, '').replace(/[,\s]+$/, '')
  return stripped && stripped !== raw ? stripped : null
}

/** A trailing tenancy designator PLUS its identifier.
 *
 *  Both halves are required, and the identifier's SHAPE is what keeps this from eating real roads.
 *  A permissive `[-\w]*` after the keyword looks equivalent and is not: it turns "100 Unit Road" into
 *  "100", because `Road` is a perfectly good word character run. Every unit identifier in the corpus
 *  is either digit-bearing (107, 25713, 4036, 300) or a lone letter (B, G) — a road name after the
 *  word "Unit" is neither. Anchored to the END because a designator is always trailing here.
 *
 *  Same family as the `Date.parse('-5')` lesson: reject by FORM, not by a pattern that happens to fit
 *  the examples in front of you. */
const SUITE_SUFFIX = /[,\s]+(?:suite|ste|unit|apt|apartment|bldg|building|rm|room)\.?\s+(?:[A-Za-z]?\d[-\w]*|[A-Za-z])\s*$/i

/** The `#` form carries no keyword, so the identifier must be digit-bearing to qualify at all —
 *  otherwise a stray `#` would strip the end of an address that merely contains one. */
const HASH_UNIT_SUFFIX = /[,\s]*#\s*[-\w]*\d[-\w]*\s*$/

function queryLadder({ name, address, city, state, zip, country = 'United States' }) {
  const rungs = []
  if (address) {
    rungs.push(['structured', { street: address, city, state, postalcode: zip, country }])
    // Same query, better formed — so it sits immediately behind the rung it repairs rather than at
    // the end of the ladder. It cannot make an anchor worse: `best` is replaced only on STRICTLY
    // better precision, and only a `high` short-circuits, so a venue whose raw address already
    // resolved `high` never issues this request at all.
    const nosuite = stripSuite(address)
    if (nosuite) rungs.push(['structured-nosuite', { street: nosuite, city, state, postalcode: zip, country }])
    rungs.push(['name+address', { q: [name, address, city, state, zip].filter(Boolean).join(', ') }])
    rungs.push(['address', { q: [address, city, state, zip].filter(Boolean).join(', ') }])
  }
  if (name) rungs.push(['name+city', { q: [name, city, state].filter(Boolean).join(', ') }])
  // A venue with no street address at all only gets the name rungs, so give it the zip as a second
  // chance — it narrows a common branch name ("Wolf Creek YMCA") to one municipality.
  if (name && !address && zip) rungs.push(['name+city+zip', { q: [name, city, state, zip].filter(Boolean).join(', ') }])
  if (!rungs.length && city) rungs.push(['city', { q: [city, state].filter(Boolean).join(', ') }])
  return rungs
}

// ---------------------------------------------------------------------------------------------
// Township rung — a name query with the CITY CONSTRAINT DROPPED, guarded by an address locus
// ---------------------------------------------------------------------------------------------
/**
 * WHY THIS EXISTS: every rung above carries the workbook's POSTAL city, and OSM indexes a great many
 * suburban venues under their TOWNSHIP instead. Harrisburg is the worst case measured — 5 of its 10
 * "ungeocodable" venues are in OSM under their exact name and appear the moment the city constraint
 * is dropped (Hampden Park in Hampden Twp, Creekview Park in Hampden Twp, Fisher Park in Upper Allen
 * Twp, Brightbill Park in Lower Paxton Twp, Lower Allen Community Park in Lower Allen Twp), while the
 * workbook files them under "Mechanicsburg"/"Harrisburg". The addresses were largely VINDICATED, not
 * wrong: Carolyn St, Larue St, Lisburn Rd, Wesley Dr and Fisher Rd all exist in OSM where the workbook
 * places them. Rungs 1-3 fail only because OSM carries no house numbers on those township roads.
 *
 * THE TRAP THAT MAKES THIS A GUARD AND NOT JUST A RUNG — "Koons Park, PA" returns a single confident
 * `leisure/park "Koons Park"` in Hershey, Derry Township, 15,081 m from the Larue Street the workbook
 * gives (Linglestown, Lower Paxton Twp). It name-matches exactly and classifies `high`, so NO precision
 * rule can catch it — not nameOverlap, not the anchor-identity rule, not the micro-feature denylist.
 * Only distance can. A naive bare-name rung would publish that coordinate with full confidence.
 *
 * So the rung is guarded by a locus derived from the venue's OWN ADDRESS FIELDS:
 *   1. zip locus    — the postcode centroid. Coarse, but the zip is the one part of the address that
 *                     cannot be township-vs-postal-city ambiguous, and there is exactly one of each.
 *   2. street locus — the street with its house number stripped. Preferred, because it is far tighter.
 *                     Chosen as the returned hit NEAREST the zip locus rather than hit[0], and accepted
 *                     only if it lands within TOWNSHIP_LOCUS_MAX_M of it.
 *   3. neither      — THE RUNG DOES NOT FIRE. An unguarded bare-name query is never issued.
 *
 * Step 2's validation is what makes a single-strategy locus survivable. Measured: "Creekview Rd,
 * PA 17050" resolves to a different Creekview Road in Lower Mifflin Township, 37,432 m from the 17050
 * centroid — believing it would have rejected the correct Creekview Park as "39,821 m away". And
 * "Hampden Park Dr" is absent from OSM under every query form tried, so it has no street locus at all.
 * Both venues are recovered by the zip fallback under the same name guard.
 *
 * The street locus can only ever REPLACE the coarse zip locus with a tighter one, so a wrongly-accepted
 * street locus can only cause a false REJECTION (the venue keeps no coordinate — the safe direction),
 * never a false acceptance. That is why TOWNSHIP_LOCUS_MAX_M is deliberately generous and
 * TOWNSHIP_NAME_MAX_M is the load-bearing constant.
 *
 * ACCEPTED RESIDUAL: no distance guard can separate two same-named venues within TOWNSHIP_NAME_MAX_M
 * of each other. That case is not engineered around; it is stated.
 *
 * This changes WHICH QUERY WE ASK, never what we assert. No address is invented or substituted, and
 * the coordinate still comes from OSM rather than from a workbook pair.
 */

/** How far a name-derived hit may sit from the locus. Derived from measurement, not guessed.
 *
 *  QUOTE THE CORPUS MAXIMUM, NOT THE DESIGN SAMPLE. This constant was originally justified on
 *  Harrisburg's worst case (Lower Allen Community Park, 3,226 m from the Lisburn Rd centerline —
 *  1.55x headroom). Running all 30 configs then accepted a wider legitimate case, so that figure no
 *  longer reproduces and the real margin is much tighter:
 *  - largest LEGITIMATE acceptance across the whole 30-config corpus is **Pepper Beachside Park**
 *    (port-st-lucie, Fort Pierce FL) at **4,543 m** from its street locus — N State Road A1A is a
 *    barrier-island road whose centerline runs miles from the park. That is 91% of the threshold:
 *    **real headroom is 1.10x, not 1.55x.** The figure is recorded verbatim in that venue's own
 *    coordinate anchor string, so it is reproducible from the artifact rather than from memory.
 *    (Harrisburg's 3,226 m and the largest zip-fallback case, Creekview Park at 2,982 m, remain the
 *    design sample; they are no longer the binding constraint.)
 *  - the Koons Park trap is 15,081 m from its street locus and 13,829 m from its zip locus. The
 *    threshold sits **3.02x** below the street-locus trap, and the separation actually available
 *    between the two observed sets — corpus max to trap — is **3.32x** (15,081 / 4,543).
 *
 *  THE CONSTANT STAYS AT 5,000 m (owner, 2026-08-01). 1.10x is tighter than the margin it was
 *  approved on, but the failure direction is safe: exceeding it produces a REJECTION, which holds a
 *  row in the work queue rather than publishing a wrong public pin. Widening it to buy headroom would
 *  spend the 3.32x separation from the trap, which is the margin that actually matters.
 *  Any value in (4.6 km, 13.8 km) still separates the two sets; 5,000 m sits near the low end on
 *  purpose, because a false rejection costs a held row while a false acceptance publishes a wrong pin.
 *
 *  NOTE ON THE NUMBERS: metresBetween is asymmetric (it takes cos of the FIRST argument's latitude),
 *  so a distance quoted a->b differs from b->a by ~0.07% at this latitude. Every figure in this file
 *  is quoted in the order the code actually evaluates it — hit -> locus for the name guard, street ->
 *  zip for the locus validation — and the unit tests re-derive them through metresBetween itself. */
export const TOWNSHIP_NAME_MAX_M = 5000

/** How far a street locus may sit from the venue's zip centroid before we stop believing it is this
 *  venue's street. Measured: legitimate street loci sit 1,483-4,403 m from their zip centroid (Bishop
 *  Park's is the outlier at 6,762 m); the wrong "Creekview Road" sits 37,432 m away. 10,000 m admits
 *  every legitimate one with >=1.48x margin and rejects Creekview's by 3.7x. Generous by design — see
 *  the false-rejection-only argument above. */
export const TOWNSHIP_LOCUS_MAX_M = 10000

/** The street portion of an address with any leading house number removed. OSM frequently carries the
 *  road but no house numbers along it, which is exactly why rungs 1-3 miss on township streets. */
export function streetWithoutHouseNumber(address) {
  const s = String(address || '').trim().replace(/^\d+[A-Za-z]?\s+/, '').trim()
  // A residue of digits only ("126") is a malformed address cell, not a street. Querying it would
  // send a bare number to Nominatim and get back something arbitrary, so refuse it here instead.
  if (!s || /^\d+[A-Za-z]?$/.test(s)) return null
  return s
}

/**
 * Read lat/lon off a Nominatim hit, or null when it carries none.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so a plain `Number.isFinite(Number(h.lat))` test accepts
 * a null-coordinate hit as the point (0, 0) in the Gulf of Guinea — which then measures thousands of
 * kilometres from any locus and merely LOOKS like a correct rejection. Caught by the unit test that
 * feeds in `{lat: null, lon: null}`; it would have been invisible in a metro run.
 */
function coordOf(hit) {
  const raw = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))
  const lat = raw(hit?.lat)
  const lng = raw(hit?.lon)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

function nearestHit(hits, ref) {
  let pick = null
  let bestD = Infinity
  for (const h of hits || []) {
    const c = coordOf(h)
    if (!c) continue
    const d = metresBetween(c.lat, c.lng, ref.lat, ref.lng)
    if (d < bestD) { bestD = d; pick = { hit: h, lat: c.lat, lng: c.lng, distance_m: Math.round(d) } }
  }
  return pick
}

/**
 * Pick the locus the township guard measures against. Pure — takes raw Nominatim result arrays so it
 * is testable without a network. Returns null when no locus can be established, which the caller MUST
 * treat as "do not fire the rung" rather than "match unguarded".
 *
 * Taking the street hit NEAREST the zip locus rather than hit[0] is load-bearing: Nominatim's own
 * ordering put the correct "Carolyn Street" third and the correct "Lisburn Road" third, and both are
 * only recoverable by measuring.
 */
export function resolveTownshipLocus({ streetHits = [], zipHits = [], locusMaxM = TOWNSHIP_LOCUS_MAX_M } = {}) {
  const usable = (arr) => (Array.isArray(arr) ? arr : []).filter((h) => coordOf(h) !== null)
  const zipHit = usable(zipHits)[0] || null
  const zip = zipHit ? coordOf(zipHit) : null
  const streets = usable(streetHits)

  let discardedStreet = null
  if (streets.length) {
    if (zip) {
      const n = nearestHit(streets, zip)
      if (n && n.distance_m <= locusMaxM) {
        return { kind: 'street', lat: n.lat, lng: n.lng, from_zip_m: n.distance_m, hit: n.hit, discarded_street: null }
      }
      discardedStreet = { from_zip_m: n ? n.distance_m : null, hit: n ? n.hit : streets[0] }
    } else {
      // Nothing to validate against. Take the street hit as-is and let the caller record that the
      // locus was unvalidated, rather than silently treating it as equally trustworthy.
      const h = streets[0]
      const c = coordOf(h)
      return { kind: 'street', lat: c.lat, lng: c.lng, from_zip_m: null, hit: h, discarded_street: null }
    }
  }
  if (zip) return { kind: 'zip', lat: zip.lat, lng: zip.lng, from_zip_m: 0, hit: zipHit, discarded_street: discardedStreet }
  return null
}

/**
 * Split a name query's hits into those inside the guard and those outside. Pure, for the same reason.
 *
 * This is a SELECTOR, not merely a veto — the correct hit is routinely not Nominatim's first. "Hampden
 * Park, PA" returns Reading (Berks County, 93 km) at [0] and the real Hampden Township park at [1];
 * "Fisher Park, PA" returns Philadelphia (160 km) at [0] and the real Upper Allen park at [1].
 */
export function guardTownshipHits(hits, locus, maxM = TOWNSHIP_NAME_MAX_M) {
  const accepted = []
  const rejected = []
  for (const h of Array.isArray(hits) ? hits : []) {
    const c = coordOf(h)
    if (!c) { rejected.push({ hit: h, distance_m: null, reason: 'hit carries no usable coordinate' }); continue }
    const d = Math.round(metresBetween(c.lat, c.lng, locus.lat, locus.lng))
    if (d > maxM) rejected.push({ hit: h, distance_m: d, reason: `${d} m from the ${locus.kind} locus (guard ${maxM} m)` })
    else accepted.push({ hit: h, distance_m: d })
  }
  return { accepted, rejected }
}

/**
 * Geocode one venue. Returns the coordinate node the importer persists, or null if every rung came
 * back empty (which is a real outcome — some venues simply are not in OSM).
 */
export async function geocodeVenue(venue, { cachePath: cp = DEFAULT_CACHE, onAttempt = null, fetchImpl = fetch } = {}) {
  loadCache(cp)
  const wantHouseNumber = houseNumberOf(venue.address)
  const attempts = []

  // Keep the BEST result across ALL rungs rather than returning on the first rung that yields any
  // hit. This matters enormously: a structured query on a grid-style address ("1100 N 550 E", the
  // norm across Utah) matches the STREET but no house number, which classifies `low` and would
  // short-circuit the name-based rungs that find the actual named park. On the first Provo/Ogden
  // run that single behaviour pushed the majority of both metros to low precision — i.e. held from
  // publishing — purely as an artifact of query ordering rather than of the data.
  // Only a `high` hit stops the search early; medium and low keep looking for something better.
  const rank = { high: 0, medium: 1, low: 2 }
  let best = null       // { hit, prec, rung }

  const microSkipped = []

  for (const [rung, params] of queryLadder(venue)) {
    const { results, cached } = await nominatim(params, { fetchImpl })
    const attempt = { rung, params, hits: Array.isArray(results) ? results.length : 0, cached, micro_skipped: 0 }
    attempts.push(attempt)
    const microThisRung = []
    if (!Array.isArray(results) || results.length === 0) { if (onAttempt) onAttempt({ ...attempt, micro: microThisRung }); continue }

    // Within a rung, prefer the hit that classifies best; ties break on Nominatim's own ordering.
    // Taking hit[0] blindly is how you anchor on a neighbouring feature when the real venue was
    // runner-up.
    for (const hit of results) {
      // A denylisted micro-feature is SKIPPED, never classified — so the ladder carries on looking
      // instead of the furniture winning by default once better candidates have been demoted.
      // If every hit for a venue is furniture, `best` stays null and the venue ends with NO
      // coordinate, which the publish gate holds. That is the intended outcome: a bike rack is not
      // a coordinate we publish, and "no coordinate" is the honest label for it.
      if (isMicroFeature(hit)) {
        attempt.micro_skipped++
        const desc = `${hit.class || hit.category || ''}/${hit.type}${hit.namedetails?.name || hit.name ? ` "${hit.namedetails?.name || hit.name}"` : ''} (rung ${rung})`
        microThisRung.push(desc)
        microSkipped.push(desc)
        continue
      }
      const prec = classifyPrecision(hit, { venueName: venue.name, wantHouseNumber })
      if (!best || rank[prec] < rank[best.prec]) best = { hit, prec, rung }
      if (best.prec === 'high') break
    }
    if (onAttempt) onAttempt({ ...attempt, micro: microThisRung })
    if (best && best.prec === 'high') break
  }

  // ---- township rung: drop the city constraint, guarded by an address-derived locus --------------
  // Fires ONLY when the venue has an address (the locus is derived from its own address fields) and
  // the ordinary ladder found nothing `high` — so the 565 of 769 venues that already anchor `high`
  // spend no extra request and cannot change. The same-site name pass calls this function with
  // address:null, so the rung never fires there and that pass's own 1000 m guard is untouched.
  const township = { fired: false, reason: null, locus: null, accepted: [], rejected: [] }
  if (!venue.address) township.reason = 'venue has no address — no locus can be derived from its address fields'
  else if (!venue.name) township.reason = 'venue has no name to query by'
  else if (best && best.prec === 'high') township.reason = 'the ordinary ladder already produced a high-precision anchor'

  if (!township.reason) {
    const street = streetWithoutHouseNumber(venue.address)
    const country = venue.country || 'United States'
    const zipHits = venue.zip ? (await nominatim({ postalcode: venue.zip, country }, { fetchImpl })).results : []
    const streetHits = street ? (await nominatim({ street, state: venue.state, postalcode: venue.zip, country }, { fetchImpl })).results : []
    const locus = resolveTownshipLocus({ streetHits, zipHits })

    if (locus?.discarded_street) {
      township.discarded_street = `${describeAnchor(locus.discarded_street.hit, 'locus:street')} — ${locus.discarded_street.from_zip_m} m from the zip centroid (> ${TOWNSHIP_LOCUS_MAX_M} m), so it is not this venue's street`
    }
    if (!locus) {
      // The whole point of the guard: with no locus there is nothing to measure against, so we do NOT
      // fall back to unguarded bare-name matching. The venue keeps whatever the ordinary ladder gave
      // it, including nothing. Reported so a reader sees a decision rather than a silent absence.
      township.reason = 'NO LOCUS — neither the street nor the postcode resolved, so the rung did not fire (an unguarded bare-name query is never issued)'
      if (onAttempt) onAttempt({ rung: 'township-name', params: null, hits: 0, cached: true, micro_skipped: 0, micro: [], township })
    } else {
      township.fired = true
      township.locus = `${locus.kind} locus ${locus.lat.toFixed(5)},${locus.lng.toFixed(5)} — ${describeAnchor(locus.hit, `locus:${locus.kind}`)}${locus.from_zip_m == null ? ' (UNVALIDATED: venue has no zip to check it against)' : locus.kind === 'street' ? `, ${locus.from_zip_m} m from the zip centroid` : ''}`
      const params = { q: [venue.name, venue.state].filter(Boolean).join(', '), countrycodes: 'us' }
      const { results, cached } = await nominatim(params, { fetchImpl })
      const hits = Array.isArray(results) ? results : []
      const { accepted, rejected } = guardTownshipHits(hits, locus)
      township.rejected = rejected.map((r) => `${describeAnchor(r.hit, 'township-name')} — REJECTED: ${r.reason}`)

      const attempt = { rung: 'township-name', params, hits: hits.length, cached, micro_skipped: 0 }
      attempts.push(attempt)
      const microThisRung = []
      for (const { hit, distance_m } of accepted) {
        if (isMicroFeature(hit)) {
          attempt.micro_skipped++
          const desc = `${hit.class || hit.category || ''}/${hit.type}${hit.namedetails?.name || hit.name ? ` "${hit.namedetails?.name || hit.name}"` : ''} (rung township-name)`
          microThisRung.push(desc)
          microSkipped.push(desc)
          continue
        }
        const prec = classifyPrecision(hit, { venueName: venue.name, wantHouseNumber })
        township.accepted.push(`${describeAnchor(hit, 'township-name')} — ${distance_m} m from the ${locus.kind} locus, classified ${prec}`)
        // Strict improvement only, exactly as in the ladder above. Because this rung runs LAST and can
        // only replace `best` with something of strictly better precision, it cannot lower a precision
        // and therefore cannot remove a row from any publish set. Splits can only move UP.
        if (!best || rank[prec] < rank[best.prec]) best = { hit, prec, rung: 'township-name', townshipDistance: distance_m, townshipLocus: locus.kind }
        if (best.prec === 'high') break
      }
      attempt.township = township
      if (onAttempt) onAttempt({ ...attempt, micro: microThisRung })

      // ---- no-city structured rung, under the SAME locus the township rung just derived ---------
      // The township rung drops the postal city from the NAME query. This drops it from the ADDRESS
      // query, for the same reason and against the same trap. Measured cause: Jackson's Ridgeland
      // Tennis Center is filed by OSM under `town: Madison` while the workbook says Ridgeland, so
      // `city=Ridgeland` over-constrains and Nominatim falls back to the McClellan Drive centerline
      // (`low`). Dropping the city returns `place/house`, house number 201, unnamed, place_rank 30 —
      // a rooftop 227 m away that classifies `high`.
      //
      // WHY IT IS GUARDED AND NOT JUST A RUNG. An unguarded city-dropped address query is dangerous
      // in exactly the way the Koons Park trap is dangerous, and it is not a hypothetical: across an
      // 18-metro sample, 4 venues returned a hit carrying the venue's EXACT house number at 5.4 km,
      // 6.4 km, 29 km and 49 km away — a different road of the same name in another county. A house
      // number matches on every road that has one, so no precision rule can catch this. Only distance
      // can, which is why this reuses guardTownshipHits and TOWNSHIP_NAME_MAX_M rather than
      // introducing a second tunable that would then need its own corpus justification.
      //
      // It rides inside the township block on purpose: the locus costs up to two requests to derive
      // and has already been paid for here, and the block's own precondition (an address, and nothing
      // `high` yet) is exactly this rung's precondition too.
      if (!best || best.prec !== 'high') {
        // Compose with the suite rung: if the address carries a designator, the no-city retry should
        // not re-introduce the thing that broke the structured query in the first place.
        const nocityStreet = stripSuite(venue.address) || venue.address
        const nocityParams = { street: nocityStreet, state: venue.state, postalcode: venue.zip, country }
        const { results: nocityResults, cached: nocityCached } = await nominatim(nocityParams, { fetchImpl })
        const nocityHits = Array.isArray(nocityResults) ? nocityResults : []
        const { accepted: nocityAccepted, rejected: nocityRejected } = guardTownshipHits(nocityHits, locus)
        const nocity = {
          locus: township.locus,
          accepted: [],
          rejected: nocityRejected.map((r) => `${describeAnchor(r.hit, 'structured-nocity')} — REJECTED: ${r.reason}`),
        }
        const nocityAttempt = { rung: 'structured-nocity', params: nocityParams, hits: nocityHits.length, cached: nocityCached, micro_skipped: 0 }
        attempts.push(nocityAttempt)
        const nocityMicro = []
        for (const { hit, distance_m } of nocityAccepted) {
          if (isMicroFeature(hit)) {
            nocityAttempt.micro_skipped++
            const desc = `${hit.class || hit.category || ''}/${hit.type}${hit.namedetails?.name || hit.name ? ` "${hit.namedetails?.name || hit.name}"` : ''} (rung structured-nocity)`
            nocityMicro.push(desc)
            microSkipped.push(desc)
            continue
          }
          const prec = classifyPrecision(hit, { venueName: venue.name, wantHouseNumber })
          nocity.accepted.push(`${describeAnchor(hit, 'structured-nocity')} — ${distance_m} m from the ${locus.kind} locus, classified ${prec}`)
          // Strict improvement only, same as every rung above. This runs last of all, so like the
          // township rung it cannot lower a precision and cannot remove a row from any publish set.
          if (!best || rank[prec] < rank[best.prec]) best = { hit, prec, rung: 'structured-nocity', townshipDistance: distance_m, townshipLocus: locus.kind, guardName: 'no-city locus' }
          if (best.prec === 'high') break
        }
        nocityAttempt.nocity = nocity
        if (onAttempt) onAttempt({ ...nocityAttempt, micro: nocityMicro })
      }
    }
  }

  // `best` null with microSkipped non-empty means every hit was denylisted furniture. Returning null
  // is correct; the caller distinguishes "no result" from "we refused every result" from the
  // onAttempt stream, because those are different facts and it reports them to a human.
  if (!best) return null
  const { hit, prec, rung } = best
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    precision: prec,
    origin: 'nominatim',
    source_url: 'https://nominatim.openstreetmap.org/',
    // The township guard's own measurement rides in the anchor string, which IS persisted — so a
    // township-derived coordinate is self-describing in the artifact rather than only in a run log.
    // `guardName` defaults to 'township' so every anchor written before the no-city rung existed
    // renders byte-identically — the regression diff then shows only rows that actually moved.
    anchor: describeAnchor(hit, rung) + (best.townshipDistance == null ? '' : ` — accepted by the ${best.guardName || 'township'} guard at ${best.townshipDistance} m from the venue's ${best.townshipLocus} locus (limit ${TOWNSHIP_NAME_MAX_M} m)`),
    osm_type: hit.osm_type ?? null,
    osm_id: hit.osm_type && hit.osm_id ? `${hit.osm_type}/${hit.osm_id}` : null,
    matched_rung: rung,
    matched_name: hit.namedetails?.name || hit.name || null,
    // Auditability for the denylist: which furniture hits were refused on the way to this anchor.
    // NOT persisted into the artifact (extractWorkbook copies an explicit field list), so it adds
    // no diff noise to a regression pass while still being visible in every run log.
    micro_skipped: microSkipped,
    attempts,
  }
}

/** Great-circle-ish metres. Same formula the import scripts use, kept identical so a delta computed
 *  here and a delta recomputed in preflight agree to the metre. */
export function metresBetween(aLat, aLng, bLat, bLng) {
  const dLat = (aLat - bLat) * 111320
  const dLng = (aLng - bLng) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

// ---------------------------------------------------------------------------------------------
// Standalone smoke test
// ---------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => {
    const a = process.argv.find((x) => x.startsWith(`--${n}=`))
    return a ? a.split('=').slice(1).join('=') : null
  }
  const venue = { name: arg('name'), address: arg('address'), city: arg('city'), state: arg('state'), zip: arg('zip') }
  // --cache wins; --metro derives the same per-metro path the pipeline uses, so a smoke test can
  // warm (and benefit from) the real metro cache instead of a file nothing else reads.
  const cache = arg('cache') || (arg('metro') ? geocodeCachePath(arg('metro')) : DEFAULT_CACHE)
  const out = await geocodeVenue(venue, { cachePath: cache })
  // A run that could not persist what it spent is not a success, even though the geocode itself
  // worked and the result below is real. `flushCache` no longer throws, so without this the process
  // exits 0 and a caller (or a human reading a shell) has nothing to key off.
  if (!flushCache()) process.exitCode = 1
  console.log(JSON.stringify(out, null, 2))
  console.log(`\nlive requests this run: ${liveRequestCount()} · cache: ${JSON.stringify(cacheStats())}`)
}
