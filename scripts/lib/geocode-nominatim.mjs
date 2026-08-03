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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Joinzer-directory-import/1.0 (https://www.joinzer.com; pickleball court directory research)'
const MIN_SPACING_MS = 1100
const DEFAULT_CACHE = '.geocode-cache/nominatim.json'

// ---------------------------------------------------------------------------------------------
// Disk cache — keyed by the exact query, so a changed query is a cache miss rather than a stale hit.
// ---------------------------------------------------------------------------------------------
let cachePath = DEFAULT_CACHE
let cache = null
let cacheDirty = false

function loadCache(path = cachePath) {
  cachePath = path
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    cache = {}
  }
  return cache
}

export function flushCache() {
  if (!cacheDirty || !cache) return
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(cache, null, 1))
  cacheDirty = false
}

export function cacheStats() {
  const c = loadCache()
  return { path: cachePath, entries: Object.keys(c).length }
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

async function nominatim(params) {
  const key = JSON.stringify(params)
  const c = loadCache()
  if (Object.prototype.hasOwnProperty.call(c, key)) return { results: c[key], cached: true }

  const run = async () => {
    const wait = MIN_SPACING_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await sleep(wait)
    const url = new URL(ENDPOINT)
    for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: '1', namedetails: '1', limit: '5', ...params })) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
    lastRequestAt = Date.now()
    liveRequests++
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } })
    if (!res.ok) {
      // A non-200 is NOT the same as "no such place" — surface it instead of caching an empty
      // result and silently marking the venue ungeocodable (the Greensboro lesson: 8 straight empty
      // responses there were genuine 200-with-[], and assuming rate-limiting would have been wrong).
      throw new Error(`nominatim HTTP ${res.status} ${res.statusText} for ${url.searchParams}`)
    }
    return res.json()
  }

  const p = chain.then(run, run)
  chain = p.then(() => {}, () => {})
  const results = await p
  c[key] = results
  cacheDirty = true
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
function queryLadder({ name, address, city, state, zip, country = 'United States' }) {
  const rungs = []
  if (address) {
    rungs.push(['structured', { street: address, city, state, postalcode: zip, country }])
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
export async function geocodeVenue(venue, { cachePath: cp = DEFAULT_CACHE, onAttempt = null } = {}) {
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
    const { results, cached } = await nominatim(params)
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
    const zipHits = venue.zip ? (await nominatim({ postalcode: venue.zip, country })).results : []
    const streetHits = street ? (await nominatim({ street, state: venue.state, postalcode: venue.zip, country })).results : []
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
      const { results, cached } = await nominatim(params)
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
    anchor: describeAnchor(hit, rung) + (best.townshipDistance == null ? '' : ` — accepted by the township guard at ${best.townshipDistance} m from the venue's ${best.townshipLocus} locus (limit ${TOWNSHIP_NAME_MAX_M} m)`),
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
  const out = await geocodeVenue(venue, { cachePath: arg('cache') || DEFAULT_CACHE })
  flushCache()
  console.log(JSON.stringify(out, null, 2))
  console.log(`\nlive requests this run: ${liveRequestCount()} · cache: ${JSON.stringify(cacheStats())}`)
}
