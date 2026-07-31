/**
 * Directory — import + publish the Little Rock–North Little Rock–Conway, AR verified venue set
 * (batch `little-rock-2026-07-30`).
 *
 * Input: little-rock-count/little-rock-candidates.json — 19 venues (17 verified + 2 probable) from
 * the "Little Rock–North Little Rock–Conway, AR — Pickleball Venue Research" workbook, with 6 owner
 * decisions applied (approved 2026-07-30). The artifact is gitignored: research working data, and the
 * workbook's held-back Candidates tab cites openstreetmap.org / mysaline.com only on several rows
 * (tier-4 / secondary — ADR-14 private research input, never republished).
 *
 * Mirrors scripts/import-daytona-merged.mjs (reconcile skeleton), NOT the pure-greenfield Reno /
 * Greensboro shape, because one venue merges onto a pre-existing dormant OSM listing:
 *   LR-018 Conway Community Center -> osm_id='way/1498910770' (listing 8e16118a-…), matched at 2 m.
 * So the listings stage is 18 INSERT + 1 UPDATE, and the site-wide listings delta must be +18, not
 * +19. The batch-scoped count is 19 either way, so the verify stage structurally cannot catch a
 * reconcile that silently became an INSERT — only the total delta can. Capture it before applying.
 *
 * Four stages, each independently dry-runnable, run in this order:
 *   --stage=candidates  19 rows -> facility_candidates (staging / work queue). One atomic INSERT.
 *   --stage=listings    18 rows -> facility_listings status='draft' (one atomic INSERT) + the
 *                       Conway reconcile UPDATE keyed on osm_id (separate statement).
 *   --stage=publish     recompute the gate FROM THE DATABASE, flip qualifying rows to
 *                       status='published', then backlink published_listing_id + research_status.
 *   --stage=verify      read-only post-write assertions (no writes in any mode).
 *
 * WRITE SAFETY: every write sits AFTER an `if (DRY_RUN) { ...; process.exit(0) }` guard. In --dry-run
 * the process exits before any write is issued. Only SELECTs run in dry-run.
 *
 * PUBLISH GATE (owner ruling 2026-07-28, inherited): coordinate present + coordinate precision !=
 * 'low' + slug + access_type != 'unknown' + candidate research_status='verified'.
 *   court_count is deliberately NOT a gate condition.
 *   Expected split: 16 publish / 3 held —
 *     lr_pickleball_kingdom  precision='low'   (venue absent from OSM; only a street band geocodes)
 *     lr_indianhead_park     research_status='probable'
 *     lr_tyndall_park        research_status='probable'
 *   The two probables are imported ON PURPOSE (owner decision Q2) so they sit in the work queue with
 *   full provenance; the gate blocks them automatically. Promotion later is a one-field UPDATE.
 *
 * COORDINATES: every one independently geocoded via Nominatim/OSM — no Google or Places call (ADR-12),
 * and preflight aborts on any Places-derived origin. **The source workbook's own coordinate data is
 * corrupted and is NOT used as a source**: on the Venues tab rows LR-008..LR-019 have every column
 * from `phone` onward shifted one place right (the latitude column holds a phone number, the longitude
 * column holds the latitude) and the longitude fell out of the row entirely into the Review Decisions
 * tab's `decision_notes` column. The reconstructed pair is recorded per row as
 * provenance.coordinate.workbook_crosscheck with its delta; on 8 of 19 rows it disagrees by more than
 * 1 km (up to 5.35 km), so using it as a source would have been actively harmful. Preflight asserts
 * the cross-check is present and re-derives the delta rather than trusting the stored number.
 *
 * Because every coordinate is OSM-derived, EVERY row carries the ODbL marker; attribution is already
 * mounted in components/features/directory/OsmAttribution.tsx on /courts, /courts/[slug] and
 * /courts/in/[metro].
 *
 * metro_area = 'Little Rock' (owner decision Q1) — the anchor city, following Daytona (MSA
 * 'Deltona–Daytona Beach–Ormond Beach' stored as 'Daytona Beach'). Produces /courts/in/little-rock
 * with NO deploy; metroLabel() renders 'Little Rock, AR'. The directory's 6h ISR + unstable_cache
 * window means it can take up to 6 hours to appear on the list and hub pages.
 *
 * source: set EXPLICITLY to the batch tag. facility_listings.source is NOT NULL DEFAULT 'osm'; omitting
 * it mislabels the dataset as OSM-ingested. The batch tag is also the one-statement, non-destructive
 * rollback handle:
 *   update facility_listings set status='draft' where source='little-rock-2026-07-30';
 * NOTE: the Conway reconcile RE-TAGS the OSM row's source from 'osm' to the batch tag, so the rollback
 * handle covers it too. Its OSM lineage is preserved in provenance.osm_reconcile.osm_original.
 *
 * Established path: supabase-js + service role. READ-ONLY against every table other than
 * facility_candidates + facility_listings. No deletes, ever.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-little-rock-merged.mjs --stage=candidates --dry-run
 *   node scripts/import-little-rock-merged.mjs --stage=candidates
 *   node scripts/import-little-rock-merged.mjs --stage=listings --dry-run
 *   node scripts/import-little-rock-merged.mjs --stage=listings
 *   node scripts/import-little-rock-merged.mjs --stage=publish --dry-run
 *   node scripts/import-little-rock-merged.mjs --stage=publish
 *   node scripts/import-little-rock-merged.mjs --stage=verify
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { revalidateDirectory } from './lib/revalidate-directory.mjs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DRY_RUN = process.argv.includes('--dry-run')
const STAGE = (process.argv.find((a) => a.startsWith('--stage=')) || '').split('=')[1]
const INPUT = (process.argv.find((a) => a.startsWith('--input=')) || '').split('=')[1] || 'little-rock-count/little-rock-candidates.json'
if (!['candidates', 'listings', 'publish', 'verify'].includes(STAGE)) {
  console.error('Pass --stage=candidates|listings|publish|verify'); process.exit(1)
}

const BATCH = 'little-rock-2026-07-30'
const METRO = 'Little Rock'
const EXPECTED_COUNT = 19
const nowIso = new Date().toISOString()

// ---- live CHECK vocabularies (re-verified against pg_constraint 2026-07-30; keep in lockstep) ----
const RESEARCH_STATUS = new Set(['pending', 'verified', 'probable', 'unresolved', 'unresolved_unnamed', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published'])
const ACCESS_TYPE = new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown'])
const FEE_TYPE = new Set(['free', 'fee', 'membership', 'unknown'])          // no 'paid', 'day_pass', 'annual_pass'
const RESERVATION_POLICY = new Set(['none', 'drop_in', 'reservation_recommended', 'reservation_required', 'unknown'])
const ADDRESS_SOURCE = new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])
const COURT_CONFIGURATION = new Set(['dedicated', 'shared_multi_use', 'mixed', 'unknown'])   // no 'shared-use'
const LINE_TYPE = new Set(['permanent_painted', 'temporary_provided', 'byo_required', 'none', 'mixed', 'unknown'])  // no 'painted'
const NET_SETUP = new Set(['permanent', 'portable_provided', 'shared_tennis_net', 'byo_required', 'none', 'mixed', 'unknown'])  // no 'portable'
const SURFACE = new Set(['concrete', 'asphalt', 'paved', 'hard', 'hard_court', 'acrylic', 'sport_court', 'tartan', 'ground', 'artificial_turf', 'rubber', 'wood', 'grass', 'clay', 'ice', 'other'])  // no 'gym', no 'cushioned'
const PRECISION = new Set(['high', 'medium', 'low'])

// Faulkner / Grant / Lonoke / Perry / Pulaski / Saline envelope — a coordinate outside this is a
// data error, not a venue.
const ENVELOPE = { latMin: 34.30, latMax: 35.35, lngMin: -93.05, lngMax: -91.75 }

// Expected research_status shape of the artifact. A mismatch means the input changed under us.
const EXPECTED_STATUS_DIST = { verified: 17, probable: 2 }

// Below this distance from a pre-existing live listing, an INSERT would duplicate a venue we already
// hold — a reconcile decision for the owner, never something this script resolves on its own. The one
// known reconcile is allow-listed by research_key so the guard still fires on anything unexpected.
const RECONCILE_RADIUS_M = 200

// The single reconcile: Conway Community Center merges onto the dormant OSM row instead of inserting.
const RECONCILE_KEY = 'lr_conway_community_center'
const RECONCILE_OSM_ID = 'way/1498910770'
const RECONCILE_LISTING_ID = '8e16118a-f367-4c9d-947d-d08ccf55e973'

// ADR-14: aggregator hosts are a tier-4 private research input. They may sit in `provenance`
// (never rendered) but must never reach a user-facing column on a PUBLISHED row.
const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited|goodrun|pickleballcourt\.directory|playtimescheduler|mysaline/i

// ---------------------------------------------------------------------------------------------
// Load + normalize
// ---------------------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(INPUT, 'utf8'))
const venues = doc.venues || []
const isReconcile = (v) => v.research_key === RECONCILE_KEY

const fieldVal = (f) => (f && typeof f === 'object' && 'value' in f) ? f.value : (f ?? null)
const orNull = (v) => (v == null || v === '' ? null : v)
const evidence = (f) => {
  if (!f || typeof f !== 'object') return null
  const e = {}
  if (f.source_url != null) e.source_url = f.source_url
  if (f.source_tier != null) e.source_tier = f.source_tier
  if (f.confidence != null) e.confidence = f.confidence
  if (f.note != null) e.note = f.note
  if (f.workbook_name != null) e.workbook_name = f.workbook_name
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
  if (v.name?.workbook_name) parts.push(`name cleanup: "${v.name.workbook_name}" -> "${fieldVal(v.name)}" (owner decision Q3)`)
  if (v.research_status === 'probable') parts.push('probable — imported deliberately (owner decision Q2); the publish gate holds it draft until controlling-entity confirmation promotes it to verified')
  if (v.coordinates?.precision === 'low') parts.push(`coordinate precision LOW — held draft by the publish gate: ${v.coordinates.anchor || ''}`.trim())
  if (v.phone_source?.startsWith('recovered')) parts.push(`phone ${v.phone_source}`)
  if (isReconcile(v)) parts.push(`RECONCILE onto OSM ${RECONCILE_OSM_ID} (existing_listing_id=${RECONCILE_LISTING_ID})`)
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
      workbook_crosscheck: v.coordinates.workbook_crosscheck ?? null,
    } : null,
    address_source: v.address_source ?? null,
    workbook_name: v.name?.workbook_name ?? null,
    phone_source: v.phone_source ?? null,
    odbl: 'Coordinate is OSM-derived via Nominatim (ODbL 1.0). Published pages must carry OpenStreetMap attribution — components/features/directory/OsmAttribution.tsx on /courts, /courts/[slug] and /courts/in/[metro].',
    workbook_coordinate_warning: doc._meta?.workbook_coordinate_warning ?? null,
    owner_decisions: doc._meta?.owner_decisions_2026_07_30 ?? null,
    enum_mappings: doc._meta?.enum_mappings_applied ?? null,
    imported_at: nowIso,
    artifact_updated: doc._meta?.updated ?? null,
  }
  if (isReconcile(v)) {
    p.osm_reconcile = {
      osm_id: v.reconcile.osm_id,
      existing_listing_id: v.reconcile.existing_listing_id,
      matched_distance_m: v.reconcile.matched_distance_m,
      osm_original: v.reconcile.osm_original,
      note: v.reconcile.note,
    }
  }
  return p
}

// ---------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------
const candidateRows = venues.map((v) => ({
  candidate_key: v.research_key,
  batch: BATCH,
  discovered_by: 'little-rock-research',
  proposed_name: fieldVal(v.name),
  address: orNull(fieldVal(v.address)),
  zip: orNull(v.zip),
  city: orNull(v.city),
  state: orNull(v.state),
  metro_area: METRO,
  lat: v.coordinates?.lat ?? null,
  lng: v.coordinates?.lng ?? null,
  // Read from the artifact, never hardcoded null (convention fixed 2026-07-30 in 338f598).
  // Hardcoding it here and on the listing row is what left every published Daytona and Greensboro
  // row without a place_id, which made lib/directory/mapsUrl.ts fall through to its raw-coordinate
  // rung — an anonymous dropped pin instead of a venue card. This artifact carries no
  // google_place_id, so the expression resolves to null either way; it exists so the shape is right.
  google_place_id: orNull(fieldVal(v.google_place_id)),
  osm_id: isReconcile(v) ? v.reconcile.osm_id : null,
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
  existing_listing_id: isReconcile(v) ? v.reconcile.existing_listing_id : null,
  published_listing_id: null,                     // set by --stage=publish
}))

// Shared field mapping for a listing row (used by both the INSERT rows and the reconcile UPDATE).
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
    google_place_id: orNull(fieldVal(v.google_place_id)),   // see the candidate builder above
    name_source_url: orNull(v.name?.source_url),
    verification_status: 'source_verified',
    verified_at: null, verified_by: null,          // published rows only — set by --stage=publish
    enrichment: null, enriched_at: null, enrichment_version: null,
    location_id: null,
    provenance: provenanceFor(v),
  }
}

const insertVenues = venues.filter((v) => !isReconcile(v))       // 18
const reconcileVenue = venues.find(isReconcile)                   // 1 (Conway)
const listingRows = insertVenues.map(listingFields)

// ---------------------------------------------------------------------------------------------
// Pre-flight assertions — any failure aborts. Never relax one to make a run pass.
// ---------------------------------------------------------------------------------------------
async function preflight({ checkCollisions, candidateKeys }) {
  const fail = []
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})

  if (venues.length !== EXPECTED_COUNT) fail.push(`venue count ${venues.length} != ${EXPECTED_COUNT}`)
  const distKeys = new Set([...Object.keys(EXPECTED_STATUS_DIST), ...Object.keys(dist)])
  for (const k of distKeys) if ((dist[k] || 0) !== (EXPECTED_STATUS_DIST[k] || 0)) fail.push(`status dist ${k}: got ${dist[k] || 0}, expected ${EXPECTED_STATUS_DIST[k] || 0}`)
  if (!reconcileVenue) fail.push(`expected exactly one reconcile venue (${RECONCILE_KEY}) — not found`)

  for (const v of venues) {
    const k = v.research_key
    if (!RESEARCH_STATUS.has(v.research_status)) fail.push(`${k}: research_status "${v.research_status}"`)
    const at = fieldVal(v.access_type); if (!ACCESS_TYPE.has(at)) fail.push(`${k}: access_type "${at}"`)
    const ft = fieldVal(v.fee_type); if (ft != null && !FEE_TYPE.has(ft)) fail.push(`${k}: fee_type "${ft}" (the workbook's 'paid'/'day_pass'/'annual_pass' are NOT live values)`)
    const rp = fieldVal(v.reservation_policy); if (rp != null && !RESERVATION_POLICY.has(rp)) fail.push(`${k}: reservation_policy "${rp}" (the workbook's 'first_come'/'scheduled'/'open_play'/'reservation_available' are NOT live values)`)
    const sf = fieldVal(v.surface); if (sf != null && !SURFACE.has(sf)) fail.push(`${k}: surface "${sf}" (the workbook's 'gym'/'cushioned' are NOT live values)`)
    if (v.court_configuration != null && !COURT_CONFIGURATION.has(v.court_configuration)) fail.push(`${k}: court_configuration "${v.court_configuration}" (the workbook's 'shared-use' is NOT valid)`)
    if (v.line_type != null && !LINE_TYPE.has(v.line_type)) fail.push(`${k}: line_type "${v.line_type}" (the workbook's 'painted' is NOT valid)`)
    if (v.net_setup != null && !NET_SETUP.has(v.net_setup)) fail.push(`${k}: net_setup "${v.net_setup}" (the workbook's 'portable' is NOT valid)`)
    if (v.address_source == null || !ADDRESS_SOURCE.has(v.address_source)) fail.push(`${k}: address_source "${v.address_source}"`)
    const ic = v.identity_confidence ?? v.name?.confidence; if (ic != null && !CONFIDENCE.has(ic)) fail.push(`${k}: identity_confidence "${ic}"`)
    const pc = v.pickleball_activity?.confidence; if (pc != null && !CONFIDENCE.has(pc)) fail.push(`${k}: pickleball_confidence "${pc}"`)
    if (!v.slug) fail.push(`${k}: missing slug`)
    if (!fieldVal(v.name)) fail.push(`${k}: missing name`)

    const { lat, lng } = v.coordinates || {}
    if (lat == null || lng == null) fail.push(`${k}: no coordinate — this batch geocoded all ${EXPECTED_COUNT}`)
    else if (lat < ENVELOPE.latMin || lat > ENVELOPE.latMax || lng < ENVELOPE.lngMin || lng > ENVELOPE.lngMax) fail.push(`${k}: coordinate ${lat},${lng} outside the Little Rock MSA envelope`)
    const prec = v.coordinates?.precision
    if (!PRECISION.has(prec)) fail.push(`${k}: coordinate precision "${prec}" — must be high|medium|low`)
    const origin = v.coordinates?.origin || ''
    if (/places|google/i.test(origin)) fail.push(`${k}: coordinate origin "${origin}" is Places-derived — ADR-12 forbids persisting it`)
    if (origin !== 'nominatim') fail.push(`${k}: coordinate origin "${origin}" — this batch geocoded every row via nominatim; a different origin means the input changed`)
    if (!v.coordinates?.source_url) fail.push(`${k}: coordinate carries no source_url`)
    if (!v.coordinates?.anchor) fail.push(`${k}: coordinate carries no anchor description`)

    // The workbook's coordinate columns are corrupted (see the header). Where a cross-check pair
    // exists, RE-DERIVE the distance rather than trusting the stored number, so a bad edit to the
    // artifact cannot quietly launder a workbook coordinate back in as authoritative.
    const xc = v.coordinates?.workbook_crosscheck
    if (xc) {
      if (xc.lat == null || xc.lng == null || xc.delta_m == null) fail.push(`${k}: incomplete workbook_crosscheck`)
      else {
        const recomputed = Math.round(metresBetween(v.coordinates.lat, v.coordinates.lng, xc.lat, xc.lng))
        if (Math.abs(recomputed - xc.delta_m) > 2) fail.push(`${k}: workbook_crosscheck delta_m says ${xc.delta_m} but recomputes to ${recomputed}`)
      }
    }
  }

  // internal uniqueness (slug, candidate_key)
  for (const [label, vals] of [['slug', venues.map((v) => v.slug)], ['candidate_key', venues.map((v) => v.research_key)]]) {
    const seen = new Set(), dup = new Set()
    for (const x of vals) { if (seen.has(x)) dup.add(x); seen.add(x) }
    if (dup.size) fail.push(`duplicate ${label} in input: ${[...dup].join(', ')}`)
  }
  // internal proximity — two rows for one physical site
  for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
    const a = venues[i].coordinates, b = venues[j].coordinates
    if (!a?.lat || !b?.lat) continue
    const d = metresBetween(a.lat, a.lng, b.lat, b.lng)
    if (d < 150) fail.push(`${venues[i].research_key} and ${venues[j].research_key} are ${Math.round(d)} m apart — likely one site, two rows`)
  }

  if (checkCollisions) {
    // Fresh-insert slugs must NOT already exist. The reconcile slug is checked separately: it may
    // only collide with the row we are reconciling onto (or nothing).
    const insertSlugs = insertVenues.map((v) => v.slug)
    const keys = venues.map((v) => v.research_key)
    const { data: sc, error: e1 } = await db.from('facility_listings').select('slug').in('slug', insertSlugs)
    if (e1) { fail.push(`slug collision check failed: ${e1.message}`) } else if (sc.length) fail.push(`slug collisions live (insert set): ${sc.map((r) => r.slug).join(', ')}`)

    const { data: rc, error: e1b } = await db.from('facility_listings').select('id, slug, osm_id, status').eq('slug', reconcileVenue.slug)
    if (e1b) { fail.push(`reconcile slug check failed: ${e1b.message}`) }
    else if (rc.length && !(rc.length === 1 && rc[0].id === RECONCILE_LISTING_ID)) fail.push(`reconcile slug "${reconcileVenue.slug}" collides with a row that is NOT the reconcile target: ${rc.map((r) => r.id).join(', ')}`)

    // Reconcile target must exist, be unique on osm_id, and still be draft.
    const { data: tgt, error: e1c } = await db.from('facility_listings').select('id, osm_id, status, name, slug, access_type').eq('osm_id', RECONCILE_OSM_ID)
    if (e1c) { fail.push(`reconcile target check failed: ${e1c.message}`) }
    else if (tgt.length !== 1) fail.push(`reconcile target osm_id=${RECONCILE_OSM_ID}: expected exactly 1 row, found ${tgt.length}`)
    else {
      if (tgt[0].id !== RECONCILE_LISTING_ID) fail.push(`reconcile target id mismatch: expected ${RECONCILE_LISTING_ID}, found ${tgt[0].id}`)
      if (tgt[0].status !== 'draft') fail.push(`reconcile target is not draft (status=${tgt[0].status}) — abort, do not overwrite a published row`)
    }

    // Proximity to EVERY pre-existing listing in the envelope, recomputed live on every run. The one
    // known reconcile is allow-listed; anything else inside the radius is an owner decision.
    const { data: near, error: e2 } = await db.from('facility_listings')
      .select('id, name, slug, lat, lng, status, source, osm_id')
      .gte('lat', ENVELOPE.latMin).lte('lat', ENVELOPE.latMax)
      .gte('lng', ENVELOPE.lngMin).lte('lng', ENVELOPE.lngMax)
      .not('lat', 'is', null).not('lng', 'is', null)
    if (e2) { fail.push(`envelope proximity check failed: ${e2.message}`) }
    else {
      const foreign = near.filter((r) => r.source !== BATCH)
      console.log(`  envelope holds ${near.length} live listing(s), ${foreign.length} from other batches`)
      for (const v of venues) {
        for (const r of foreign) {
          const d = metresBetween(v.coordinates.lat, v.coordinates.lng, r.lat, r.lng)
          if (d >= RECONCILE_RADIUS_M) continue
          const expected = isReconcile(v) && r.osm_id === RECONCILE_OSM_ID
          if (expected) console.log(`  reconcile confirmed live: ${v.research_key} is ${Math.round(d)} m from "${r.name}" (${r.osm_id})`)
          else fail.push(`${v.research_key} is ${Math.round(d)} m from live listing "${r.name}" (${r.slug}, ${r.status}) — that is a RECONCILE decision for the owner, not an INSERT`)
        }
      }
    }

    const { data: kc, error: e3 } = await db.from('facility_candidates').select('candidate_key').in('candidate_key', keys)
    if (e3) { fail.push(`candidate_key collision check failed: ${e3.message}`) }
    else if (candidateKeys === 'absent' && kc.length) fail.push(`candidate_key collisions live (candidates already seeded?): ${kc.map((r) => r.candidate_key).join(', ')}`)
    else if (candidateKeys === 'present' && kc.length !== keys.length) fail.push(`expected all ${EXPECTED_COUNT} candidate_keys to exist before the listings stage, found ${kc.length}`)
  }

  console.log(`pre-flight: ${venues.length} venues · status ${JSON.stringify(dist)} · ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : `${fail.length} FAILURES ✗`}`)
  if (fail.length) { fail.forEach((f) => console.error(`  ✗ ${f}`)); console.error('\nABORT: pre-flight failed. Fix the input or the schema — never relax an assertion to make a run pass.'); process.exit(1) }
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------
console.log(`\n=== import-little-rock-merged · stage=${STAGE} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`input: ${INPUT} · batch: ${BATCH} · metro: ${METRO}\n`)

if (STAGE === 'candidates') {
  await preflight({ checkCollisions: true, candidateKeys: 'absent' })
  const dist = candidateRows.reduce((a, r) => (a[r.research_status] = (a[r.research_status] || 0) + 1, a), {})
  console.log(`\nTO INSERT into facility_candidates: ${candidateRows.length}`)
  console.log(`  research_status: ${JSON.stringify(dist)}`)
  console.log(`  address_source:  ${JSON.stringify(candidateRows.reduce((a, r) => (a[r.address_source] = (a[r.address_source] || 0) + 1, a), {}))}`)
  console.log(`  with coords ${candidateRows.filter((r) => r.lat != null).length}/${EXPECTED_COUNT} · with address ${candidateRows.filter((r) => r.address).length}/${EXPECTED_COUNT} · reconcile ${candidateRows.filter((r) => r.existing_listing_id).length}/${EXPECTED_COUNT}`)
  console.log(`\nall ${EXPECTED_COUNT} rows:`)
  candidateRows.forEach((r) => console.log(`  + ${r.candidate_key.padEnd(36)} "${r.proposed_name}" | ${r.city}, ${r.state} | ${r.research_status}${r.existing_listing_id ? ` | RECONCILE->${r.existing_listing_id}` : ''}`))

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await db.from('facility_candidates').insert(candidateRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  console.log(`\ninserted ${candidateRows.length} rows · facility_candidates batch='${BATCH}' now: ${count}`)
}

if (STAGE === 'listings') {
  await preflight({ checkCollisions: true, candidateKeys: 'present' })
  const { count: candCount } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  if (candCount !== EXPECTED_COUNT) { console.error(`\nABORT: expected ${EXPECTED_COUNT} candidates for batch '${BATCH}', found ${candCount}. Run --stage=candidates first.`); process.exit(1) }

  console.log(`\nTO INSERT into facility_listings: ${listingRows.length} (status='draft', source='${BATCH}')`)
  console.log(`  access_type:         ${JSON.stringify(listingRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {}))}`)
  console.log(`  fee_type:            ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.fee_type)] = (a[String(r.fee_type)] || 0) + 1, a), {}))}`)
  console.log(`  reservation_policy:  ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.reservation_policy)] = (a[String(r.reservation_policy)] || 0) + 1, a), {}))}`)
  console.log(`  surface:             ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.surface)] = (a[String(r.surface)] || 0) + 1, a), {}))}`)
  console.log(`  court_configuration: ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.court_configuration)] = (a[String(r.court_configuration)] || 0) + 1, a), {}))}`)
  console.log(`  net_setup:           ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.net_setup)] = (a[String(r.net_setup)] || 0) + 1, a), {}))}`)
  console.log(`  coord precision:     ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.provenance?.coordinate?.precision)] = (a[String(r.provenance?.coordinate?.precision)] || 0) + 1, a), {}))}`)
  console.log(`  court_count present ${listingRows.filter((r) => r.court_count != null).length}/${listingRows.length} · website ${listingRows.filter((r) => r.website).length}/${listingRows.length} · phone ${listingRows.filter((r) => r.phone).length}/${listingRows.length}`)
  console.log(`  low-precision coord (blocked at publish): ${listingRows.filter((r) => r.provenance?.coordinate?.precision === 'low').map((r) => r.slug).join(', ') || 'none'}`)
  console.log(`  probable rows (blocked at publish):       ${listingRows.filter((r) => r.provenance?.research_status_at_import === 'probable').map((r) => r.slug).join(', ') || 'none'}`)
  console.log(`  ODbL-coordinate rows: ${listingRows.filter((r) => r.provenance.odbl).length}/${listingRows.length}`)
  const disagree = listingRows.filter((r) => /DISAGREE/.test(r.provenance?.coordinate?.workbook_crosscheck?.verdict || ''))
  console.log(`  workbook cross-check DISAGREE (>1 km, workbook rejected): ${disagree.length} — ${disagree.map((r) => r.provenance.candidate_key).join(', ')}`)

  // The Conway reconcile — computed and previewed alongside the inserts.
  const reconcileFields = listingFields(reconcileVenue)
  const o = reconcileVenue.reconcile.osm_original
  console.log(`\nTO UPDATE (reconcile, NOT insert) — ${RECONCILE_KEY} onto the dormant OSM row:`)
  console.log(`  where osm_id='${RECONCILE_OSM_ID}' and status='draft'  (id=${RECONCILE_LISTING_ID})`)
  console.log(`  BEFORE: name="${o.name}"  slug="${o.slug}"  source="${o.source}"  access_type="${o.access_type}"  metro_area=${o.metro_area}`)
  console.log(`  AFTER:  name="${reconcileFields.name}"  slug="${reconcileFields.slug}"  source="${reconcileFields.source}"  access_type="${reconcileFields.access_type}"  metro_area="${reconcileFields.metro_area}"  fee_type=${reconcileFields.fee_type}`)
  console.log(`          access_type unknown -> public is REQUIRED, else the publish gate blocks this row`)
  console.log(`          osm_id PRESERVED (${RECONCILE_OSM_ID}) · OSM original stashed in provenance.osm_reconcile.osm_original · ODbL marker set`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written (0 INSERT, 0 UPDATE).'); process.exit(0) }

  const { error: insErr } = await db.from('facility_listings').insert(listingRows)
  if (insErr) { console.error('\nINSERT failed (atomic — nothing inserted):', insErr.message); process.exit(1) }
  console.log(`\ninserted ${listingRows.length} draft rows`)

  // Reconcile UPDATE — guarded on status='draft' so it's a no-op if the row was published in the interim.
  const { data: upd, error: updErr } = await db.from('facility_listings')
    .update(reconcileFields).eq('osm_id', RECONCILE_OSM_ID).eq('status', 'draft').select('id, slug, name, source, access_type')
  if (updErr) { console.error('\nreconcile UPDATE failed:', updErr.message); process.exit(1) }
  if (!upd || upd.length !== 1) { console.error(`\nreconcile UPDATE affected ${upd?.length ?? 0} rows (expected exactly 1) — investigate; the OSM row may have been published or removed.`); process.exit(1) }
  console.log(`reconciled 1 row: ${upd[0].slug} (access_type now "${upd[0].access_type}", source now "${upd[0].source}")`)

  const { count } = await db.from('facility_listings').select('*', { count: 'exact', head: true }).eq('source', BATCH)
  console.log(`facility_listings source='${BATCH}' now: ${count} (expect ${EXPECTED_COUNT} = ${listingRows.length} insert + 1 reconcile)`)
  console.log(`REMINDER: the site-wide listings total must have risen by ${listingRows.length}, NOT ${EXPECTED_COUNT}. A +${EXPECTED_COUNT} means the reconcile became an INSERT.`)
}

if (STAGE === 'publish') {
  const { data: rows, error: rErr } = await db.from('facility_listings')
    .select('id, slug, name, lat, lng, access_type, status, website, name_source_url, provenance').eq('source', BATCH)
  if (rErr) { console.error('listing read failed:', rErr.message); process.exit(1) }
  const { data: cands, error: cErr } = await db.from('facility_candidates')
    .select('id, candidate_key, research_status, published_listing_id').eq('batch', BATCH)
  if (cErr) { console.error('candidate read failed:', cErr.message); process.exit(1) }
  if (rows.length !== EXPECTED_COUNT || cands.length !== EXPECTED_COUNT) { console.error(`\nABORT: expected ${EXPECTED_COUNT}/${EXPECTED_COUNT}, found listings=${rows.length} candidates=${cands.length}. Run the earlier stages first.`); process.exit(1) }

  const candByKey = new Map(cands.map((c) => [c.candidate_key, c]))
  const eligible = [], blocked = []
  for (const r of rows) {
    const key = r.provenance?.candidate_key
    const cand = key ? candByKey.get(key) : null
    const precision = r.provenance?.coordinate?.precision ?? null
    const reasons = []
    if (!cand) reasons.push('no linked candidate')
    if (r.lat == null || r.lng == null) reasons.push('no coordinate')
    if (precision === 'low') reasons.push('coordinate precision low')
    if (!r.slug) reasons.push('no slug')
    if (!r.access_type || r.access_type === 'unknown') reasons.push('access_type unknown')
    if (cand && cand.research_status !== 'verified') reasons.push(`research_status=${cand.research_status}`)
    ;(reasons.length ? blocked : eligible).push({ row: r, cand, reasons })
  }

  const adr14 = eligible.filter(({ row }) => AGGREGATOR_HOST.test(row.website || '') || AGGREGATOR_HOST.test(row.name_source_url || ''))

  console.log(`gate = coordinate present + precision != low + slug + access_type != unknown + candidate research_status='verified'`)
  console.log(`       (court_count is NOT a gate condition)\n`)
  console.log(`ELIGIBLE → publish: ${eligible.length}`)
  eligible.forEach(({ row }) => console.log(`  + ${row.slug}`))
  console.log(`BLOCKED  → stay draft: ${blocked.length}`)
  blocked.forEach(({ row, reasons }) => console.log(`  - ${row.slug} — ${reasons.join('; ')}`))
  console.log(`\nADR-14 aggregator scan over publishing rows: ${adr14.length === 0 ? 'CLEAN ✓' : 'VIOLATIONS ✗'}`)
  adr14.forEach(({ row }) => console.error(`  ✗ ${row.slug}: website=${row.website} name_source_url=${row.name_source_url}`))
  if (adr14.length) { console.error('\nABORT: an aggregator URL would land on a user-facing column of a published row (ADR-14).'); process.exit(1) }
  console.log(`ODbL-coordinate rows among the publishing set: ${eligible.filter(({ row }) => row.provenance?.odbl).length} — attribution renders via OsmAttribution.`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }

  const ids = eligible.map(({ row }) => row.id)
  const { error: pErr } = await db.from('facility_listings')
    .update({ status: 'published', verified_at: nowIso, verified_by: BATCH }).in('id', ids)
  if (pErr) { console.error('\npublish update failed:', pErr.message); process.exit(1) }
  console.log(`\npublished ${ids.length} listings`)

  let linked = 0
  for (const { row, cand } of eligible) {
    const { error } = await db.from('facility_candidates')
      .update({ published_listing_id: row.id, research_status: 'published' }).eq('id', cand.id)
    if (error) { console.error(`  backlink failed for ${cand.candidate_key}:`, error.message); continue }
    linked++
  }
  console.log(`backlinked ${linked}/${eligible.length} candidates (published_listing_id + research_status='published')`)
  if (linked !== eligible.length) { console.error('\nWARNING: backlink incomplete — re-run --stage=publish (idempotent).'); process.exit(1) }
}

// A publish is not visible until the directory cache knows about it — the reads in
// lib/directory/loadFacilities.ts are unstable_cache'd for 6h under the 'directory' tag and this
// script writes straight to Postgres, so /courts/in/<slug> hard-404s until the TTL lapses (this
// batch, 2026-07-30). Marks the run failed without aborting — the rows ARE published.
if (STAGE === 'publish' && !DRY_RUN) {
  const rv = await revalidateDirectory({ metroArea: METRO })
  if (!rv.ok) process.exitCode = 1
}

if (STAGE === 'verify') {
  const { data: rows } = await db.from('facility_listings')
    .select('id, slug, status, source, metro_area, state, lat, lng, access_type, fee_type, reservation_policy, surface, court_configuration, line_type, net_setup, court_count, verification_status, osm_id, verified_by, provenance').eq('source', BATCH)
  const { data: cands } = await db.from('facility_candidates')
    .select('candidate_key, research_status, published_listing_id, existing_listing_id, metro_area').eq('batch', BATCH)
  const byStatus = (arr, k) => arr.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {})
  const listingIds = new Set(rows.map((r) => r.id))
  const published = rows.filter((r) => r.status === 'published')
  const recRow = rows.find((r) => r.osm_id === RECONCILE_OSM_ID)

  const checks = [
    [`facility_listings rows for batch = ${EXPECTED_COUNT}`, rows.length === EXPECTED_COUNT, rows.length],
    [`facility_candidates rows for batch = ${EXPECTED_COUNT}`, cands.length === EXPECTED_COUNT, cands.length],
    ['every listing source = batch tag (never "osm")', rows.every((r) => r.source === BATCH), byStatus(rows, 'source')],
    [`every listing metro_area = ${METRO}`, rows.every((r) => r.metro_area === METRO), byStatus(rows, 'metro_area')],
    ['every candidate metro_area matches', cands.every((c) => c.metro_area === METRO), byStatus(cands, 'metro_area')],
    ['every listing state = AR', rows.every((r) => r.state === 'AR'), byStatus(rows, 'state')],
    ['reconciled Conway row present (osm_id preserved)', !!recRow, recRow ? recRow.slug : 'MISSING'],
    ['reconciled row carries osm_reconcile provenance', !!recRow && recRow.provenance?.osm_reconcile?.osm_id === RECONCILE_OSM_ID, 'ok'],
    ['reconciled row access_type is public (was unknown)', !!recRow && recRow.access_type === 'public', recRow ? recRow.access_type : 'n/a'],
    ['reconciled row is the ONLY row carrying an osm_id', rows.filter((r) => r.osm_id != null).length === 1, rows.filter((r) => r.osm_id != null).map((r) => r.slug)],
    ['exactly one candidate carries existing_listing_id', cands.filter((c) => c.existing_listing_id != null).length === 1, cands.filter((c) => c.existing_listing_id != null).map((c) => c.candidate_key)],
    ['every fee_type is a live enum value', rows.every((r) => r.fee_type == null || FEE_TYPE.has(r.fee_type)), byStatus(rows, 'fee_type')],
    ['every reservation_policy is a live enum value', rows.every((r) => r.reservation_policy == null || RESERVATION_POLICY.has(r.reservation_policy)), byStatus(rows, 'reservation_policy')],
    ['every surface is a live enum value or null', rows.every((r) => r.surface == null || SURFACE.has(r.surface)), byStatus(rows, 'surface')],
    ['every court_configuration is a live enum value', rows.every((r) => r.court_configuration == null || COURT_CONFIGURATION.has(r.court_configuration)), byStatus(rows, 'court_configuration')],
    ['every line_type is a live enum value', rows.every((r) => r.line_type == null || LINE_TYPE.has(r.line_type)), byStatus(rows, 'line_type')],
    ['every net_setup is a live enum value', rows.every((r) => r.net_setup == null || NET_SETUP.has(r.net_setup)), byStatus(rows, 'net_setup')],
    ['verification_status = source_verified everywhere', rows.every((r) => r.verification_status === 'source_verified'), byStatus(rows, 'verification_status')],
    ['every listing has provenance with a candidate_key', rows.every((r) => r.provenance?.candidate_key), rows.filter((r) => !r.provenance?.candidate_key).length + ' missing'],
    ['every listing has a per-field evidence map', rows.every((r) => r.provenance?.fields && Object.keys(r.provenance.fields).length), rows.filter((r) => !Object.keys(r.provenance?.fields || {}).length).length + ' missing'],
    ['every listing carries the ODbL marker', rows.every((r) => r.provenance?.odbl), rows.filter((r) => !r.provenance?.odbl).length + ' missing'],
    ['every coordinate origin is nominatim', rows.every((r) => r.provenance?.coordinate?.origin === 'nominatim'), byStatus(rows.map((r) => ({ o: r.provenance?.coordinate?.origin })), 'o')],
    ['no coordinate is Places-derived (ADR-12)', rows.every((r) => !/places|google/i.test(r.provenance?.coordinate?.origin || '')), 'ok'],
    ['no published row lacks a coordinate', published.every((r) => r.lat != null && r.lng != null), 'ok'],
    ['no published row has low-precision coordinate', published.every((r) => r.provenance?.coordinate?.precision !== 'low'), 'ok'],
    ['no published row has access_type unknown', published.every((r) => r.access_type !== 'unknown'), 'ok'],
    ['draft rows carry verified_by = NULL (reconcile-gate safety)', rows.filter((r) => r.status === 'draft').every((r) => r.verified_by == null), 'ok'],
    ['pickleball-kingdom stays draft (low precision)', rows.filter((r) => r.slug === 'pickleball-kingdom-little-rock-ar').every((r) => r.status === 'draft'), byStatus(rows.filter((r) => r.slug === 'pickleball-kingdom-little-rock-ar'), 'status')],
    ['both probables stay draft', rows.filter((r) => ['indianhead-park-sherwood-ar', 'tyndall-park-benton-ar'].includes(r.slug)).every((r) => r.status === 'draft'), byStatus(rows.filter((r) => ['indianhead-park-sherwood-ar', 'tyndall-park-benton-ar'].includes(r.slug)), 'status')],
    ['no published row came from a probable candidate', published.every((r) => r.provenance?.research_status_at_import === 'verified'), 'ok'],
    ['published candidates ↔ published listings agree', cands.filter((c) => c.research_status === 'published').length === published.length, `${cands.filter((c) => c.research_status === 'published').length} vs ${published.length}`],
    ['every published_listing_id points at a real batch listing', cands.filter((c) => c.published_listing_id).every((c) => listingIds.has(c.published_listing_id)), 'ok'],
    ['no unpublished candidate carries published_listing_id', cands.filter((c) => c.research_status !== 'published').every((c) => c.published_listing_id == null), 'ok'],
  ]
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
