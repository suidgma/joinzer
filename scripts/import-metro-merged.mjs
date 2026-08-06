/**
 * Directory — GENERIC, metro-parameterized import + publish pipeline.
 *
 * Replaces the per-metro bespoke import scripts. Everything that varies between metros lives in
 * scripts/metros/<metro>.json; everything that must NOT vary — the preflight assertions, the publish
 * gate, the write-safety guards — lives here and is identical for every batch.
 *
 * The four already-published batches keep their original scripts (import-reno-merged.mjs,
 * import-daytona-merged.mjs, import-greensboro-merged.mjs, import-little-rock-merged.mjs). Those are
 * the audit trail for what actually ran against production and are deliberately left untouched.
 *
 * ---------------------------------------------------------------------------------------------
 * STAGES — each independently dry-runnable, run in this order:
 *
 *   --stage=project     READ-ONLY. Computes the publish/held split FROM THE ARTIFACT, before
 *                       anything is imported. Issues no writes in any mode. This stage exists
 *                       because --stage=publish recomputes the gate from the DATABASE and therefore
 *                       cannot say anything about a metro that has not been imported yet — which is
 *                       exactly the question the owner needs answered before approving an import.
 *                       It is the fifth stage beyond the four the brief named; flagged, not silent.
 *   --stage=candidates  N rows -> facility_candidates (staging / work queue). One atomic INSERT.
 *   --stage=listings    (N - reconciles) rows -> facility_listings status='draft' (one atomic
 *                       INSERT) + one guarded UPDATE per configured reconcile.
 *   --stage=publish     recompute the gate FROM THE DATABASE, flip qualifying rows to
 *                       status='published', then backlink published_listing_id + research_status.
 *   --stage=verify      read-only post-write assertions (no writes in any mode).
 *
 * WRITE SAFETY: every write sits AFTER an `if (DRY_RUN) { ...; process.exit(0) }` guard. In
 * --dry-run the process exits before any write is issued. Only SELECTs run in dry-run. `project`
 * and `verify` contain no write of any kind at all.
 *
 * PUBLISH GATE — COVERAGE-FIRST (ADR-17, owner ruling 2026-08-05): name (present + not generic) +
 * coordinate present + city + slug. Defined ONCE in scripts/lib/publish-gate.mjs and shared with the
 * reconciling pass in scripts/publish-facilities.mjs.
 *   Supersedes the 2026-07-28 gate, which also demanded precision != 'low' (dropped by ADR-16),
 *   access_type != 'unknown' and candidate research_status='verified' (both dropped by ADR-17).
 *   court_count is deliberately NOT a gate condition. Do not re-add it.
 *
 * THE GATE DOES NOT PUBLISH ANYTHING BY ITSELF. `--stage=publish` is the only thing that stamps
 * verified_by, and that stamp is the fence the reconciling pass requires before it will promote a
 * row. Loosening the gate therefore cannot flip a held draft: it stays draft until an owner runs this
 * stage for that metro. See the gate module's header for the full argument.
 *
 * SELF-VALIDATION: a config may declare `expected_publish` — the exact count that should publish and
 * the exact slug -> reason map for every row that should be held. Both `project` and `publish`
 * ASSERT against it and fail the run on any divergence. That turns "the pipeline reproduces the
 * known-good Little Rock split" from a claim read off a log into a machine check.
 *
 * COORDINATES: every coordinate is independently geocoded via Nominatim (ADR-12 forbids persisting a
 * Places-derived one, and preflight aborts on any origin that is not 'nominatim'). A workbook
 * coordinate is NEVER a source — where one exists it is recorded as
 * provenance.coordinate.workbook_crosscheck and preflight RE-DERIVES its delta rather than trusting
 * the stored number.
 *
 * ROLLBACK: `source` is set explicitly to the batch tag on every row (the column is NOT NULL DEFAULT
 * 'osm', so omitting it mislabels the batch as OSM-ingested). That tag is the one-statement,
 * non-destructive rollback handle:
 *   update facility_listings set status='draft' where source='<batch>';
 *
 * Established path: supabase-js + service role. READ-ONLY against every table other than
 * facility_candidates + facility_listings. No deletes, ever.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=project
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=candidates --dry-run
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=candidates
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=listings --dry-run
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=listings
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=publish --dry-run
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=publish
 *   node scripts/import-metro-merged.mjs --metro=toledo --stage=verify
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { revalidateDirectory } from './lib/revalidate-directory.mjs'
import { LIVE, AGGREGATOR_HOST, DOCUMENT_URL } from './lib/workbook-extract.mjs'
import { PRESERVE_ON_RECONCILE, RECONCILE_TARGET_COLUMNS, assertReconcileCoordinate, mergeOntoTarget, preservedSummary } from './lib/reconcile-merge.mjs'
import { BLOCKING_RESEARCH_STATUS, GATE_TEXT, gateReasons, isApproximateLocation, PIPELINE_VERIFICATION_STATUS, verificationStatusFor } from './lib/publish-gate.mjs'
import { DISTINCT_NEIGHBOUR_COLUMNS, parseDistinctFromLive, verifyDistinctFromLive } from './lib/distinct-from-live.mjs'

// ---------------------------------------------------------------------------------------------
// Args + config
// ---------------------------------------------------------------------------------------------
const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.split('=').slice(1).join('=') : null
}
const DRY_RUN = process.argv.includes('--dry-run')
const STAGE = arg('stage')
const METRO_KEY = arg('metro')
const STAGES = ['project', 'candidates', 'listings', 'publish', 'verify']

if (!METRO_KEY) { console.error('Pass --metro=<name> (reads scripts/metros/<name>.json)'); process.exit(1) }
if (!STAGES.includes(STAGE)) { console.error(`Pass --stage=${STAGES.join('|')}`); process.exit(1) }

const CONFIG_PATH = `scripts/metros/${METRO_KEY}.json`
let config
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
} catch (e) {
  console.error(`Could not read ${CONFIG_PATH}: ${e.message}`)
  process.exit(1)
}

// ---- config validation: a malformed config must fail loudly, not produce a half-configured run ----
// `envelope` is deliberately NOT required: hand-guessing a metro's bounding box before seeing any
// coordinates is how Toledo's first envelope wrongly swallowed Sandusky (a different CBSA). The
// projection stage reports the OBSERVED bounding box of the geocoded venues so the envelope can be
// derived from evidence and then locked. An unset envelope is loudly reported on every run and
// BLOCKS the write stages — it is a read-only-projection convenience, never an import shortcut.
const CONFIG_REQUIRED = ['batch', 'metro_area', 'states', 'input', 'expected_count']
const cfgMissing = CONFIG_REQUIRED.filter((k) => config[k] == null)
if (cfgMissing.length) { console.error(`${CONFIG_PATH} is missing required key(s): ${cfgMissing.join(', ')}`); process.exit(1) }
if (/,/.test(config.metro_area)) {
  // metroLabel() renders `${metro_area}, ${state}` with state derived per row, so a state inside
  // metro_area renders "Toledo, OH, OH" and slugs to /courts/in/toledo-oh.
  console.error(`metro_area "${config.metro_area}" must NOT contain the state — metroLabel() appends it.`)
  process.exit(1)
}

const BATCH = config.batch
const METRO = config.metro_area
const STATES = new Set(config.states)
const ENVELOPE = config.envelope
const EXPECTED_COUNT = config.expected_count
const RECONCILES = config.reconciles || []
const RECONCILE_RADIUS_M = config.reconcile_radius_m ?? 200
const INTERNAL_PROXIMITY_M = config.internal_proximity_m ?? 150
const INPUT = arg('input') || config.input
const nowIso = new Date().toISOString()

// ---------------------------------------------------------------------------------------------
// Supabase (not needed by --stage=project, which is pure-artifact)
// ---------------------------------------------------------------------------------------------
let db = null
function connect() {
  if (db) return db
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
  )
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
  db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  return db
}

// ---------------------------------------------------------------------------------------------
// Load + normalize the artifact
// ---------------------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(INPUT, 'utf8'))

// `exclude` holds a venue OUT of this run entirely — no candidate row, no listing row, no reconcile,
// and it is not counted toward expected_count. Used for a venue whose disposition is a pending owner
// decision: excluding it is strictly safer than importing it as a draft, because it leaves any
// pre-existing live row it might reconcile onto completely untouched. Every exclusion is printed in
// the stage header of every run, so it can never drop out silently.
const EXCLUDE = new Map((config.exclude || []).map((e) =>
  typeof e === 'string' ? [e, 'no reason recorded'] : [e.candidate_key, e.reason || 'no reason recorded']))
const allVenues = doc.venues || []
const venues = allVenues.filter((v) => !EXCLUDE.has(v.research_key))
const excludedPresent = allVenues.filter((v) => EXCLUDE.has(v.research_key)).map((v) => v.research_key)
for (const k of EXCLUDE.keys()) {
  if (!allVenues.some((v) => v.research_key === k)) {
    console.error(`config lists exclude "${k}" but the artifact has no such venue — stale config, aborting.`)
    process.exit(1)
  }
}
// ---------------------------------------------------------------------------------------------
// Adjudicated same-site pairs
// ---------------------------------------------------------------------------------------------
// Two venues can legitimately share one physical site — a recreation center sitting inside a city
// park, with separate indoor and outdoor court sets, is the recurring shape — and they then geocode
// inside the internal-proximity radius and abort the run. The knob that would make that go away
// (`internal_proximity_m`) is metro-wide, so raising it disables the guard for every OTHER pair in
// the metro. That is precisely the failure this guard exists to prevent, and relaxing an assertion
// to make a run pass is the move this script forbids everywhere else.
//
// So an adjudicated pair is allow-listed HERE, by research key, one pair at a time, carrying the
// verdict, the evidence URL and the adjudication date — the same shape as the Little Rock reconcile
// allow-list. The guard itself is untouched and still fires on every unadjudicated pair.
//
// Three validations stop this rotting into a silencer:
//   1. a key that is not in the artifact ABORTS (stale config) — mirrors `exclude`
//   2. the verdict MUST be 'two_venues'. A "one venue, two rows" finding is a merge-or-exclude
//      decision; allow-listing it would publish a duplicate, which is the opposite of the fix.
//   3. evidence_url and adjudicated_on are MANDATORY. An undocumented entry is just a silenced
//      assertion with extra steps.
// A listed pair that no longer trips the guard is REPORTED, not fatal — the geocoder may legitimately
// have separated them since the adjudication was made.
const pairId = (a, b) => [a, b].sort().join(' ')
const SAME_SITE = new Map()
const SAME_SITE_BY_KEY = new Map()
for (const p of config.same_site_pairs || []) {
  const where = `same_site_pairs entry ${JSON.stringify([p.a, p.b])}`
  for (const k of ['a', 'b', 'verdict', 'evidence_url', 'adjudicated_on']) {
    if (!p[k]) { console.error(`${CONFIG_PATH}: ${where} is missing "${k}" — an allow-listed pair must carry its verdict, evidence and date, or it is an undocumented silenced assertion.`); process.exit(1) }
  }
  if (p.verdict !== 'two_venues') {
    console.error(`${CONFIG_PATH}: ${where} has verdict "${p.verdict}". Only 'two_venues' may be allow-listed — a one-venue finding is a merge/exclude decision, and allow-listing it would publish a duplicate.`)
    process.exit(1)
  }
  for (const k of [p.a, p.b]) {
    if (!allVenues.some((v) => v.research_key === k)) { console.error(`${CONFIG_PATH}: ${where} names "${k}", which the artifact does not contain — stale config, aborting.`); process.exit(1) }
  }
  SAME_SITE.set(pairId(p.a, p.b), p)
  SAME_SITE_BY_KEY.set(p.a, { ...p, sibling: p.b })
  SAME_SITE_BY_KEY.set(p.b, { ...p, sibling: p.a })
}

// ---------------------------------------------------------------------------------------------
// Adjudicated reconciles
// ---------------------------------------------------------------------------------------------
// A reconcile asserts that a research row and a dormant OSM listing are the SAME physical venue, so
// the import becomes a guarded UPDATE keyed on osm_id instead of an INSERT. That preserves the OSM
// lineage and the idempotent osm_id key, and it is the only thing standing between us and a
// duplicate the dedupe never catches later. It is a research verdict about physical identity, so it
// carries the same documentation burden as an allow-listed same-site pair: `evidence_url` and
// `adjudicated_on` are MANDATORY. An undocumented reconcile is a silent overwrite of a live row.
//
// `also_at_site` handles the shape the Huntsville batch surfaced: ONE physical site carrying TWO
// dormant OSM rows — an indoor wellness-centre polygon (way/73937891) and its outdoor court pad
// (way/75909784), 105 m apart. Exactly one may be reconciled onto; reconciling both would publish
// one physical site twice. The other is deliberately left as a dormant unpublished draft — it is a
// real OSM record of the site and deleting or merging it buys nothing — but the live proximity
// guard would then correctly refuse the whole metro because of it.
//
// The knob that would make that go away, `reconcile_radius_m`, is METRO-WIDE: lowering it below
// 105 m would disable the guard for every other neighbour in Huntsville, which is precisely the
// failure the guard exists to prevent. So the second row is named HERE instead, one row at a time,
// carrying its verdict, evidence and date, and the radius is left untouched.
//
// Four validations keep this an adjudication rather than a silencer:
//   1. verdict MUST be 'same_site_dormant' and disposition MUST be 'leave_dormant_draft'. Any other
//      finding is a merge / exclude / second-reconcile decision, not something to wave past a guard.
//   2. evidence_url and adjudicated_on are MANDATORY — same rule as same_site_pairs.
//   3. preflight re-asserts LIVE (with the reconcile-target checks) that the named row is STILL
//      status='draft'. If anything published it by another path the run ABORTS: the adjudication
//      was made about a dormant row and no longer describes reality.
//   4. an entry that stops tripping the guard is REPORTED as no longer load-bearing rather than
//      carried silently forever.
const ALSO_AT_SITE_BY_KEY = new Map()   // candidate_key -> [entry]
const ALSO_AT_SITE_BY_OSM = new Map()   // osm_id        -> entry (for the live draft assertion)
const alsoTripped = new Set()
for (const r of RECONCILES) {
  const where = `reconciles entry ${JSON.stringify(r.candidate_key ?? '(no candidate_key)')}`
  for (const k of ['candidate_key', 'osm_id', 'listing_id', 'evidence_url', 'adjudicated_on']) {
    if (!r[k]) { console.error(`${CONFIG_PATH}: ${where} is missing "${k}" — a reconcile rewrites a live row in place, so it must carry its target, its evidence and its adjudication date.`); process.exit(1) }
  }
  if (!allVenues.some((v) => v.research_key === r.candidate_key)) {
    console.error(`${CONFIG_PATH}: ${where} names a candidate_key the artifact does not contain — stale config, aborting.`)
    process.exit(1)
  }
  for (const a of r.also_at_site || []) {
    const aw = `${where} also_at_site ${JSON.stringify(a.osm_id ?? '(no osm_id)')}`
    for (const k of ['osm_id', 'listing_id', 'verdict', 'disposition', 'evidence_url', 'adjudicated_on']) {
      if (!a[k]) { console.error(`${CONFIG_PATH}: ${aw} is missing "${k}" — an allow-listed live row must carry its verdict, evidence and date, or it is an undocumented silenced assertion.`); process.exit(1) }
    }
    if (a.verdict !== 'same_site_dormant') {
      console.error(`${CONFIG_PATH}: ${aw} has verdict "${a.verdict}". Only 'same_site_dormant' may be allow-listed — anything else is a merge/exclude/reconcile decision for the owner, and waving it past the proximity guard would publish a duplicate.`)
      process.exit(1)
    }
    if (a.disposition !== 'leave_dormant_draft') {
      console.error(`${CONFIG_PATH}: ${aw} has disposition "${a.disposition}". Only 'leave_dormant_draft' is supported — this list says "do not touch this row", never "do something else to it".`)
      process.exit(1)
    }
    if (a.osm_id === r.osm_id) {
      console.error(`${CONFIG_PATH}: ${aw} names the reconcile TARGET itself. A row cannot be both reconciled onto and left dormant.`)
      process.exit(1)
    }
    ALSO_AT_SITE_BY_KEY.set(r.candidate_key, [...(ALSO_AT_SITE_BY_KEY.get(r.candidate_key) || []), a])
    ALSO_AT_SITE_BY_OSM.set(a.osm_id, { ...a, candidate_key: r.candidate_key })
  }
}

// ---------------------------------------------------------------------------------------------
// Adjudicated distinct venues near a PUBLISHED, non-OSM neighbour
// ---------------------------------------------------------------------------------------------
// The third allow-list, and the one that closes the case the other two structurally cannot reach.
// `reconciles` matches a neighbour by osm_id and `also_at_site` looks one up in ALSO_AT_SITE_BY_OSM
// while additionally asserting it is still status='draft'. A published row that came from our own
// research has osm_id NULL, so neither can even name it — and Tampa's Bryan Glazer Family JCC was
// deferred out of its batch for exactly that reason, 148 m from published Vila Brothers Park.
//
// Parsing and validation live in scripts/lib/distinct-from-live.mjs so they can be unit-tested; this
// file executes on import (it reads argv and exits), so nothing declared here is importable.
// The module throws so it stays pure and testable; every other config validation in this file exits
// with a plain message rather than a stack trace, so it is converted here to match.
let DISTINCT_BY_LISTING
try {
  DISTINCT_BY_LISTING = parseDistinctFromLive(config.distinct_from_live, {
    configPath: CONFIG_PATH,
    artifactKeys: new Set(allVenues.map((v) => v.research_key)),
    reconciles: RECONCILES,
  })
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
const distinctTripped = new Set()

// Artifacts written by scripts/lib/workbook-extract.mjs carry their metadata at the top level; the
// hand-built Little Rock artifact nests the same keys under `_meta`. Read both so the generic
// pipeline can be validated against the known-good published batch without editing its artifact.
const meta = (k) => doc[k] ?? doc._meta?.[k] ?? null

const reconcileByKey = new Map(RECONCILES.map((r) => [r.candidate_key, r]))
const isReconcile = (v) => reconcileByKey.has(v.research_key)
const reconcileFor = (v) => reconcileByKey.get(v.research_key) || null

const fieldVal = (f) => (f && typeof f === 'object' && 'value' in f) ? f.value : (f ?? null)
const orNull = (v) => (v == null || v === '' ? null : v)
const evidence = (f) => {
  if (!f || typeof f !== 'object') return null
  const e = {}
  // `boolean_crosscheck` carries BOTH workbook values where a TRUE/FALSE column and its enum-shaped
  // twin both stated the fact. Without it here the comparison would exist in the artifact and never
  // reach the row, which is where a reader looking at a contradiction would go for it.
  for (const k of ['source_url', 'source_tier', 'confidence', 'note', 'workbook_name', 'workbook_value', 'mapping_branch', 'mapping_branch_reason', 'boolean_crosscheck']) {
    if (f[k] != null) e[k] = f[k]
  }
  return Object.keys(e).length ? e : null
}
const EVIDENCE_FIELDS = ['name', 'address', 'court_count', 'access_type', 'indoor', 'fee_type', 'reservation_policy', 'lighting', 'surface', 'pickleball_activity', 'public_notes']

const metresBetween = (aLat, aLng, bLat, bLng) => {
  const dLat = (aLat - bLat) * 111320
  const dLng = (aLng - bLng) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

function reviewerNotes(v) {
  const parts = []
  if (v.workbook_id) parts.push(`workbook ${v.workbook_id}`)
  if (v.name?.workbook_name) parts.push(`name cleanup: "${v.name.workbook_name}" -> "${fieldVal(v.name)}"`)
  if (v.research_status === 'probable') parts.push("probable — believed real, not confirmed by a controlling entity (ADR-14). PUBLISHES under the coverage-first gate (ADR-17) carrying verification_status='listed'; it is an unproven venue, not a rejected one. Promote to 'verified' when a controlling-entity source is found.")
  if (v._workbook?.adr14_note) parts.push(v._workbook.adr14_note)
  if (isApproximateLocation(v.coordinates?.precision)) parts.push(`coordinate precision LOW — publishes with an approximate-location label (ADR-16), pin is the street band not the building: ${v.coordinates.anchor || ''}`.trim())
  const rec = reconcileFor(v)
  if (rec) parts.push(`RECONCILE onto OSM ${rec.osm_id} (existing_listing_id=${rec.listing_id})`)
  parts.push(`facts + full per-field provenance on facility_listings slug=${v.slug}`)
  return parts.join(' | ')
}

function provenanceFor(v) {
  const fields = {}
  for (const f of EVIDENCE_FIELDS) { const e = evidence(v[f]); if (e) fields[f] = { value: fieldVal(v[f]), ...e } }
  const p = {
    batch: BATCH,
    candidate_key: v.research_key,
    workbook_id: v.workbook_id ?? null,
    method: 'directory_research',
    research_status_at_import: v.research_status,
    fields,
    coordinate: v.coordinates ? {
      lat: v.coordinates.lat, lng: v.coordinates.lng,
      precision: v.coordinates.precision ?? null,
      source_url: v.coordinates.source_url ?? null,
      origin: v.coordinates.origin ?? null,
      anchor: v.coordinates.anchor ?? null,
      matched_rung: v.coordinates.matched_rung ?? null,
      workbook_crosscheck: v.coordinates.workbook_crosscheck ?? null,
      // Set only when an adjudicated same-site pair could not be separated even by a name-only
      // geocode: the two venues genuinely share one anchor. Naming the sibling here is the honest
      // record of why two rows carry one coordinate, instead of leaving it to look like a duplicate.
      shared_anchor_with: v.coordinates.shared_anchor_with ?? null,
      name_anchor: v.coordinates.name_anchor ?? null,
      // Set when a venue_facts address correction forced a re-geocode: the workbook's address was
      // wrong, so the coordinate it produced was wrong too. Records what it was re-derived from.
      address_override: v.coordinates.address_override ?? null,
      // Set when an adjudication adopted a NAMED OSM FEATURE's coordinate because the query ladder
      // could not reach it. Carries the feature id, the evidence, the adjudicator, the cross-check
      // delta and the coordinate it superseded — so a reader asking "why does this pin disagree with
      // what a fresh geocode returns" gets the answer off the row rather than out of a config file
      // that has since moved on. Same reasoning as osm_reconcile's adjudication block.
      adopted_from: v.coordinates.adopted_from ?? null,
    } : null,
    address_source: v.address_source ?? null,
    workbook_name: v.name?.workbook_name ?? null,
    workbook_slug: v._workbook?.slug ?? null,
    workbook_provenance_note: v._workbook?.provenance_note ?? null,
    controlling_entity: v.controlling_entity ?? null,
    phone_source: v.phone_source ?? null,
    // ADR-14: aggregator URLs are a private research input. They may sit here (provenance is never
    // rendered) but preflight forbids them on a user-facing column of a publishing row.
    aggregator_source_urls: v._workbook?.aggregator_urls ?? null,
    adr14_note: v._workbook?.adr14_note ?? null,
    odbl: 'Coordinate is OSM-derived via Nominatim (ODbL 1.0). Published pages must carry OpenStreetMap attribution — components/features/directory/OsmAttribution.tsx on /courts, /courts/[slug] and /courts/in/[metro].',
    workbook_coordinate_warning: meta('workbook_coordinate_warning'),
    workbook_coordinate_note: v._workbook?.workbook_coordinate_note ?? null,
    enum_mappings: meta('enum_mappings_applied'),
    // Two rows for one physical site, adjudicated as distinct venues. Carried onto both members so a
    // published page can explain why a sibling sits metres away.
    same_site_adjudication: SAME_SITE_BY_KEY.get(v.research_key) ?? null,
    // Owner/verifier-supplied facts applied on top of the workbook, with their own source + date.
    verified_facts: meta('verified_facts_applied'),
    owner_decisions: meta('owner_decisions') ?? doc._meta?.owner_decisions_2026_07_30 ?? null,
    imported_at: nowIso,
    artifact_updated: meta('updated'),
  }
  const rec = reconcileFor(v)
  if (rec) {
    p.osm_reconcile = {
      osm_id: rec.osm_id,
      existing_listing_id: rec.listing_id,
      matched_distance_m: v.reconcile?.matched_distance_m ?? rec.matched_distance_m ?? null,
      osm_original: v.reconcile?.osm_original ?? rec.osm_original ?? null,
      note: v.reconcile?.note ?? rec.note ?? null,
      // The verdict's provenance travels WITH the row it rewrote. A reader asking months later "why
      // does this listing carry an OSM id it was never ingested from" gets the evidence URL, the
      // adjudicator and the date off the row itself rather than off a config file that has since
      // moved on. `confidence` is deliberately free-form here (medium_high is not a live enum value
      // and never reaches a column) — it records how strong the identity verdict actually was.
      adjudicated_by: rec.adjudicated_by ?? null,
      adjudicated_on: rec.adjudicated_on ?? null,
      evidence_url: rec.evidence_url ?? null,
      confidence: rec.confidence ?? null,
      // Other live rows established as the SAME physical site and deliberately left dormant. Carried
      // onto the published row so the reason a near-identical draft sits 105 m away is recorded
      // somewhere a reader will actually find it.
      also_at_site: ALSO_AT_SITE_BY_KEY.get(v.research_key) ?? null,
    }
  }
  return p
}

// ---------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------
const candidateRows = venues.map((v) => {
  const rec = reconcileFor(v)
  return {
    candidate_key: v.research_key,
    batch: BATCH,
    discovered_by: config.discovered_by || `${METRO_KEY}-research`,
    proposed_name: fieldVal(v.name),
    address: orNull(fieldVal(v.address)),
    zip: orNull(v.zip),
    city: orNull(v.city),
    state: orNull(v.state),
    metro_area: METRO,
    lat: v.coordinates?.lat ?? null,
    lng: v.coordinates?.lng ?? null,
    google_place_id: orNull(fieldVal(v.google_place_id)),
    osm_id: rec ? rec.osm_id : null,
    osm_clusters: null,
    classifier_type: null, classifier_access_type: null, classifier_confidence: null,
    suggested_disposition: null,
    proposed_source_url: orNull(v.name?.source_url),
    url_source: 'directory_research',
    research_status: v.research_status,
    edited_name: null, edited_access_type: null, edited_city: null, edited_address: null,
    verified_source_url: orNull(v.name?.source_url),
    identity_confidence: orNull(v.identity_confidence ?? v.name?.confidence),
    pickleball_confidence: orNull(v.pickleball_activity?.confidence),
    reviewer_notes: reviewerNotes(v),
    reviewed_by: BATCH,
    address_source: v.address_source ?? null,
    existing_listing_id: rec ? rec.listing_id : null,
    published_listing_id: null,                     // set by --stage=publish
  }
})

function listingFields(v) {
  return {
    name: fieldVal(v.name),
    slug: v.slug,
    source: BATCH,                                 // explicit — never the 'osm' default
    status: 'draft',                               // every row lands draft; --stage=publish flips the gate-passers
    lat: v.coordinates?.lat ?? null,
    lng: v.coordinates?.lng ?? null,
    address: orNull(fieldVal(v.address)),
    address_source: v.address_source ?? null,
    address_verified_at: fieldVal(v.address) ? nowIso : null,
    city: orNull(v.city), state: orNull(v.state), zip: orNull(v.zip), country: v.country || 'US',
    metro_area: METRO,
    court_count: fieldVal(v.court_count) ?? null,
    access_type: fieldVal(v.access_type) ?? 'unknown',
    fee_type: fieldVal(v.fee_type) ?? null,
    reservation_policy: fieldVal(v.reservation_policy) ?? null,
    reservation_url: null,
    indoor: fieldVal(v.indoor) ?? null,
    lighting: fieldVal(v.lighting) ?? null,
    surface: fieldVal(v.surface) ?? null,
    court_configuration: v.court_configuration ?? null,
    line_type: v.line_type ?? null,
    net_setup: v.net_setup ?? null,
    website: orNull(v.website),
    phone: orNull(v.phone),
    public_notes: orNull(fieldVal(v.public_notes)),
    google_place_id: orNull(fieldVal(v.google_place_id)),
    name_source_url: orNull(v.name?.source_url),
    // ADR-18: the tier DESCRIBES the row, it does not gate it. Was hardcoded 'source_verified' for
    // every row, which was true only while the gate demanded research_status='verified'. Under
    // coverage-first a `probable` row publishes, and calling it source_verified would be a lie told
    // by a column. Mapping is mechanical so it cannot be applied inconsistently.
    verification_status: verificationStatusFor(v.research_status),
    verified_at: null, verified_by: null,          // published rows only — set by --stage=publish
    enrichment: null, enriched_at: null, enrichment_version: null,
    location_id: null,
    provenance: provenanceFor(v),
  }
}

// The reconcile merge itself lives in scripts/lib/reconcile-merge.mjs — this file executes on
// import (it reads argv and exits), so nothing declared here can be unit-tested. RECONCILE_TARGET_BY_OSM
// stays here because it is per-run state captured by preflight, not pure logic.
const RECONCILE_TARGET_BY_OSM = new Map()
/** An acknowledged coordinate trade, captured by preflight with its RE-DERIVED distance and
 *  precision, so the record written onto the row is the one the run actually verified rather than
 *  the one the config claimed. Per-run state, same as RECONCILE_TARGET_BY_OSM. */
