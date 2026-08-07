/**
 * USGS NAIP aerial imagery — crop fetching and per-point acquisition metadata.
 *
 * WHAT THIS IS FOR: rendering an aerial crop of a published venue's coordinate so a human can see, in
 * one glance, whether the pin is on the venue at all. It is an AUDIT INSTRUMENT, not a lookup tool.
 * See scripts/naip-geocode-qa.mjs for the failure class it exists to catch.
 *
 * ---------------------------------------------------------------------------------------------
 * LICENSING — THE FEDERAL ENDPOINT ONLY. DO NOT "OPTIMIZE" THIS TO THE AWS MIRROR.
 * ---------------------------------------------------------------------------------------------
 * This module talks to imagery.nationalmap.gov and nowhere else, deliberately.
 *
 * The National Map's own terms (verified at source, 2026-08-06):
 *     https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map
 *     "Map services and data downloaded from The National Map are free and in the public domain."
 * Attribution is REQUESTED and explicitly NOT REQUIRED.
 *
 * The same NAIP imagery is mirrored on AWS Open Data (registry.opendata.aws/naip), where it is tagged
 * "Public Domain with Attribution" — a STRICTER term than the data's own license. Fetching from the
 * mirror would import an obligation the federal source does not impose, for no benefit. The mirror is
 * also a requester-pays S3 bucket, which turns a free read into a billed one.
 *
 * So: federal endpoint, no exceptions. This paragraph exists so nobody re-litigates it later.
 *
 * (Contrast with the OSM/Nominatim coordinates themselves, which ARE share-alike: those carry a real
 * ODbL obligation and render attribution via components/features/directory/OsmAttribution.tsx. NAIP
 * imagery carries no such obligation, and the two must not be confused.)
 *
 * ---------------------------------------------------------------------------------------------
 * RATE DISCIPLINE
 * ---------------------------------------------------------------------------------------------
 * No rate limit is documented for this service. That is not permission to hammer it: it is a public
 * federal service, a full corpus run is ~1,700 venues x 2 requests, and the courtesy posture is the
 * same one scripts/lib/geocode-nominatim.mjs takes toward Nominatim.
 *
 *   - every request serialized through one promise chain, spaced by a configurable delay
 *   - bounded exponential backoff on transient responses, WITH A FLOOR (see MIN_BACKOFF_MS)
 *   - every response cached to disk, so a re-run of an already-rendered metro issues ZERO requests
 *
 * THE FLOOR IS THE LESSON FROM THE NOMINATIM BACKOFF BUG. Nominatim's edge answers a 429 with a
 * literal `Retry-After: 0`, and honouring that made the backoff inert — the run then hammered an
 * endpoint that had already said stop, while logging a reassuring "backing off 0.0s". A transient
 * limit became a sustained IP block *because* of the retry. `parseRetryAfter` is imported from the
 * geocoder rather than reimplemented precisely so that fix has one home; MIN_BACKOFF_MS then guards
 * the same class of value one step further, because a server that can say 0 can also say 0.001.
 *
 * ---------------------------------------------------------------------------------------------
 * SERVICE FACTS, read from the service's own ?f=pjson on 2026-08-06
 * ---------------------------------------------------------------------------------------------
 *   maxImageWidth / maxImageHeight : 4000
 *   native spatial reference       : EPSG:3857 (Web Mercator)
 *   nominal resolution             : 0.6 m (mosaic; some tiles differ — read resolution_value)
 *   catalog fields                 : acquisition_date (epoch ms), resolution_value, Year, State, ...
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseRetryAfter } from './geocode-nominatim.mjs'

const BASE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
export const EXPORT_ENDPOINT = `${BASE}/exportImage`
export const IDENTIFY_ENDPOINT = `${BASE}/identify`

/** The service's own documented ceiling. Requesting more is a 400, not a silent downscale. */
export const MAX_PIXELS = 4000

/** Nominal NAIP ground sample distance. Used only to SIZE a request sensibly; the GSD actually
 *  reported per venue comes from the catalog item's `resolution_value`, never from this. */
export const NOMINAL_GSD_M = 0.6

const USER_AGENT = 'Joinzer-directory-qa/1.0 (https://www.joinzer.com; published-coordinate audit)'