const RECONCILE_TRADE_BY_OSM = new Map()

const insertVenues = venues.filter((v) => !isReconcile(v))
const reconcileVenues = venues.filter(isReconcile)
const listingRows = insertVenues.map(listingFields)

// ---------------------------------------------------------------------------------------------
// The publish gate now lives in scripts/lib/publish-gate.mjs and is SHARED with the reconciling
// pass in scripts/publish-facilities.mjs.
//
// It moved for two reasons. Nothing defined in this file is importable — the module reads argv and
// process.exit()s at load — so the gate could never be unit-tested where it was. And publish-
// facilities.mjs carried its OWN private copy of the coordinate-precision rule, so relaxing the gate
// here alone would have let that pass silently un-publish every row this one promoted. See that
// file's header for the full argument.
// ---------------------------------------------------------------------------------------------

/**
 * Asserts the computed split against config.expected_publish. This is what makes a claimed
 * reproduction falsifiable: if the generic pipeline classifies even one row differently from the
 * recorded expectation, the run fails rather than reporting a plausible-looking number.
 */
function assertExpectedPublish(eligibleSlugs, blocked) {
  const exp = config.expected_publish
  if (!exp) return { checked: false }
  const fail = []
  if (exp.count != null && eligibleSlugs.length !== exp.count) fail.push(`expected ${exp.count} to publish, got ${eligibleSlugs.length}`)

  const expHold = exp.hold || {}
  const gotHold = Object.fromEntries(blocked.map((b) => [b.slug, b.reasons.join('; ')]))
  for (const slug of Object.keys(expHold)) {
    if (!(slug in gotHold)) { fail.push(`expected "${slug}" to be HELD, but it passed the gate`); continue }
    if (!gotHold[slug].includes(expHold[slug])) fail.push(`"${slug}" held for "${gotHold[slug]}", expected reason to contain "${expHold[slug]}"`)
  }
  for (const slug of Object.keys(gotHold)) {
    if (!(slug in expHold)) fail.push(`"${slug}" was HELD (${gotHold[slug]}) but the config does not expect it to be`)
  }
  return { checked: true, fail }
}

function reportExpected(result) {
  if (!result.checked) {
    console.log(`\nno expected_publish block in ${CONFIG_PATH} — split not machine-checked.`)
    return true
  }
  if (!result.fail.length) {
    console.log(`\nEXPECTED-SPLIT ASSERTION: MATCHES ${CONFIG_PATH} exactly ✓`)
    return true
  }
  console.error(`\nEXPECTED-SPLIT ASSERTION FAILED — ${result.fail.length} divergence(s):`)
  result.fail.forEach((f) => console.error(`  x ${f}`))
  console.error('\nThe generic pipeline classified rows differently from the recorded expectation.')
  console.error('Fix the pipeline. Do NOT edit the expectation to match the output.')
  return false
}

// ---------------------------------------------------------------------------------------------
// Pre-flight assertions — any failure aborts. Never relax one to make a run pass.
// ---------------------------------------------------------------------------------------------
async function preflight({ checkCollisions, candidateKeys }) {
  const fail = []
  if (!ENVELOPE) {
    // Never allowed to reach a write. Projection is read-only, so it may proceed with a warning.
    if (STAGE !== 'project') { console.error(`\nABORT: ${CONFIG_PATH} has no "envelope". Derive it from the observed bounding box printed by --stage=project, then lock it in the config before importing.`); process.exit(1) }
    console.log(`  ENVELOPE UNSET — coordinate bounds NOT asserted. Required before any import; see the observed bbox below.`)
  }
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})

  if (venues.length !== EXPECTED_COUNT) fail.push(`venue count ${venues.length} != ${EXPECTED_COUNT}`)
  if (config.expected_status_dist) {
    const distKeys = new Set([...Object.keys(config.expected_status_dist), ...Object.keys(dist)])
    for (const k of distKeys) if ((dist[k] || 0) !== (config.expected_status_dist[k] || 0)) fail.push(`status dist ${k}: got ${dist[k] || 0}, expected ${config.expected_status_dist[k] || 0}`)
  }
  for (const r of RECONCILES) {
    if (!venues.some((v) => v.research_key === r.candidate_key)) fail.push(`configured reconcile "${r.candidate_key}" is not present in the artifact`)
  }
  if (meta('batch') && meta('batch') !== BATCH) fail.push(`artifact batch "${meta('batch')}" != config batch "${BATCH}" — wrong artifact for this metro`)

  for (const v of venues) {
    const k = v.research_key
    if (!LIVE.research_status.has(v.research_status)) fail.push(`${k}: research_status "${v.research_status}"`)
    const at = fieldVal(v.access_type); if (!LIVE.access_type.has(at)) fail.push(`${k}: access_type "${at}"`)
    const ft = fieldVal(v.fee_type); if (ft != null && !LIVE.fee_type.has(ft)) fail.push(`${k}: fee_type "${ft}" (the workbooks' 'paid'/'day_pass' are NOT live values)`)
    const rp = fieldVal(v.reservation_policy); if (rp != null && !LIVE.reservation_policy.has(rp)) fail.push(`${k}: reservation_policy "${rp}" (the workbooks' 'first_come'/'scheduled'/'required' are NOT live values)`)
    const sf = fieldVal(v.surface); if (sf != null && !LIVE.surface.has(sf)) fail.push(`${k}: surface "${sf}" (the workbooks' 'gym'/'cushioned' are NOT live values)`)
    if (v.court_configuration != null && !LIVE.court_configuration.has(v.court_configuration)) fail.push(`${k}: court_configuration "${v.court_configuration}" (the workbooks' 'shared_use'/'shared-use' are NOT valid)`)
    if (v.line_type != null && !LIVE.line_type.has(v.line_type)) fail.push(`${k}: line_type "${v.line_type}" (the workbooks' 'painted' is NOT valid)`)
    if (v.net_setup != null && !LIVE.net_setup.has(v.net_setup)) fail.push(`${k}: net_setup "${v.net_setup}" (the workbooks' 'portable' is NOT valid)`)
    if (v.address_source == null || !LIVE.address_source.has(v.address_source)) fail.push(`${k}: address_source "${v.address_source}"`)
    const ic = v.identity_confidence ?? v.name?.confidence; if (ic != null && !LIVE.confidence.has(ic)) fail.push(`${k}: identity_confidence "${ic}"`)
    const pc = v.pickleball_activity?.confidence; if (pc != null && !LIVE.confidence.has(pc)) fail.push(`${k}: pickleball_confidence "${pc}"`)
    const iv = fieldVal(v.indoor); if (iv != null && typeof iv !== 'boolean') fail.push(`${k}: indoor "${iv}" is not a boolean — 'mixed' must map to null`)
    if (!v.slug) fail.push(`${k}: missing slug`)
    if (!fieldVal(v.name)) fail.push(`${k}: missing name`)
    if (!v.state || !STATES.has(v.state)) fail.push(`${k}: state "${v.state}" is not one of ${[...STATES].join('/')}`)

    // Slug convention: every published row is `<name>-<city>-<state>`. A workbook research key
    // (`tol-oh-…`) reaching the slug column would become a permanent public URL.
    if (v.slug && v.state && !v.slug.endsWith(`-${String(v.state).toLowerCase()}`)) {
      fail.push(`${k}: slug "${v.slug}" does not end in "-${String(v.state).toLowerCase()}" — the directory convention is <name>-<city>-<state>; a raw workbook slug must never reach the slug column`)
    }

    const { lat, lng } = v.coordinates || {}
    if (lat == null || lng == null) {
      // Not fatal by itself — a coordinate-less row imports as a draft the gate then blocks. It is
      // fatal only if the config says every row was geocoded.
      if (config.require_all_geocoded !== false) fail.push(`${k}: no coordinate (set "require_all_geocoded": false in the config to import coordinate-less rows as gate-blocked drafts)`)
    } else if (ENVELOPE && (lat < ENVELOPE.latMin || lat > ENVELOPE.latMax || lng < ENVELOPE.lngMin || lng > ENVELOPE.lngMax)) {
      fail.push(`${k}: coordinate ${lat},${lng} outside the ${METRO} envelope`)
    }
    if (v.coordinates) {
      const prec = v.coordinates.precision
      if (!['high', 'medium', 'low'].includes(prec)) fail.push(`${k}: coordinate precision "${prec}" — must be high|medium|low`)
      const origin = v.coordinates.origin || ''
      if (/places|google/i.test(origin)) fail.push(`${k}: coordinate origin "${origin}" is Places-derived — ADR-12 forbids persisting it`)
      if (origin !== 'nominatim') fail.push(`${k}: coordinate origin "${origin}" — every row is geocoded via nominatim; a different origin means the input changed`)
      if (!v.coordinates.source_url) fail.push(`${k}: coordinate carries no source_url`)
      if (!v.coordinates.anchor) fail.push(`${k}: coordinate carries no anchor description`)

      // An adopted coordinate must carry its adjudication. The extractor already refuses to write
      // one without these, so this is defence against a hand-edited artifact rather than against a
      // malformed config — the same reason the workbook_crosscheck delta is re-derived below rather
      // than trusted. An unattributable adopted pin is a public map position nobody signed for.
      const ad = v.coordinates.adopted_from
      if (ad) {
        for (const f of ['osm_id', 'evidence_url', 'adjudicated_by', 'adjudicated_on', 'reason']) {
          if (!ad[f]) fail.push(`${k}: coordinate.adopted_from is missing "${f}" — an adopted pin must carry its feature, evidence, adjudicator, date and reason`)
        }
      }

      // A workbook coordinate is a cross-check, never a source. RE-DERIVE the distance rather than
      // trusting the stored number, so a bad edit to the artifact cannot quietly launder a workbook
      // coordinate back in as authoritative.
      const xc = v.coordinates.workbook_crosscheck
      if (xc) {
        if (xc.lat == null || xc.lng == null || xc.delta_m == null) fail.push(`${k}: incomplete workbook_crosscheck`)
        else {
          const recomputed = Math.round(metresBetween(v.coordinates.lat, v.coordinates.lng, xc.lat, xc.lng))
          if (Math.abs(recomputed - xc.delta_m) > 2) fail.push(`${k}: workbook_crosscheck delta_m says ${xc.delta_m} but recomputes to ${recomputed}`)
        }
      }
    }

    // ADR-14: an aggregator URL must never reach a user-facing column on a row that will publish.
    // NOTE this check got STRICTER as a side effect of the coverage-first gate, which is the safe
    // direction: more rows now qualify as "would publish", so more rows are held to the ADR-14 bar.
    const wouldPublish = gateReasons({
      name: fieldVal(v.name), lat: v.coordinates?.lat, lng: v.coordinates?.lng,
      city: v.city, slug: v.slug, research_status: v.research_status,
    }).length === 0
    for (const [col, val] of [['website', v.website], ['name_source_url', v.name?.source_url]]) {
      if (val && AGGREGATOR_HOST.test(val) && wouldPublish) {
        fail.push(`${k}: ${col}="${val}" is a tier-4 aggregator on a row that would PUBLISH — ADR-14 forbids republishing it`)
      }
    }
    // A document is never a website. Unlike an aggregator URL — which is a legitimate research
    // input that only becomes a problem once republished — there is no state in which a meeting
    // agenda belongs in the visitor-facing column, so this is NOT scoped to would-publish rows.
    // Scoping it would leave a held row carrying a minutes PDF until the day someone fixes its
    // coordinate, which is exactly how these reach production unnoticed: 8 draft rows carry one
    // right now, and the 2026-08-03 repair only cleaned the published ones.
    // `name_source_url` is deliberately exempt — citing a PDF is what that column is FOR.
    if (v.website && DOCUMENT_URL.test(v.website)) {
      fail.push(`${k} [${wouldPublish ? 'WOULD PUBLISH' : 'held'}]: website="${v.website}" is a document (PDF/agenda/minutes/uploaded file), not a venue site — cite it via name_source_url and leave website null, or point website at the operator's page`)
    }
    if (v.research_status === 'verified' && v._workbook?.adr14_note) {
      fail.push(`${k}: carries an ADR-14 aggregator-only note but is still research_status='verified' — the downgrade to 'probable' did not apply`)
    }
  }

  // internal uniqueness (slug, candidate_key)
  for (const [label, vals] of [['slug', venues.map((v) => v.slug)], ['candidate_key', venues.map((v) => v.research_key)]]) {
    const seen = new Set(), dup = new Set()
    for (const x of vals) { if (seen.has(x)) dup.add(x); seen.add(x) }
    if (dup.size) fail.push(`duplicate ${label} in input: ${[...dup].join(', ')}`)
  }
  // Internal proximity — two rows for one physical site.
  // A `low`-precision coordinate is a street band, not a located point, so two DIFFERENT venues on
  // the same street necessarily collide at 0 m. Asserting on it would be asserting on a coordinate
  // the pipeline itself declares untrustworthy.
  // Ogden: Farmington Regional Park (178 S 650 W) and Farmington Gymnasium (294 S 650 W) are
  // distinct venues with distinct house numbers that both fell back to "South 650 West".
  //
  // THE SECOND HALF OF THAT RATIONALE WENT STALE ON 2026-08-04 and this block is the repair. The
  // skip was safe partly because "those rows are held from publishing anyway" — ADR-16 made that
  // false, and low-precision rows now go live. So two rows for ONE physical site can now both
  // publish with this guard never having looked at them, which is a visible duplicate in the
  // directory rather than a slightly-off pin.
  //
  // The skip itself is KEPT — asserting on an untrustworthy coordinate would fail honest runs, which
  // is why it was introduced. What changes is that the collision is REPORTED instead of silently
  // dropped: non-fatal, printed on every run, so the owner sees the pair at the metro's go-gate and
  // can adjudicate or exclude. Reporting is the whole fix; escalating to fatal would resurrect the
  // false failures.
  const lowPrecisionCollisions = []
  const adjudicatedTripped = new Set()
  for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
    const a = venues[i].coordinates, b = venues[j].coordinates
    if (!a?.lat || !b?.lat) continue
    const d = metresBetween(a.lat, a.lng, b.lat, b.lng)
    if (d >= INTERNAL_PROXIMITY_M) continue
    if (a.precision === 'low' || b.precision === 'low') {
      const id = pairId(venues[i].research_key, venues[j].research_key)
      if (SAME_SITE.has(id)) {
        // COUNT IT AS TRIPPED. The pair is within the radius and an allow-list entry is what stops
        // it being reported below — that entry is doing its job, so it must not be described by the
        // "allow-listed but did NOT trip the guard … no longer load-bearing" summary further down.
        // Saying so would invite someone to delete the one thing suppressing a false duplicate
        // report. The proximity check is skipped for this pair; the adjudication is not.
        adjudicatedTripped.add(id)
      } else {
        lowPrecisionCollisions.push(`${venues[i].research_key} / ${venues[j].research_key} — ${Math.round(d)} m apart (precision ${a.precision}/${b.precision})`)
      }
      continue
    }
    const id = pairId(venues[i].research_key, venues[j].research_key)
    const adj = SAME_SITE.get(id)
    if (!adj) { fail.push(`${venues[i].research_key} and ${venues[j].research_key} are ${Math.round(d)} m apart — likely one site, two rows`); continue }
    adjudicatedTripped.add(id)
    console.log(`  same-site pair ADJUDICATED (${Math.round(d)} m): ${adj.a} / ${adj.b} — ${adj.verdict} by ${adj.adjudicated_by || 'unrecorded'} on ${adj.adjudicated_on}`)
    console.log(`    evidence: ${adj.evidence_url}`)
    if (adj.note) console.log(`    ${adj.note}`)
  }
  for (const [id, adj] of SAME_SITE) {
    if (!adjudicatedTripped.has(id)) {
      console.log(`  same-site pair ${adj.a} / ${adj.b} is allow-listed but did NOT trip the ${INTERNAL_PROXIMITY_M} m guard — they now geocode apart; the entry is harmless but no longer load-bearing.`)
    }
  }
  // Non-fatal by design — see the rationale above the loop. These pairs are NOT asserted on because
  // the coordinate is untrustworthy by the pipeline's own admission, but under ADR-16 they can now
  // both reach production, so they must be visible at the metro's go-gate rather than silent.
  if (lowPrecisionCollisions.length) {
    console.log(`\n  ⚠ LOW-PRECISION PROXIMITY (${lowPrecisionCollisions.length}) — non-fatal, REVIEW BEFORE PUBLISHING:`)
    lowPrecisionCollisions.forEach((c) => console.log(`      ${c}`))
    console.log(`    At least one coordinate in each pair is a street band, so this may be two venues on one street`)
    console.log(`    (the normal case) OR one site imported twice. Under ADR-16 both rows can now PUBLISH, so a`)
    console.log(`    genuine duplicate would be publicly visible. Adjudicate via same_site_pairs, or exclude.`)
  }

  if (checkCollisions) {
    const conn = connect()
    const insertSlugs = insertVenues.map((v) => v.slug)
    const keys = venues.map((v) => v.research_key)

    const { data: sc, error: e1 } = await conn.from('facility_listings').select('slug').in('slug', insertSlugs)
    if (e1) fail.push(`slug collision check failed: ${e1.message}`)
    else if (sc.length) fail.push(`slug collisions live (insert set): ${sc.map((r) => r.slug).join(', ')}`)

    for (const rec of RECONCILES) {
      const v = venues.find((x) => x.research_key === rec.candidate_key)
      if (!v) continue
      const { data: rc, error: e1b } = await conn.from('facility_listings').select('id, slug, osm_id, status').eq('slug', v.slug)
      if (e1b) fail.push(`reconcile slug check failed: ${e1b.message}`)
      else if (rc.length && !(rc.length === 1 && rc[0].id === rec.listing_id)) fail.push(`reconcile slug "${v.slug}" collides with a row that is NOT its reconcile target: ${rc.map((r) => r.id).join(', ')}`)

      const { data: tgt, error: e1c } = await conn.from('facility_listings').select(RECONCILE_TARGET_COLUMNS).eq('osm_id', rec.osm_id)
      if (e1c) fail.push(`reconcile target check failed: ${e1c.message}`)
      else if (tgt.length !== 1) fail.push(`reconcile target osm_id=${rec.osm_id}: expected exactly 1 row, found ${tgt.length}`)
      else {
        if (tgt[0].id !== rec.listing_id) fail.push(`reconcile target id mismatch: expected ${rec.listing_id}, found ${tgt[0].id}`)
        if (tgt[0].status !== 'draft') fail.push(`reconcile target is not draft (status=${tgt[0].status}) — abort, do not overwrite a published row`)
        RECONCILE_TARGET_BY_OSM.set(rec.osm_id, tgt[0])

        // Preservation preview, printed HERE in the SHARED preflight rather than only in the
        // listings plan. `--stage=listings --dry-run` aborts on the candidateKeys:'present' guard
        // before it can print anything, so the listings plan is unreachable until candidates are
        // already seeded — which would make the merge observable only BETWEEN two writes.
        // `--stage=candidates --dry-run` reaches this point read-only, so the operator sees exactly
        // what will be kept before anything is written at all.
        // COORDINATE SAFETY, checked HERE because this is the earliest point that holds both the
        // incoming row and the live target. lat/lng are deliberately NOT preserved by the merge, so
        // the incoming coordinate always wins — which silently nulls a good coordinate when the
        // research row failed to geocode, and silently replaces a court-accurate OSM pin with a
        // street band when it geocoded badly. Both were found by a human reading source rather than
        // by the pipeline. Reachable read-only via `--stage=candidates --dry-run`.
        const coordCheck = assertReconcileCoordinate({ incoming: listingFields(v), target: tgt[0], rec, nowIso })
        console.log(`  reconcile coordinate: ${coordCheck.report}`)
        if (coordCheck.fatal) fail.push(coordCheck.fatal)
        if (coordCheck.trade) RECONCILE_TRADE_BY_OSM.set(rec.osm_id, coordCheck.trade)

        const { preserved } = mergeOntoTarget(listingFields(v), tgt[0], rec, nowIso)
        const summary = preservedSummary(preserved)
        console.log(`  reconcile merge preview: ${rec.candidate_key} -> "${tgt[0].slug}" ${summary
          ? `PRESERVES ${Object.keys(preserved).length} field(s) from the dormant OSM row — ${summary}`
          : 'preserves nothing (the research row carries a value for every field the target holds)'}`)
        if (preserved.address) {
          console.log(`    address kept from the OSM record -> address_source forced to 'osm' (ADR-12); address_verified_at left at the target's own value (${JSON.stringify(tgt[0].address_verified_at ?? null)}), NOT stamped today`)
        }
      }

      // Validation 3 of the also_at_site contract: the allow-list describes a DORMANT row, so its
      // dormancy is re-asserted against live data on every run rather than taken on trust from the
      // config. If something published it by another path, the adjudication no longer describes
      // reality and the run aborts instead of quietly proceeding.
      for (const a of rec.also_at_site || []) {
        const { data: alt, error: e1d } = await conn.from('facility_listings').select('id, osm_id, status, name, slug').eq('osm_id', a.osm_id)
        if (e1d) { fail.push(`also_at_site check failed for ${a.osm_id}: ${e1d.message}`); continue }
        if (alt.length !== 1) { fail.push(`also_at_site osm_id=${a.osm_id}: expected exactly 1 row, found ${alt.length}`); continue }
        if (alt[0].id !== a.listing_id) { fail.push(`also_at_site id mismatch for ${a.osm_id}: expected ${a.listing_id}, found ${alt[0].id}`); continue }
        if (alt[0].status !== 'draft') { fail.push(`also_at_site "${alt[0].name}" (${a.osm_id}) is status=${alt[0].status}, not draft — the adjudication was made about a DORMANT row and no longer describes reality. Re-adjudicate; do NOT relax this.`); continue }
        console.log(`  also-at-site dormancy confirmed live: "${alt[0].name}" (${a.osm_id}, ${alt[0].slug}) is still status='draft' and is left untouched by this run`)
      }
    }

    // Every distinct_from_live neighbour must actually EXIST, checked by id rather than inferred
    // from the envelope sweep below. The sweep only returns rows inside the bounding box with a
    // non-null coordinate, so a deleted or moved neighbour would otherwise surface as the gentle
    // "no longer load-bearing" report — indistinguishable from a pair the geocoder separated, when
    // in fact the row the adjudication was made about is gone. Mirrors the also_at_site assertion.
    for (const [listingId, d] of DISTINCT_BY_LISTING) {
      const { data: nb, error: e1e } = await conn.from('facility_listings').select('id, slug, status, osm_id, source').eq('id', listingId)
      if (e1e) { fail.push(`distinct_from_live check failed for ${listingId}: ${e1e.message}`); continue }
      if (nb.length !== 1) { fail.push(`distinct_from_live ${d.candidate_key} names listing_id ${listingId}, which matches ${nb.length} live rows — the row the adjudication describes no longer exists. Re-adjudicate.`); continue }
      if (nb[0].source === BATCH) { fail.push(`distinct_from_live ${d.candidate_key} names ${nb[0].slug}, which belongs to THIS batch (${BATCH}). Two rows in one batch are an internal-proximity question — use same_site_pairs, not this list.`); continue }
      console.log(`  distinct-from-live neighbour confirmed live: "${nb[0].slug}" (${nb[0].status}, osm_id ${nb[0].osm_id ?? 'NULL'}) — the case neither reconciles nor also_at_site can name`)
    }

    // Proximity to EVERY pre-existing listing in the envelope, recomputed live on every run.
    // Configured reconciles are allow-listed; anything else inside the radius is an OWNER decision,
    // never an auto-INSERT.
    const { data: near, error: e2 } = await conn.from('facility_listings')
      .select(`id, name, slug, lat, lng, status, source, osm_id, ${DISTINCT_NEIGHBOUR_COLUMNS.join(', ')}`)
      .gte('lat', ENVELOPE.latMin).lte('lat', ENVELOPE.latMax)
      .gte('lng', ENVELOPE.lngMin).lte('lng', ENVELOPE.lngMax)
      .not('lat', 'is', null).not('lng', 'is', null)
    if (e2) fail.push(`envelope proximity check failed: ${e2.message}`)
    else {
      const foreign = near.filter((r) => r.source !== BATCH)
      console.log(`  envelope holds ${near.length} live listing(s), ${foreign.length} from other batches`)
      for (const v of venues) {
        if (!v.coordinates?.lat) continue
        for (const r of foreign) {
          const d = metresBetween(v.coordinates.lat, v.coordinates.lng, r.lat, r.lng)
          if (d >= RECONCILE_RADIUS_M) continue
          const rec = reconcileFor(v)
          if (rec && r.osm_id === rec.osm_id) {
            console.log(`  reconcile confirmed live: ${v.research_key} is ${Math.round(d)} m from "${r.name}" (${r.osm_id})`)
            continue
          }
          const also = r.osm_id ? ALSO_AT_SITE_BY_OSM.get(r.osm_id) : null
          if (also && also.candidate_key === v.research_key) {
            alsoTripped.add(r.osm_id)
            console.log(`  also-at-site ADJUDICATED (${Math.round(d)} m): ${v.research_key} is near "${r.name}" (${r.osm_id}, ${r.slug}, ${r.status}) — ${also.verdict}, disposition ${also.disposition}, by ${also.adjudicated_by || 'unrecorded'} on ${also.adjudicated_on}`)
            console.log(`    evidence: ${also.evidence_url}`)
            if (also.note) console.log(`    ${also.note}`)
            console.log(`    reconcile_radius_m stays ${RECONCILE_RADIUS_M} m — this ONE row is allow-listed by osm_id; the guard is unchanged for every other neighbour in this metro.`)
            continue
          }
          // The third hatch: an adjudication that these are two DISTINCT venues, naming the
          // neighbour by listing_id because a published research-sourced row has no osm_id for the
          // other two hatches to key on. Every claim it makes is settled against the live row here,
          // never taken from the config.
          const distinct = DISTINCT_BY_LISTING.get(r.id)
          if (distinct && distinct.candidate_key === v.research_key) {
            distinctTripped.add(r.id)
            const res = verifyDistinctFromLive(distinct, { venue: { zip: v.zip, access_type: fieldVal(v.access_type) }, neighbour: r })
            console.log(`  distinct-from-live ADJUDICATED (${Math.round(d)} m): ${v.research_key} vs "${r.name}" (${r.slug}, ${r.status}) — ${distinct.verdict} by ${distinct.adjudicated_by || 'unrecorded'} on ${distinct.adjudicated_on}`)
            console.log(`    evidence: ${distinct.evidence_url}`)
            if (distinct.note) console.log(`    ${distinct.note}`)
            res.verified.forEach((x) => console.log(`    VERIFIED against live data — ${x}`))
            if (res.declared.length) console.log(`    declared (rests on the adjudicator's evidence, not machine-checked): ${res.declared.join(', ')}`)
            console.log(`    reconcile_radius_m stays ${RECONCILE_RADIUS_M} m — this ONE neighbour is allow-listed by listing_id; the guard is unchanged for every other row in this metro.`)
            res.failures.forEach((f) => fail.push(f))
            continue
          }
          fail.push(`${v.research_key} is ${Math.round(d)} m from live listing "${r.name}" (${r.slug}, ${r.status}) — that is a RECONCILE decision for the owner, not an INSERT`)
        }
      }
      // Validation 4: an allow-list entry that no longer suppresses anything is reported, never
      // carried silently. Mirrors the same_site_pairs report.
      for (const [osmId, a] of ALSO_AT_SITE_BY_OSM) {
        if (!alsoTripped.has(osmId)) {
          console.log(`  also_at_site ${osmId} (${a.candidate_key}) is allow-listed but did NOT trip the ${RECONCILE_RADIUS_M} m guard — the entry is harmless but no longer load-bearing.`)
        }
      }
      // Same report for the third list. An adjudication that no longer suppresses anything is worth
      // knowing about — the geocoder may legitimately have separated the pair since it was made.
      for (const [listingId, d] of DISTINCT_BY_LISTING) {
        if (!distinctTripped.has(listingId)) {
          console.log(`  distinct_from_live ${d.slug} (${d.candidate_key}) is allow-listed but did NOT trip the ${RECONCILE_RADIUS_M} m guard — the entry is harmless but no longer load-bearing.`)
        }
      }
    }

    const { data: kc, error: e3 } = await conn.from('facility_candidates').select('candidate_key').in('candidate_key', keys)
    if (e3) fail.push(`candidate_key collision check failed: ${e3.message}`)
    else if (candidateKeys === 'absent' && kc.length) fail.push(`candidate_key collisions live (candidates already seeded?): ${kc.map((r) => r.candidate_key).join(', ')}`)
    else if (candidateKeys === 'present' && kc.length !== keys.length) fail.push(`expected all ${EXPECTED_COUNT} candidate_keys to exist before the listings stage, found ${kc.length}`)
  }

  console.log(`pre-flight: ${venues.length} venues · status ${JSON.stringify(dist)} · ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : `${fail.length} FAILURES ✗`}`)
  if (fail.length) { fail.forEach((f) => console.error(`  ✗ ${f}`)); console.error('\nABORT: pre-flight failed. Fix the input or the schema — never relax an assertion to make a run pass.'); process.exit(1) }
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------
console.log(`\n=== import-metro-merged · metro=${METRO_KEY} · stage=${STAGE} · ${STAGE === 'project' || STAGE === 'verify' ? 'READ-ONLY' : DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`config: ${CONFIG_PATH} · input: ${INPUT} · batch: ${BATCH} · metro_area: ${METRO} · states: ${[...STATES].join('/')}`)
if (excludedPresent.length) {
  console.log(`EXCLUDED from this run (${excludedPresent.length} of ${allVenues.length} artifact venues — no candidate row, no listing row, no reconcile):`)
  excludedPresent.forEach((k) => console.log(`  ! ${k} — ${EXCLUDE.get(k)}`))
}
console.log('')

// ---- project: the gate computed from the ARTIFACT, before anything is imported ----------------
if (STAGE === 'project') {
  await preflight({ checkCollisions: false })

  const eligible = [], blocked = []
  for (const v of venues) {
    const reasons = gateReasons({
      name: fieldVal(v.name), lat: v.coordinates?.lat, lng: v.coordinates?.lng,
      city: v.city, slug: v.slug, research_status: v.research_status,
    })
    ;(reasons.length ? blocked : eligible).push({ slug: v.slug, key: v.research_key, name: fieldVal(v.name), reasons })
  }

  console.log(`\ngate = ${GATE_TEXT}\n`)
  console.log(`PROJECTED PUBLISH: ${eligible.length}/${venues.length}`)
  eligible.forEach((e) => console.log(`  + ${e.slug.padEnd(56)} ${e.name}`))
  console.log(`PROJECTED HELD (import as draft): ${blocked.length}/${venues.length}`)
  blocked.forEach((b) => console.log(`  - ${b.slug.padEnd(56)} ${b.reasons.join('; ')}`))

  const precision = venues.reduce((a, v) => (a[String(v.coordinates?.precision)] = (a[String(v.coordinates?.precision)] || 0) + 1, a), {})
  const pts = venues.filter((v) => v.coordinates?.lat != null)
  if (pts.length) {
    const lats = pts.map((v) => v.coordinates.lat), lngs = pts.map((v) => v.coordinates.lng)
    const pad = (n) => Math.round(n * 100) / 100
    console.log(`\nOBSERVED bbox over ${pts.length} geocoded venue(s): lat ${Math.min(...lats).toFixed(4)}..${Math.max(...lats).toFixed(4)} · lng ${Math.min(...lngs).toFixed(4)}..${Math.max(...lngs).toFixed(4)}`)
    console.log(`  suggested envelope (observed + ~0.15 deg margin, TIGHTEN AGAINST THE MSA COUNTY LIST BEFORE IMPORT):`)
    console.log(`  "envelope": { "latMin": ${pad(Math.min(...lats) - 0.15)}, "latMax": ${pad(Math.max(...lats) + 0.15)}, "lngMin": ${pad(Math.min(...lngs) - 0.15)}, "lngMax": ${pad(Math.max(...lngs) + 0.15)} }`)
  }
  console.log(`coordinate precision: ${JSON.stringify(precision)}`)

  // Adopted coordinates are the one class of pin in a batch that a fresh geocode will NOT reproduce,
  // so they are surfaced at the metro's go-gate rather than left to be discovered in provenance.
  const adopted = venues.filter((v) => v.coordinates?.adopted_from)
  if (adopted.length) {
    console.log(`\nADOPTED COORDINATES (${adopted.length}) — pin taken from a named OSM feature the query ladder could not reach:`)
    for (const v of adopted) {
      const a = v.coordinates.adopted_from
      console.log(`  ~ ${v.research_key.padEnd(52)} ${a.osm_id} "${a.osm_feature_name}" -> ${v.coordinates.precision}`)
      console.log(`      superseded ${a.superseded.precision} at ${a.moved_m} m · cross-check ${a.crosscheck_delta_m} m · ${a.adjudicated_by} on ${a.adjudicated_on}`)
      console.log(`      evidence: ${a.evidence_url}`)
      if (a.matches_reconcile_target === true) console.log(`      corroborated: the SAME OSM feature this row reconciles onto`)
      if (a.matches_reconcile_target === false) console.log(`      REVIEW: reconciles onto ${a.reconcile_target_osm_id} but adopts ${a.osm_id}`)
    }
  }
  console.log(`access_type: ${JSON.stringify(venues.reduce((a, v) => (a[String(fieldVal(v.access_type))] = (a[String(fieldVal(v.access_type))] || 0) + 1, a), {}))}`)
  console.log(`fee_type:    ${JSON.stringify(venues.reduce((a, v) => (a[String(fieldVal(v.fee_type))] = (a[String(fieldVal(v.fee_type))] || 0) + 1, a), {}))}`)
  console.log(`research_status: ${JSON.stringify(venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {}))}`)

  const agg = venues.filter((v) => v._workbook?.aggregator_urls)
  console.log(`\nADR-14: ${agg.length} venue(s) cite a tier-4 aggregator anywhere in their evidence${agg.length ? ` (${agg.map((v) => v.research_key).join(', ')})` : ''}`)
  console.log(`        aggregator URL on a user-facing column of a projected-publish row: NONE (preflight asserts it)`)
  console.log(`document URL (PDF/agenda/minutes) in website: NONE on any row in this batch (preflight asserts it)`)

  if (!reportExpected(assertExpectedPublish(eligible.map((e) => e.slug), blocked))) process.exit(1)
  console.log('\nREAD-ONLY — no database connection was opened and nothing was written.')
}

if (STAGE === 'candidates') {
  await preflight({ checkCollisions: true, candidateKeys: 'absent' })
  const conn = connect()
  const dist = candidateRows.reduce((a, r) => (a[r.research_status] = (a[r.research_status] || 0) + 1, a), {})
  console.log(`\nTO INSERT into facility_candidates: ${candidateRows.length}`)
  console.log(`  research_status: ${JSON.stringify(dist)}`)
  console.log(`  address_source:  ${JSON.stringify(candidateRows.reduce((a, r) => (a[r.address_source] = (a[r.address_source] || 0) + 1, a), {}))}`)
  console.log(`  with coords ${candidateRows.filter((r) => r.lat != null).length}/${EXPECTED_COUNT} · with address ${candidateRows.filter((r) => r.address).length}/${EXPECTED_COUNT} · reconcile ${candidateRows.filter((r) => r.existing_listing_id).length}/${EXPECTED_COUNT}`)
  console.log(`\nall ${EXPECTED_COUNT} rows:`)
  candidateRows.forEach((r) => console.log(`  + ${r.candidate_key.padEnd(36)} "${r.proposed_name}" | ${r.city}, ${r.state} | ${r.research_status}${r.existing_listing_id ? ` | RECONCILE->${r.existing_listing_id}` : ''}`))

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await conn.from('facility_candidates').insert(candidateRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await conn.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  console.log(`\ninserted ${candidateRows.length} rows · facility_candidates batch='${BATCH}' now: ${count}`)
}

if (STAGE === 'listings') {
  await preflight({ checkCollisions: true, candidateKeys: 'present' })
  const conn = connect()
  const { count: candCount } = await conn.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  if (candCount !== EXPECTED_COUNT) { console.error(`\nABORT: expected ${EXPECTED_COUNT} candidates for batch '${BATCH}', found ${candCount}. Run --stage=candidates first.`); process.exit(1) }

  const tally = (fn) => JSON.stringify(listingRows.reduce((a, r) => (a[String(fn(r))] = (a[String(fn(r))] || 0) + 1, a), {}))
  console.log(`\nTO INSERT into facility_listings: ${listingRows.length} (status='draft', source='${BATCH}')`)
  console.log(`  access_type:         ${tally((r) => r.access_type)}`)
  console.log(`  fee_type:            ${tally((r) => r.fee_type)}`)
  console.log(`  reservation_policy:  ${tally((r) => r.reservation_policy)}`)
  console.log(`  indoor:              ${tally((r) => r.indoor)}`)
  console.log(`  surface:             ${tally((r) => r.surface)}`)
  console.log(`  court_configuration: ${tally((r) => r.court_configuration)}`)
  console.log(`  net_setup:           ${tally((r) => r.net_setup)}`)
  console.log(`  coord precision:     ${tally((r) => r.provenance?.coordinate?.precision)}`)
  console.log(`  court_count present ${listingRows.filter((r) => r.court_count != null).length}/${listingRows.length} · website ${listingRows.filter((r) => r.website).length}/${listingRows.length} · phone ${listingRows.filter((r) => r.phone).length}/${listingRows.length}`)
  console.log(`  low-precision coord (publishes WITH the approximate-location label, ADR-16): ${listingRows.filter((r) => isApproximateLocation(r.provenance?.coordinate?.precision)).map((r) => r.slug).join(', ') || 'none'}`)
  console.log(`  probable rows (PUBLISH under ADR-17, tiered 'listed'): ${listingRows.filter((r) => r.provenance?.research_status_at_import === 'probable').map((r) => r.slug).join(', ') || 'none'}`)
  console.log(`  verification_status: ${tally((r) => r.verification_status)}`)
  console.log(`  ODbL-coordinate rows: ${listingRows.filter((r) => r.provenance.odbl).length}/${listingRows.length}`)

  // The UPDATE payload is the MERGED fields, not listingFields() alone. The target row was captured
  // live by preflight; if it is somehow missing, fail closed rather than issue an UPDATE built from
  // a row we never read — that is precisely the blind overwrite this merge exists to stop.
  const reconcilePlans = reconcileVenues.map((v) => {
    const rec = reconcileFor(v)
    const target = RECONCILE_TARGET_BY_OSM.get(rec.osm_id) || null
    if (!target) {
      console.error(`\nABORT: preflight captured no live target row for reconcile ${rec.candidate_key} (${rec.osm_id}). Refusing to build an UPDATE from a row that was never read.`)
      process.exit(1)
    }
    const { fields, preserved } = mergeOntoTarget(listingFields(v), target, rec, nowIso)
    // An acknowledged coordinate trade rides ON THE ROW it degraded, next to the osm_original that
    // makes it recoverable. A decision recorded only in a config is a decision the next reader of
    // this listing will never find.
    const trade = RECONCILE_TRADE_BY_OSM.get(rec.osm_id)
    if (trade && fields.provenance?.osm_reconcile) fields.provenance.osm_reconcile.coordinate_trade = trade
    return { v, rec, target, fields, preserved, trade }
  })
  for (const { v, rec, fields, preserved, trade } of reconcilePlans) {
    const o = v.reconcile?.osm_original || rec.osm_original || {}
    if (trade) {
      console.log(`\n  ⚠ COORDINATE TRADE (acknowledged) — ${rec.candidate_key}: this UPDATE replaces the target's coordinate`)
      console.log(`      ${trade.superseded.lat},${trade.superseded.lng} -> ${fields.lat},${fields.lng} (${trade.incoming_precision}, ${trade.distance_m} m)`)
      console.log(`      accepted by ${trade.adjudicated_by} on ${trade.adjudicated_on}: ${trade.reason}`)
      console.log(`      the superseded value stays recoverable at ${trade.recoverable_from}`)
    }
    console.log(`\nTO UPDATE (reconcile, NOT insert) — ${rec.candidate_key} onto the dormant OSM row:`)
    console.log(`  where osm_id='${rec.osm_id}' and status='draft'  (id=${rec.listing_id})`)
    console.log(`  BEFORE: name="${o.name ?? '?'}"  slug="${o.slug ?? '?'}"  source="${o.source ?? '?'}"  access_type="${o.access_type ?? '?'}"`)
    console.log(`  AFTER:  name="${fields.name}"  slug="${fields.slug}"  source="${fields.source}"  access_type="${fields.access_type}"  metro_area="${fields.metro_area}"  fee_type=${fields.fee_type}`)
    console.log(`          a reconcile must patch EVERY gate-relevant field, not just name/slug/source, or the row silently stays draft`)
    console.log(`          osm_id PRESERVED (${rec.osm_id}) · OSM original stashed in provenance.osm_reconcile.osm_original · ODbL marker set`)
    console.log(`  PRESERVED FROM THE OSM ROW (${Object.keys(preserved).length}): ${preservedSummary(preserved) || 'none — the research row carries a value for every field the target holds'}`)
    console.log(`          merge policy: incoming_wins_unless_null · read from the LIVE row, not config.osm_original · recorded at provenance.osm_reconcile.preserved_fields`)
    if (preserved.address) {
      console.log(`          address_source='osm' (ADR-12, pinned vocabulary) · address_verified_at NOT stamped today — kept at ${JSON.stringify(fields.address_verified_at)}`)
    }
    console.log(`          adjudicated by ${rec.adjudicated_by || 'unrecorded'} on ${rec.adjudicated_on} · evidence ${rec.evidence_url}${rec.confidence ? ` · confidence ${rec.confidence}` : ''}`)
    for (const a of rec.also_at_site || []) {
      console.log(`  NOT TOUCHED (same site, left dormant): ${a.osm_id} id=${a.listing_id} — ${a.verdict}, ${a.disposition}, adjudicated ${a.adjudicated_on}. No UPDATE and no INSERT targets this row.`)
    }
  }

  if (DRY_RUN) { console.log(`\nDRY RUN — nothing written (0 INSERT, 0 UPDATE).`); process.exit(0) }

  const { error: insErr } = await conn.from('facility_listings').insert(listingRows)
  if (insErr) { console.error('\nINSERT failed (atomic — nothing inserted):', insErr.message); process.exit(1) }
  console.log(`\ninserted ${listingRows.length} draft rows`)

  for (const { rec, fields } of reconcilePlans) {
    const { data: upd, error: updErr } = await conn.from('facility_listings')
      .update(fields).eq('osm_id', rec.osm_id).eq('status', 'draft').select('id, slug, name, source, access_type')
    if (updErr) { console.error(`\nreconcile UPDATE failed for ${rec.candidate_key}:`, updErr.message); process.exit(1) }
    if (!upd || upd.length !== 1) { console.error(`\nreconcile UPDATE for ${rec.candidate_key} affected ${upd?.length ?? 0} rows (expected exactly 1) — investigate; the OSM row may have been published or removed.`); process.exit(1) }
    console.log(`reconciled 1 row: ${upd[0].slug} (access_type now "${upd[0].access_type}", source now "${upd[0].source}")`)
  }

  const { count } = await conn.from('facility_listings').select('*', { count: 'exact', head: true }).eq('source', BATCH)
  console.log(`facility_listings source='${BATCH}' now: ${count} (expect ${EXPECTED_COUNT} = ${listingRows.length} insert + ${reconcilePlans.length} reconcile)`)
  console.log(`REMINDER: the site-wide listings total must have risen by ${listingRows.length}, NOT ${EXPECTED_COUNT}. A +${EXPECTED_COUNT} means a reconcile became an INSERT.`)
}