/**
 * Transient statuses worth retrying.
 *
 * 429 and the gateway/overload 5xx shapes only. **500 is deliberately excluded**: ArcGIS ImageServer
 * answers a malformed request (a bad bbox, an out-of-range size) with a 500 carrying an error body,
 * so retrying one just repeats a request that can never succeed while looking like patience. Same
 * posture as geocode-nominatim.mjs — retry what means "come back later" BY DEFINITION, and let
 * everything else fail loudly on the first response.
 */
const RETRY_STATUSES = new Set([429, 502, 503, 504])
const MAX_RETRIES = 4
const BACKOFF_BASE_MS = 2000
const BACKOFF_CAP_MS = 30_000
/** No backoff is ever shorter than this, whatever a header says. See the header comment. */
export const MIN_BACKOFF_MS = 1000

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------
const EARTH_RADIUS_M = 6378137

/**
 * WGS84 lat/lng -> Web Mercator (EPSG:3857) metres.
 *
 * The bbox is built in the service's NATIVE projection rather than in degrees, because a box that is
 * square in degrees is not square on the ground — at latitude 43 a degree of longitude is ~73% of a
 * degree of latitude, so a degree-square bbox rendered into a square image stretches the scene ~37%
 * horizontally. Every crop this tool produces is a shape judgement ("is that rectangle a court?"), so
 * an anisotropic scale is not cosmetic.
 */
export function webMercator(lat, lng) {
  return {
    x: EARTH_RADIUS_M * (lng * Math.PI) / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  }
}

/**
 * A square bbox of `groundMeters` on a side, centred on the venue, in EPSG:3857.
 *
 * NOTE THE `/ cos(lat)` — this is the one place Web Mercator's distortion has to be undone by hand.
 * A Mercator metre is smaller than a ground metre by cos(latitude), so asking for a 400-unit box in
 * projected coordinates yields only ~292 ground metres at latitude 43. Without this correction every
 * crop would be silently tighter than requested, and tighter the further north the metro — which is
 * exactly backwards, since the northern metros (Syracuse, Buffalo, Spokane) are where a coordinate
 * error is most likely to sit outside a too-small frame.
 */
export function cropBbox({ lat, lng, groundMeters }) {
  const { x, y } = webMercator(lat, lng)
  const half = groundMeters / 2 / Math.cos((lat * Math.PI) / 180)
  return {
    bbox: [x - half, y - half, x + half, y + half].join(','),
    sr: 3857,
  }
}

/**
 * How many pixels to ask for, given the ground extent and a target resolution.
 *
 * Defaults aim at NAIP's native 0.6 m rather than at "as sharp as possible": asking for more pixels
 * than the source has does not add information, it just makes the response bigger and the contact
 * sheet slower to open. Clamped to the service ceiling so an over-wide `--ground-meters` degrades to
 * a coarser crop instead of a 400.
 */
export function chooseSize({ groundMeters, targetGsd = NOMINAL_GSD_M }) {
  const px = Math.round(groundMeters / targetGsd)
  return Math.max(64, Math.min(MAX_PIXELS, px))
}

// ---------------------------------------------------------------------------------------------
// Catalog item selection
// ---------------------------------------------------------------------------------------------
/**
 * The SOURCE tile among an `identify` response's catalog items.
 *
 * `identify` returns every catalog item covering the point at every pyramid level. Only Category 1 is
 * a real source raster; Category 2 items are overviews (`Ov_i02_L01_...tif`) whose acquisition_date,
 * resolution_value and raster_name are all null. Reading `features[0]` blindly works by luck — the
 * source happens to sort first today — and would report `null` for every date the moment it does not.
 *
 * Returns every qualifying item, finest-resolution first, so the caller can see a boundary case where
 * a point is covered by two source tiles from different flights.
 */
export function sourceCatalogItems(identifyJson) {
  const features = identifyJson?.catalogItems?.features ?? []
  return features
    .map((f) => f?.attributes ?? {})
    .filter((a) => a.Category === 1 && a.acquisition_date != null)
    .sort((a, b) => (a.MinPS ?? 0) - (b.MinPS ?? 0))
}

/** An epoch-millisecond acquisition_date as a plain UTC `YYYY-MM-DD`, or null.
 *
 *  UTC deliberately, not local: these are flight dates recorded as midnight UTC, and formatting one
 *  in US Pacific slides every date back a day. */
export function acquisitionDate(epochMs) {
  if (epochMs == null || !Number.isFinite(Number(epochMs))) return null
  const d = new Date(Number(epochMs))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Flatten an `identify` response into the facts the contact sheet shows.
 *
 * `date` is the NEWEST source acquisition date, and that choice is load-bearing for the staleness
 * flag. Where two flights cover one point, "even the newest imagery here predates the opening" is a
 * claim that holds regardless of which tile the mosaic actually drew from; picking the oldest would
 * flag crops that may well show the venue. All distinct dates are kept in `dates` so a reviewer sees
 * the boundary case rather than having it collapsed silently.
 */
export function summarizeIdentify(identifyJson) {
  const items = sourceCatalogItems(identifyJson)
  if (!items.length) return { date: null, dates: [], gsd: null, gsdUnits: null, tile: null, state: null }
  const dates = [...new Set(items.map((a) => acquisitionDate(a.acquisition_date)).filter(Boolean))].sort()
  const newest = items.reduce((best, a) => (Number(a.acquisition_date) > Number(best.acquisition_date) ? a : best), items[0])
  return {
    date: acquisitionDate(newest.acquisition_date),
    dates,
    gsd: newest.resolution_value ?? null,
    gsdUnits: newest.resolution_units ?? null,
    tile: newest.raster_name ?? newest.Name ?? null,
    state: newest.State ?? null,
  }
}

// ---------------------------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------------------------
/**
 * How long to wait before re-attempting, or null meaning DO NOT RETRY.
 * `attempt` is 1-based and counts the attempt that just failed.
 *
 * Every returned value passes through MIN_BACKOFF_MS, INCLUDING one derived from a Retry-After
 * header. `parseRetryAfter` already rejects a literal 0 (that is the Nominatim fix); the floor covers
 * the rest of the same family — a fractional second, a header rounded down by a proxy — so no
 * response can talk this client into a retry that is effectively immediate.
 */
export function naipRetryDelayMs({
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
  if (fromHeader != null) return Math.max(MIN_BACKOFF_MS, fromHeader)
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)
  // +-25% jitter, for the same reason the geocoder has it: two sessions backing off in lockstep
  // against one endpoint re-collide on every retry.
  return Math.max(MIN_BACKOFF_MS, Math.round(base * (0.75 + random() * 0.5)))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch with bounded backoff. `beforeAttempt` runs before EVERY attempt including retries, which is
 * what keeps the courtesy spacing honest — a retry is another real request against the same service.
 *
 * `fetchImpl` / `sleepImpl` / `random` are test seams; nothing in production passes them.
 */
export async function fetchWithRetry(url, {
  fetchImpl = fetch,
  sleepImpl = sleep,
  beforeAttempt = null,
  onRetry = null,
  maxRetries = MAX_RETRIES,
  nowFn = Date.now,
  random = Math.random,
  label = null,
} = {}) {
  const describe = label ?? String(url)
  let waitedMs = 0
  for (let attempt = 1; ; attempt++) {
    if (beforeAttempt) await beforeAttempt(attempt)
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) return res

    const delay = naipRetryDelayMs({
      status: res.status,
      retryAfterHeader: res.headers?.get ? res.headers.get('retry-after') : null,
      attempt,
      maxRetries,
      nowMs: nowFn(),
      random,
    })

    if (delay == null) {
      // A spent budget reads differently from a genuine error, so a run log can never confuse "the
      // service kept refusing us" with "this request is malformed".
      if (RETRY_STATUSES.has(res.status)) {
        throw new Error(`NAIP HTTP ${res.status} ${res.statusText} for ${describe} — gave up after ${attempt} attempt(s) and ${(waitedMs / 1000).toFixed(1)}s of backoff`)
      }
      throw new Error(`NAIP HTTP ${res.status} ${res.statusText} for ${describe}`)
    }

    if (typeof res.text === 'function') await res.text().catch(() => {})
    waitedMs += delay
    if (onRetry) onRetry({ attempt, status: res.status, delayMs: delay, totalWaitedMs: waitedMs, label: describe })
    await sleepImpl(delay)
  }
}

// ---------------------------------------------------------------------------------------------
// Serialized, spaced request queue
// ---------------------------------------------------------------------------------------------
let chain = Promise.resolve()
let lastRequestAt = 0
let liveRequests = 0
let spacingMs = 300

/** Courtesy spacing between live requests, in ms. Conservative by default; the CLI exposes it. */
export function setSpacingMs(ms) {
  const n = Number(ms)
  if (Number.isFinite(n) && n >= 0) spacingMs = n
}

export function liveRequestCount() {
  return liveRequests
}

/**
 * Queue a live request behind every other one.
 *
 * SERIALIZATION ONLY — the spacing lives in `beforeAttempt` and must not also be applied here. Doing
 * both silently doubles the delay on a first attempt and, worse, leaves a RETRY spaced differently
 * from a first try, so the log's stated courtesy interval stops describing what is on the wire.
 */
function enqueue(run) {
  const p = chain.then(run, run)
  chain = p.then(() => {}, () => {})
  return p
}

/** The one place the courtesy interval is enforced. Runs before every attempt, retries included. */
const beforeAttempt = async () => {
  const wait = spacingMs - (Date.now() - lastRequestAt)
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
  liveRequests++
}

const warnRetry = ({ attempt, status, delayMs, totalWaitedMs, label }) => {
  console.warn(`    NAIP HTTP ${status} (attempt ${attempt}) — backing off ${(delayMs / 1000).toFixed(1)}s (${(totalWaitedMs / 1000).toFixed(1)}s total) for ${label}`)
}

// ---------------------------------------------------------------------------------------------
// Disk cache — the artifact IS the cache
// ---------------------------------------------------------------------------------------------
/**
 * There is no separate cache store. A crop is cached by being the .jpg the contact sheet already
 * points at, and an identify result by being the .json beside it. One copy, two purposes: a re-run
 * that finds both files issues zero requests, and there is no way for the cache and the artifact to
 * disagree about what a venue looks like.
 *
 * Writes are atomic (temp + rename) for the reason geocode-nominatim.mjs adopted it: a process killed
 * mid-write otherwise leaves a truncated file that reads as valid-but-empty on the next run.
 */
function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* the original error is the one that matters */ }
    throw err
  }
}