if (STAGE === 'publish') {
  const conn = connect()
  const { data: rows, error: rErr } = await conn.from('facility_listings')
    .select('id, slug, name, lat, lng, city, access_type, status, website, name_source_url, provenance').eq('source', BATCH)
  if (rErr) { console.error('listing read failed:', rErr.message); process.exit(1) }
  const { data: cands, error: cErr } = await conn.from('facility_candidates')
    .select('id, candidate_key, research_status, published_listing_id').eq('batch', BATCH)
  if (cErr) { console.error('candidate read failed:', cErr.message); process.exit(1) }
  if (rows.length !== EXPECTED_COUNT || cands.length !== EXPECTED_COUNT) { console.error(`\nABORT: expected ${EXPECTED_COUNT}/${EXPECTED_COUNT}, found listings=${rows.length} candidates=${cands.length}. Run the earlier stages first.`); process.exit(1) }

  const candByKey = new Map(cands.map((c) => [c.candidate_key, c]))
  const eligible = [], blocked = []
  for (const r of rows) {
    const key = r.provenance?.candidate_key
    const cand = key ? candByKey.get(key) : null
    // A candidate already flipped to 'published' by a previous run still satisfies the gate — the
    // stage is idempotent, so re-running it must not reclassify rows it already published.
    const effectiveStatus = cand ? (cand.research_status === 'published' ? 'verified' : cand.research_status) : null
    const reasons = gateReasons({
      name: r.name, lat: r.lat, lng: r.lng, city: r.city, slug: r.slug,
      research_status: effectiveStatus, hasCandidate: !!cand,
    })
    ;(reasons.length ? blocked : eligible).push({ row: r, cand, slug: r.slug, reasons })
  }

  const adr14 = eligible.filter(({ row }) => AGGREGATOR_HOST.test(row.website || '') || AGGREGATOR_HOST.test(row.name_source_url || ''))
  // Re-checked here against the DATABASE, not the artifact, because preflight can only speak for
  // rows imported after it existed. A row imported earlier — or one held back then and unblocked
  // since by a coordinate fix — reaches publish without ever having faced the preflight check.
  const docUrls = eligible.filter(({ row }) => DOCUMENT_URL.test(row.website || ''))

  console.log(`gate = ${GATE_TEXT}\n`)
  console.log(`ELIGIBLE → publish: ${eligible.length}`)
  eligible.forEach(({ row }) => console.log(`  + ${row.slug}`))
  console.log(`BLOCKED  → stay draft: ${blocked.length}`)
  blocked.forEach(({ row, reasons }) => console.log(`  - ${row.slug} — ${reasons.join('; ')}`))
  console.log(`\nADR-14 aggregator scan over publishing rows: ${adr14.length === 0 ? 'CLEAN ✓' : 'VIOLATIONS ✗'}`)
  adr14.forEach(({ row }) => console.error(`  ✗ ${row.slug}: website=${row.website} name_source_url=${row.name_source_url}`))
  if (adr14.length) { console.error('\nABORT: an aggregator URL would land on a user-facing column of a published row (ADR-14).'); process.exit(1) }
  console.log(`document-URL scan over publishing rows: ${docUrls.length === 0 ? 'CLEAN ✓' : 'VIOLATIONS ✗'}`)
  docUrls.forEach(({ row }) => console.error(`  ✗ ${row.slug}: website=${row.website}`))
  if (docUrls.length) { console.error('\nABORT: a document (PDF/agenda/minutes) would publish as a venue website. Fix the row, or null its website — a wrong link is worse than none.'); process.exit(1) }
  console.log(`ODbL-coordinate rows among the publishing set: ${eligible.filter(({ row }) => row.provenance?.odbl).length} — attribution renders via OsmAttribution.`)

  const expOk = reportExpected(assertExpectedPublish(eligible.map((e) => e.slug), blocked))
  if (!expOk) process.exit(1)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }

  const ids = eligible.map(({ row }) => row.id)
  const { error: pErr } = await conn.from('facility_listings')
    .update({ status: 'published', verified_at: nowIso, verified_by: BATCH }).in('id', ids)
  if (pErr) { console.error('\npublish update failed:', pErr.message); process.exit(1) }
  console.log(`\npublished ${ids.length} listings`)

  let linked = 0
  for (const { row, cand } of eligible) {
    const { error } = await conn.from('facility_candidates')
      .update({ published_listing_id: row.id, research_status: 'published' }).eq('id', cand.id)
    if (error) { console.error(`  backlink failed for ${cand.candidate_key}:`, error.message); continue }
    linked++
  }
  console.log(`backlinked ${linked}/${eligible.length} candidates (published_listing_id + research_status='published')`)
  if (linked !== eligible.length) { console.error('\nWARNING: backlink incomplete — re-run --stage=publish (idempotent).'); process.exit(1) }
}

// A publish is not visible until the directory cache knows about it — every read in
// lib/directory/loadFacilities.ts is unstable_cache'd for 6h under the 'directory' tag and this
// script writes straight to Postgres, so /courts/in/<slug> hard-404s until the TTL lapses.
// Marks the run failed without aborting — the rows ARE published.
if (STAGE === 'publish' && !DRY_RUN) {
  const rv = await revalidateDirectory({ metroArea: METRO })
  if (!rv.ok) process.exitCode = 1
}

if (STAGE === 'verify') {
  const conn = connect()
  const { data: rows } = await conn.from('facility_listings')
    .select('id, slug, status, source, metro_area, state, lat, lng, access_type, fee_type, reservation_policy, surface, court_configuration, line_type, net_setup, court_count, indoor, verification_status, osm_id, verified_by, website, name_source_url, provenance, address, address_source, address_verified_at, city, zip, lighting, reservation_url, phone, public_notes, google_place_id, location_id, location_precision').eq('source', BATCH)
  const { data: cands } = await conn.from('facility_candidates')
    .select('candidate_key, research_status, published_listing_id, existing_listing_id, metro_area').eq('batch', BATCH)
  const byStatus = (arr, k) => arr.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {})
  const listingIds = new Set(rows.map((r) => r.id))
  const published = rows.filter((r) => r.status === 'published')
  const expHold = config.expected_publish?.hold || {}

  const checks = [
    [`facility_listings rows for batch = ${EXPECTED_COUNT}`, rows.length === EXPECTED_COUNT, rows.length],
    [`facility_candidates rows for batch = ${EXPECTED_COUNT}`, cands.length === EXPECTED_COUNT, cands.length],
    ['every listing source = batch tag (never "osm")', rows.every((r) => r.source === BATCH), byStatus(rows, 'source')],
    [`every listing metro_area = ${METRO}`, rows.every((r) => r.metro_area === METRO), byStatus(rows, 'metro_area')],
    ['every candidate metro_area matches', cands.every((c) => c.metro_area === METRO), byStatus(cands, 'metro_area')],
    [`every listing state in ${[...STATES].join('/')}`, rows.every((r) => STATES.has(r.state)), byStatus(rows, 'state')],
    ['every fee_type is a live enum value', rows.every((r) => r.fee_type == null || LIVE.fee_type.has(r.fee_type)), byStatus(rows, 'fee_type')],
    ['every access_type is a live enum value', rows.every((r) => LIVE.access_type.has(r.access_type)), byStatus(rows, 'access_type')],
    ['every reservation_policy is a live enum value', rows.every((r) => r.reservation_policy == null || LIVE.reservation_policy.has(r.reservation_policy)), byStatus(rows, 'reservation_policy')],
    ['every surface is a live enum value or null', rows.every((r) => r.surface == null || LIVE.surface.has(r.surface)), byStatus(rows, 'surface')],
    ['every court_configuration is a live enum value', rows.every((r) => r.court_configuration == null || LIVE.court_configuration.has(r.court_configuration)), byStatus(rows, 'court_configuration')],
    ['every line_type is a live enum value', rows.every((r) => r.line_type == null || LIVE.line_type.has(r.line_type)), byStatus(rows, 'line_type')],
    ['every net_setup is a live enum value', rows.every((r) => r.net_setup == null || LIVE.net_setup.has(r.net_setup)), byStatus(rows, 'net_setup')],
    ['every indoor value is boolean or null', rows.every((r) => r.indoor == null || typeof r.indoor === 'boolean'), byStatus(rows, 'indoor')],
    // ADR-18 REPLACED THIS ASSERTION. It used to demand source_verified on every row, which was only
    // true while the gate required research_status='verified'. The tier is now derived, so what must
    // hold is (a) the pipeline never writes a tier outside its vocabulary — human_verified in
    // particular is a human's word and no script may claim it — and (b) every row's tier agrees with
    // the research_status it was imported under. A row tiered source_verified off a `probable`
    // candidate is the failure mode: a column asserting a controlling-entity source that nobody has.
    ['verification_status is one this pipeline may write', rows.every((r) => PIPELINE_VERIFICATION_STATUS.has(r.verification_status)), byStatus(rows, 'verification_status')],
    ['verification_status matches research_status_at_import (ADR-18)', rows.every((r) => r.verification_status === verificationStatusFor(r.provenance?.research_status_at_import)), rows.filter((r) => r.verification_status !== verificationStatusFor(r.provenance?.research_status_at_import)).map((r) => `${r.slug}:${r.verification_status}/${r.provenance?.research_status_at_import}`)],
    ['every listing has provenance with a candidate_key', rows.every((r) => r.provenance?.candidate_key), rows.filter((r) => !r.provenance?.candidate_key).length + ' missing'],
    ['every listing has a per-field evidence map', rows.every((r) => r.provenance?.fields && Object.keys(r.provenance.fields).length), rows.filter((r) => !Object.keys(r.provenance?.fields || {}).length).length + ' missing'],
    ['every listing carries the ODbL marker', rows.every((r) => r.provenance?.odbl), rows.filter((r) => !r.provenance?.odbl).length + ' missing'],
    ['every coordinate origin is nominatim', rows.filter((r) => r.lat != null).every((r) => r.provenance?.coordinate?.origin === 'nominatim'), byStatus(rows.map((r) => ({ o: r.provenance?.coordinate?.origin })), 'o')],
    ['no coordinate is Places-derived (ADR-12)', rows.every((r) => !/places|google/i.test(r.provenance?.coordinate?.origin || '')), 'ok'],
    ['every slug follows <name>-<city>-<state>', rows.every((r) => r.slug.endsWith(`-${String(r.state).toLowerCase()}`)), rows.filter((r) => !r.slug.endsWith(`-${String(r.state).toLowerCase()}`)).map((r) => r.slug)],
    ['no published row lacks a coordinate', published.every((r) => r.lat != null && r.lng != null), 'ok'],
    // ADR-16 INVERTED THIS ASSERTION. It used to read "no published row has a low-precision
    // coordinate"; a low-precision row now publishes behind the approximate-location label, so the
    // old form would fail on every run. What still must hold is that every such row is LABELLABLE —
    // i.e. the derived location_precision the render layer reads agrees with the provenance the
    // geocoder wrote. A row published as approximate whose column says otherwise would render an
    // unlabelled approximate pin, which is the exact harm this slice exists to prevent.
    ['every published low-precision row is labelled approximate', published.filter((r) => isApproximateLocation(r.provenance?.coordinate?.precision)).every((r) => isApproximateLocation(r.location_precision)), published.filter((r) => isApproximateLocation(r.provenance?.coordinate?.precision) && !isApproximateLocation(r.location_precision)).map((r) => r.slug)],
    ['published rows carrying the approximate-location label', true, `${published.filter((r) => isApproximateLocation(r.location_precision)).length} of ${published.length}`],
    // ADR-17 REPLACED BOTH OF THE ASSERTIONS THAT USED TO SIT HERE. They read "no published row has
    // access_type unknown" and "no published row came from a probable candidate" — both encoded the
    // 2026-07-28 gate and would now fail on every run. They are replaced rather than deleted, because
    // what they were really protecting still needs protecting: that a published row's access_type is
    // a value the UI can render, and that an unproven row is HONESTLY LABELLED rather than silently
    // promoted. Coverage-first changed which rows publish, not whether the directory tells the truth.
    ['every published access_type is a live enum value the UI can label', published.every((r) => LIVE.access_type.has(r.access_type)), byStatus(published, 'access_type')],
    ["every published row from a non-verified candidate is tiered 'listed' (ADR-18)", published.filter((r) => r.provenance?.research_status_at_import !== 'verified').every((r) => r.verification_status === 'listed'), published.filter((r) => r.provenance?.research_status_at_import !== 'verified' && r.verification_status !== 'listed').map((r) => r.slug)],
    ['no published row came from a BLOCKING research_status (ADR-17 correctness verdicts)', published.every((r) => !BLOCKING_RESEARCH_STATUS.has(r.provenance?.research_status_at_import)), published.filter((r) => BLOCKING_RESEARCH_STATUS.has(r.provenance?.research_status_at_import)).map((r) => r.slug)],
    ['no published row carries an aggregator URL on a user-facing column (ADR-14)', published.every((r) => !AGGREGATOR_HOST.test(r.website || '') && !AGGREGATOR_HOST.test(r.name_source_url || '')), published.filter((r) => AGGREGATOR_HOST.test(r.website || '') || AGGREGATOR_HOST.test(r.name_source_url || '')).map((r) => r.slug)],
    ['no published row carries a document URL in website', published.every((r) => !DOCUMENT_URL.test(r.website || '')), published.filter((r) => DOCUMENT_URL.test(r.website || '')).map((r) => r.slug)],
    ['draft rows carry verified_by = NULL (reconcile-gate safety)', rows.filter((r) => r.status === 'draft').every((r) => r.verified_by == null), 'ok'],
    ['published candidates ↔ published listings agree', cands.filter((c) => c.research_status === 'published').length === published.length, `${cands.filter((c) => c.research_status === 'published').length} vs ${published.length}`],
    ['every published_listing_id points at a real batch listing', cands.filter((c) => c.published_listing_id).every((c) => listingIds.has(c.published_listing_id)), 'ok'],
    ['no unpublished candidate carries published_listing_id', cands.filter((c) => c.research_status !== 'published').every((c) => c.published_listing_id == null), 'ok'],
  ]

  // Per-reconcile assertions, generated from the config rather than hardcoded per metro.
  for (const rec of RECONCILES) {
    const recRow = rows.find((r) => r.osm_id === rec.osm_id)
    checks.push([`reconciled row present for ${rec.candidate_key} (osm_id preserved)`, !!recRow, recRow ? recRow.slug : 'MISSING'])
    checks.push([`reconciled row ${rec.candidate_key} carries osm_reconcile provenance`, !!recRow && recRow.provenance?.osm_reconcile?.osm_id === rec.osm_id, 'ok'])
    checks.push([`reconciled row ${rec.candidate_key} access_type is not unknown`, !!recRow && recRow.access_type !== 'unknown', recRow ? recRow.access_type : 'n/a'])

    // The merge must leave a record even when it kept nothing, so its absence means the merge never
    // ran — which on a reconciled row is itself the defect.
    const pf = recRow?.provenance?.osm_reconcile?.preserved_fields
    checks.push([`reconciled row ${rec.candidate_key} records preserved_fields (merge ran)`,
      !!recRow && pf != null && typeof pf === 'object',
      pf ? `${Object.keys(pf).length} preserved` : 'MISSING — merge did not run'])
    if (recRow && pf && typeof pf === 'object') {
      const blanked = Object.keys(pf).filter((f) => recRow[f] == null)
      checks.push([`reconciled row ${rec.candidate_key} still holds every preserved field`,
        blanked.length === 0, blanked.length ? `BLANKED: ${blanked.join(', ')}` : 'ok'])
      const mismatched = Object.keys(pf).filter((f) => recRow[f] != null && recRow[f] !== pf[f].value)
      checks.push([`reconciled row ${rec.candidate_key} preserved values match what was recorded`,
        mismatched.length === 0, mismatched.length ? `DIVERGED: ${mismatched.join(', ')}` : 'ok'])
      // A field outside the allow-list means someone widened the merge without widening this check.
      // access_type is the one that matters: preserving it would silently un-publish the row by
      // keeping the target's 'unknown', which is exactly what the reconcile exists to overwrite.
      const illegal = Object.keys(pf).filter((f) => !PRESERVE_ON_RECONCILE.includes(f))
      checks.push([`reconciled row ${rec.candidate_key} preserved only allow-listed fields`,
        illegal.length === 0, illegal.length ? `NOT PRESERVABLE: ${illegal.join(', ')}` : 'ok'])
      if (pf.address) {
        checks.push([`reconciled row ${rec.candidate_key} preserved address carries address_source='osm' (ADR-12)`,
          recRow.address_source === 'osm', recRow.address_source])
      }
    }
  }
  checks.push([`exactly ${RECONCILES.length} row(s) carry an osm_id`, rows.filter((r) => r.osm_id != null).length === RECONCILES.length, rows.filter((r) => r.osm_id != null).map((r) => r.slug)])
  checks.push([`exactly ${RECONCILES.length} candidate(s) carry existing_listing_id`, cands.filter((c) => c.existing_listing_id != null).length === RECONCILES.length, cands.filter((c) => c.existing_listing_id != null).map((c) => c.candidate_key)])

  // Expected-hold assertions, generated from the config.
  for (const [slug, reason] of Object.entries(expHold)) {
    const row = rows.find((r) => r.slug === slug)
    checks.push([`expected-hold "${slug}" is still draft (${reason})`, !!row && row.status === 'draft', row ? row.status : 'ROW MISSING'])
  }
  if (config.expected_publish?.count != null) {
    checks.push([`published count = ${config.expected_publish.count}`, published.length === config.expected_publish.count, published.length])
  }

  console.log(`listing status: ${JSON.stringify(byStatus(rows, 'status'))}`)
  console.log(`candidate research_status: ${JSON.stringify(byStatus(cands, 'research_status'))}`)
  console.log(`coordinate precision: ${JSON.stringify(rows.reduce((a, r) => (a[String(r.provenance?.coordinate?.precision)] = (a[String(r.provenance?.coordinate?.precision)] || 0) + 1, a), {}))}`)
  console.log(`surface populated: ${rows.filter((r) => r.surface != null).length}/${EXPECTED_COUNT} · court_count present: ${rows.filter((r) => r.court_count != null).length}/${EXPECTED_COUNT}\n`)
  let bad = 0
  for (const [label, ok, detail] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) bad++ }
  console.log(`\n${bad === 0 ? `ALL ${checks.length} CHECKS PASS ✓` : `${bad}/${checks.length} CHECKS FAILED ✗`}`)
  if (bad) process.exit(1)
}

console.log('\nDONE.')