/**
 * The acquisition metadata for one point, from disk if present.
 * Returns `{ summary, cached }`. A cache file that will not parse is treated as a miss.
 */
export async function identifyPoint({ lat, lng, cachePath, refetch = false, fetchImpl = fetch }) {
  if (!refetch && cachePath && existsSync(cachePath)) {
    try {
      return { summary: summarizeIdentify(JSON.parse(readFileSync(cachePath, 'utf8'))), cached: true }
    } catch { /* fall through to a live request */ }
  }
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnCatalogItems: 'true',
    returnGeometry: 'false',
    f: 'json',
  })
  const url = `${IDENTIFY_ENDPOINT}?${params}`
  const json = await enqueue(async () => {
    const res = await fetchWithRetry(url, { fetchImpl, beforeAttempt, onRetry: warnRetry, label: `identify ${lat},${lng}` })
    return res.json()
  })
  if (cachePath) writeAtomic(cachePath, JSON.stringify(json))
  return { summary: summarizeIdentify(json), cached: false }
}

/**
 * The aerial crop for one point, from disk if present. Returns `{ bytes, cached }`.
 *
 * `bytes` is null when the file was already on disk — the caller only needs to know the path is
 * populated, and reading a cached image back into memory for 1,700 venues buys nothing.
 */
export async function exportCrop({
  lat, lng, groundMeters, size, format = 'jpg', cachePath, refetch = false, fetchImpl = fetch,
}) {
  if (!refetch && cachePath && existsSync(cachePath)) return { bytes: null, cached: true }
  const { bbox, sr } = cropBbox({ lat, lng, groundMeters })
  const params = new URLSearchParams({
    bbox,
    bboxSR: String(sr),
    imageSR: String(sr),
    size: `${size},${size}`,
    format,
    f: 'image',
  })
  const url = `${EXPORT_ENDPOINT}?${params}`
  const bytes = await enqueue(async () => {
    const res = await fetchWithRetry(url, { fetchImpl, beforeAttempt, onRetry: warnRetry, label: `crop ${lat},${lng}` })
    // A 200 carrying JSON is ArcGIS reporting an error in the response body rather than the status.
    // Writing that to a .jpg produces a broken image in the sheet with no explanation, so catch it here.
    const ctype = res.headers?.get ? res.headers.get('content-type') || '' : ''
    if (!ctype.startsWith('image/')) {
      const body = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
      throw new Error(`NAIP exportImage returned ${ctype || 'an unknown content type'} instead of an image for ${lat},${lng}: ${body.slice(0, 300)}`)
    }
    return Buffer.from(await res.arrayBuffer())
  })
  if (cachePath) writeAtomic(cachePath, bytes)
  return { bytes, cached: false }
}
