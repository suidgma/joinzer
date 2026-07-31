/**
 * Directory — import + publish the Greensboro–High Point, NC verified venue set
 * (batch `greensboro-high-point-2026-07-30`).
 *
 * Input: greensboro-count/greensboro-candidates.json — 15 verified venues, from the "Greensboro–High
 * Point, NC Venue Research" workbook (Import Ready + Review Decisions tabs) with 7 owner decisions
 * applied (approved 2026-07-30). The artifact is gitignored: research working data, and the workbook's
 * held-back Candidates tab is sourced partly to playtimescheduler.com, a tier-4 aggregator that ADR-14
 * makes a private research input which must never be republished.
 *
 * Mirrors scripts/import-reno-merged.mjs (pure greenfield — 15 INSERTs, no reconcile branch) rather
 * than import-daytona-merged.mjs, because there is no pre-existing listing to merge onto: the three
 * dormant OSM rows inside Guilford County (Kaplan Center, Friendly Swim & Tennis, J. Spencer Love
 * Tennis Center) are all different venues, and the nearest approach from any of the 15 is 475 m.
 * That is not an assumption — preflight recomputes it against live data every run (RECONCILE_RADIUS_M).
 *
 * Four stages, each independently dry-runnable, run in this order:
 *   --stage=candidates  15 rows -> facility_candidates (staging / work queue). One atomic INSERT.
 *   --stage=listings    15 rows -> facility_listings status='draft'. One atomic INSERT.
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
 *   Expected effect here: hp_hartley_ymca is BLOCKED (coordinate precision='low' — the venue is absent
 *   from OSM and only the Hartley Drive street band geocodes) until re-geocoded to the exact
 *   150 W Hartley Dr number. Same shape as Daytona's bethune-beach row. Expected split: 14 / 1.
 *
 * PRECISION LADDER: this batch uses high / medium / low where Daytona used only high / low. The gate
 * tests `!= 'low'`, so `medium` publishes — it records "correct site, but the anchor is a neighbouring
 * feature or a large polygon centroid" (Lake Daniel Park's greenway centroid; Bur-Mil's clubhouse).
 *
 * COORDINATES are Nominatim/OSM — no Google or Places call was made (ADR-12), and preflight aborts on
 * any coordinate whose origin looks Places-derived. Because every coordinate is OSM-derived, every row
 * carries the ODbL marker in provenance; attribution is already mounted site-wide in
 * components/features/directory/OsmAttribution.tsx on /courts, /courts/[slug] and /courts/in/[metro].
 *
 * metro_area = 'Greensboro-High Point' (owner decision Q1) — ASCII hyphen, no state suffix, because
 * lib/directory/metros.ts metroLabel() appends `state` itself. Produces /courts/in/greensboro-high-point
 * with NO deploy (loadPublishedMetros feeds hub + routes + sitemap from the stored value). The
 * directory's 6h ISR + unstable_cache window means it can take up to 6 hours to appear.
 *
 * source: set EXPLICITLY to the batch tag. facility_listings.source is NOT NULL DEFAULT 'osm'; omitting
 * it mislabels the dataset as OSM-ingested. The batch tag is also the one-statement, non-destructive
 * rollback handle:
 *   update facility_listings set status='draft' where source='greensboro-high-point-2026-07-30';
 *
 * Established path: supabase-js + service role. READ-ONLY against every table other than
 * facility_candidates + facility_listings. No deletes, ever.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-greensboro-merged.mjs --stage=candidates --dry-run
 *   node scripts/import-greensboro-merged.mjs --stage=candidates
 *   node scripts/import-greensboro-merged.mjs --stage=listings --dry-run
 *   node scripts/import-greensboro-merged.mjs --stage=listings
 *   node scripts/import-greensboro-merged.mjs --stage=publish --dry-run
 *   node scripts/import-greensboro-merged.mjs --stage=publish
 *   node scripts/import-greensboro-merged.mjs --stage=verify
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
const INPUT = (process.argv.find((a) => a.startsWith('--input=')) || '').split('=')[1] || 'greensboro-count/greensboro-candidates.json'
if (!['candidates', 'listings', 'publish', 'verify'].includes(STAGE)) {
  console.error('Pass --stage=candidates|listings|publish|verify'); process.exit(1)
}

const BATCH = 'greensboro-high-point-2026-07-30'
const METRO = 'Greensboro-High Point'
const EXPECTED_COUNT = 15
const nowIso = new Date().toISOString()

// ---- live CHECK vocabularies (re-verified against pg_constraint 2026-07-30; keep in lockstep) ----
const RESEARCH_STATUS = new Set(['pending', 'verified', 'probable', 'unresolved', 'unresolved_unnamed', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published'])
const ACCESS_TYPE = new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown'])
const FEE_TYPE = new Set(['free', 'fee', 'membership', 'unknown'])          // NOTE: no 'paid', no 'drop_in'
const RESERVATION_POLICY = new Set(['none', 'drop_in', 'reservation_recommended', 'reservation_required', 'unknown'])
const ADDRESS_SOURCE = new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])
const VERIFICATION_STATUS = new Set(['unverified', 'source_verified', 'human_verified'])
// The four vocabularies the workbook got wrong and that Reno/Daytona never wrote at all. Asserted
// here precisely because this batch is the first to populate them.
const COURT_CONFIGURATION = new Set(['dedicated', 'shared_multi_use', 'mixed', 'unknown'])
const LINE_TYPE = new Set(['permanent_painted', 'temporary_provided', 'byo_required', 'none', 'mixed', 'unknown'])
const NET_SETUP = new Set(['permanent', 'portable_provided', 'shared_tennis_net', 'byo_required', 'none', 'mixed', 'unknown'])
const SURFACE = new Set(['concrete', 'asphalt', 'paved', 'hard', 'hard_court', 'acrylic', 'sport_court', 'tartan', 'ground', 'artificial_turf', 'rubber', 'wood', 'grass', 'clay', 'ice', 'other'])
const PRECISION = new Set(['high', 'medium', 'low'])

// Guilford / Randolph / Rockingham envelope — a coordinate outside this is a data error, not a venue.
const ENVELOPE = { latMin: 35.40, latMax: 36.60, lngMin: -80.15, lngMax: -79.45 }

// Expected research_status shape of the artifact. A mismatch means the input changed under us.
const EXPECTED_STATUS_DIST = { verified: 15 }

// Below this distance from a pre-existing live listing, an INSERT would be creating a duplicate of a
// venue we already hold — that is a reconcile decision for the owner, never something to guess at.
const RECONCILE_RADIUS_M = 200

// ADR-14: aggregator hosts are a tier-4 private research input. They may sit in `provenance`
// (never rendered) but must never reach a user-facing column on a PUBLISHED row. playtimescheduler is
// added for this batch — it is the source behind several of the 8 held-back workbook candidates.
const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited|goodrun|pickleballcourt\.directory|playtimescheduler/i

// ---------------------------------------------------------------------------------------------
// Load + normalize
// ---------------------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(INPUT, 'utf8'))
const venues = doc.venues || []

const fieldVal = (f) => (f && typeof f === 'object' && 'value' in f) ? f.value : (f ?? null)
const orNull = (v) => (v == null || v === '' ? null : v)
// A per-field evidence node, minus the value (which lives in its own column).
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
  if (v.reviewer_note) parts.push(v.reviewer_note)
  if (v.name?.workbook_name) parts.push(`name cleanup: "${v.name.workbook_name}" -> "${fieldVal(v.name)}" (owner decision Q6)`)
  if (v.coordinates?.precision === 'low') parts.push(`coordinate precision LOW — held draft by the publish gate: ${v.coordinates.note || ''}`.trim())
  parts.push(`facts + full per-field provenance on facility_listings slug=${v.slug}`)
  return parts.join(' | ')
}

// The full evidence map. facility_candidates has no jsonb, so this is the ONLY place per-field
// source_url / source_tier / confidence / notes and the coordinate record survive.
function provenanceFor(v) {
  const fields = {}
  for (const f of EVIDENCE_FIELDS) { const e = evidence(v[f]); if (e) fields[f] = { value: fieldVal(v[f]), ...e } }
  return {
    batch: BATCH,
    candidate_key: v.research_key,
    method: 'directory_research',
    research_status_at_import: v.research_status,
    fields,
    coordinate: v.coordinates ? {
      lat: v.coordinates.lat, lng: v.coordinates.lng,
      precision: v.coordinates.precision ?? null,
      source_url: v.coordinates.source_url ?? null,
      origin: v.coordinates.origin ?? null,
      note: v.coordinates.note ?? null,
    } : null,
    address_source: v.address_source ?? null,
    workbook_name: v.name?.workbook_name ?? null,
    // Every coordinate in this batch came from Nominatim, so every row carries the obligation.
    odbl: 'Coordinate is OSM-derived via Nominatim (ODbL 1.0). Published pages must carry OpenStreetMap attribution — components/features/directory/OsmAttribution.tsx on /courts, /courts/[slug] and /courts/in/[metro].',
    owner_decisions: doc._meta?.owner_decisions_2026_07_30 ?? null,
    enum_mappings: doc._meta?.enum_mappings_applied ?? null,
    imported_at: nowIso,
    artifact_updated: doc._meta?.updated ?? null,
  }
}

// ---------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------
const candidateRows = venues.map((v) => ({
  candidate_key: v.research_key,
  batch: BATCH,
  discovered_by: 'greensboro-research',
  proposed_name: fieldVal(v.name),
  address: orNull(fieldVal(v.address)),
  zip: orNull(v.zip),
  city: orNull(v.city),
  state: orNull(v.state),
  metro_area: METRO,
  lat: v.coordinates?.lat ?? null,
  lng: v.coordinates?.lng ?? null,
  // Read from the artifact, never hardcoded null (fixed 2026-07-30). Hardcoding it here and on the
  // listing row is what left all 14 published Greensboro rows without a place_id, which made
  // lib/directory/mapsUrl.ts fall through to a raw-coordinate URL — an anonymous dropped pin
  // instead of a venue card. This artifact carries no google_place_id, so the expression is a no-op
  // on a re-run; it exists so the next batch copied from this script inherits the right shape.
  google_place_id: orNull(fieldVal(v.google_place_id)),
  osm_id: null,                                   // greenfield — nothing reconciled onto an OSM element
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
  existing_listing_id: null,                      // greenfield — no live row within 200 m of any of the 15
  published_listing_id: null,                     // set by --stage=publish
}))

const listingRows = venues.map((v) => ({
  name: fieldVal(v.name),
  slug: v.slug,
  source: BATCH,                                   // explicit — never the 'osm' default
  status: 'draft',                                 // every row lands draft; --stage=publish flips the gate-passers
  osm_id: null,
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
  reservation_url: null,                           // workbook column present but empty on all 15
  indoor: fieldVal(v.indoor) ?? null,
  lighting: fieldVal(v.lighting) ?? null,
  surface: fieldVal(v.surface) ?? null,            // NULL on all 15 — owner decision Q5
  court_configuration: v.court_configuration ?? null,
  line_type: v.line_type ?? null,
  net_setup: v.net_setup ?? null,
  website: orNull(v.website),
  phone: orNull(v.phone),
  public_notes: orNull(fieldVal(v.public_notes)),
  google_place_id: orNull(fieldVal(v.google_place_id)),   // see the candidate builder above
  name_source_url: orNull(v.name?.source_url),
  verification_status: 'source_verified',          // workbook said 'reviewed', which is not a live value
  verified_at: null, verified_by: null,            // published rows only — set by --stage=publish
  enrichment: null, enriched_at: null, enrichment_version: null,
  location_id: null,
  provenance: provenanceFor(v),
}))

// ---------------------------------------------------------------------------------------------
// Pre-flight assertions — any failure aborts. Never relax one to make a run pass.
// ---------------------------------------------------------------------------------------------
async function preflight({ checkCollisions, candidateKeys }) {
  const fail = []
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})

  if (venues.length !== EXPECTED_COUNT) fail.push(`venue count ${venues.length} != ${EXPECTED_COUNT}`)
  const distKeys = new Set([...Object.keys(EXPECTED_STATUS_DIST), ...Object.keys(dist)])
  for (const k of distKeys) if ((dist[k] || 0) !== (EXPECTED_STATUS_DIST[k] || 0)) fail.push(`status dist ${k}: got ${dist[k] || 0}, expected ${EXPECTED_STATUS_DIST[k] || 0}`)

  for (const v of venues) {
    const k = v.research_key
    if (!RESEARCH_STATUS.has(v.research_status)) fail.push(`${k}: research_status "${v.research_status}"`)
    const at = fieldVal(v.access_type); if (!ACCESS_TYPE.has(at)) fail.push(`${k}: access_type "${at}"`)
    const ft = fieldVal(v.fee_type); if (ft != null && !FEE_TYPE.has(ft)) fail.push(`${k}: fee_type "${ft}" (not a live enum — the workbook's 'drop_in'/'membership_or_guest_pass' are NOT valid)`)
    const rp = fieldVal(v.reservation_policy); if (rp != null && !RESERVATION_POLICY.has(rp)) fail.push(`${k}: reservation_policy "${rp}" (the workbook's 'first_come_first_served'/'scheduled_*'/'required'/'reservable' are NOT valid)`)
    const sf = fieldVal(v.surface); if (sf != null && !SURFACE.has(sf)) fail.push(`${k}: surface "${sf}" (the workbook's 'gym floor'/'multi-sport' are NOT valid)`)
    if (v.court_configuration != null && !COURT_CONFIGURATION.has(v.court_configuration)) fail.push(`${k}: court_configuration "${v.court_configuration}" (the workbook's 'shared_use' is NOT valid)`)
    if (v.line_type != null && !LINE_TYPE.has(v.line_type)) fail.push(`${k}: line_type "${v.line_type}" (the workbook's 'painted' is NOT valid)`)
    if (v.net_setup != null && !NET_SETUP.has(v.net_setup)) fail.push(`${k}: net_setup "${v.net_setup}" (the workbook's 'portable' is NOT valid)`)
    if (v.address_source == null || !ADDRESS_SOURCE.has(v.address_source)) fail.push(`${k}: address_source "${v.address_source}"`)
    const ic = v.identity_confidence ?? v.name?.confidence; if (ic != null && !CONFIDENCE.has(ic)) fail.push(`${k}: identity_confidence "${ic}"`)
    const pc = v.pickleball_activity?.confidence; if (pc != null && !CONFIDENCE.has(pc)) fail.push(`${k}: pickleball_confidence "${pc}"`)
    if (!v.slug) fail.push(`${k}: missing slug`)
    if (!fieldVal(v.name)) fail.push(`${k}: missing name`)

    const { lat, lng } = v.coordinates || {}
    if (lat == null || lng == null) fail.push(`${k}: no coordinate — this batch geocoded all ${EXPECTED_COUNT}`)
    else if (lat < ENVELOPE.latMin || lat > ENVELOPE.latMax || lng < ENVELOPE.lngMin || lng > ENVELOPE.lngMax) fail.push(`${k}: coordinate ${lat},${lng} outside the Guilford/Randolph/Rockingham envelope`)
    const prec = v.coordinates?.precision
    if (!PRECISION.has(prec)) fail.push(`${k}: coordinate precision "${prec}" — must be high|medium|low`)
    // ADR-12: no Google Places-derived coordinate may be persisted.
    const origin = v.coordinates?.origin || ''
    if (/places|google/i.test(origin)) fail.push(`${k}: coordinate origin "${origin}" is Places-derived — ADR-12 forbids persisting it`)
    if (!v.coordinates?.source_url) fail.push(`${k}: coordinate carries no source_url`)
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
    const slugs = venues.map((v) => v.slug)
    const keys = venues.map((v) => v.research_key)
    const { data: sc, error: e1 } = await db.from('facility_listings').select('slug').in('slug', slugs)
    if (e1) { fail.push(`slug collision check failed: ${e1.message}`) } else if (sc.length) fail.push(`slug collisions live: ${sc.map((r) => r.slug).join(', ')}`)

    // Proximity to EVERY pre-existing listing in the envelope. This is what proves "greenfield" on
    // each run rather than trusting the plan's one-time check. A hit is an owner decision
    // (reconcile vs insert), never something this script resolves on its own.
    const { data: near, error: e2 } = await db.from('facility_listings')
      .select('id, name, slug, lat, lng, status, source')
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
          if (d < RECONCILE_RADIUS_M) fail.push(`${v.research_key} is ${Math.round(d)} m from live listing "${r.name}" (${r.slug}, ${r.status}) — that is a RECONCILE decision for the owner, not an INSERT`)
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
console.log(`\n=== import-greensboro-merged · stage=${STAGE} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`input: ${INPUT} · batch: ${BATCH} · metro: ${METRO}\n`)

if (STAGE === 'candidates') {
  await preflight({ checkCollisions: true, candidateKeys: 'absent' })
  const dist = candidateRows.reduce((a, r) => (a[r.research_status] = (a[r.research_status] || 0) + 1, a), {})
  console.log(`\nTO INSERT into facility_candidates: ${candidateRows.length}`)
  console.log(`  research_status: ${JSON.stringify(dist)}`)
  console.log(`  address_source:  ${JSON.stringify(candidateRows.reduce((a, r) => (a[r.address_source] = (a[r.address_source] || 0) + 1, a), {}))}`)
  console.log(`  with coords ${candidateRows.filter((r) => r.lat != null).length}/${EXPECTED_COUNT} · with address ${candidateRows.filter((r) => r.address).length}/${EXPECTED_COUNT}`)
  console.log(`\nall ${EXPECTED_COUNT} rows:`)
  candidateRows.forEach((r) => console.log(`  + ${r.candidate_key.padEnd(26)} "${r.proposed_name}" | ${r.city}, ${r.state} | ${r.research_status}`))

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

  console.log(`\nTO INSERT into facility_listings: ${listingRows.length} (all status='draft', source='${BATCH}')`)
  console.log(`  access_type:         ${JSON.stringify(listingRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {}))}`)
  console.log(`  fee_type:            ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.fee_type)] = (a[String(r.fee_type)] || 0) + 1, a), {}))}`)
  console.log(`  reservation_policy:  ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.reservation_policy)] = (a[String(r.reservation_policy)] || 0) + 1, a), {}))}`)
  console.log(`  court_configuration: ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.court_configuration)] = (a[String(r.court_configuration)] || 0) + 1, a), {}))}`)
  console.log(`  net_setup:           ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.net_setup)] = (a[String(r.net_setup)] || 0) + 1, a), {}))}`)
  console.log(`  coordinate precision:${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.provenance?.coordinate?.precision)] = (a[String(r.provenance?.coordinate?.precision)] || 0) + 1, a), {}))}`)
  console.log(`  court_count present ${listingRows.filter((r) => r.court_count != null).length}/${EXPECTED_COUNT} · website ${listingRows.filter((r) => r.website).length}/${EXPECTED_COUNT} · phone ${listingRows.filter((r) => r.phone).length}/${EXPECTED_COUNT}`)
  console.log(`  low-precision coord (will be blocked at publish): ${listingRows.filter((r) => r.provenance?.coordinate?.precision === 'low').map((r) => r.slug).join(', ') || 'none'}`)
  console.log(`  ODbL-coordinate rows (attribution obligation): ${listingRows.filter((r) => r.provenance.odbl).length}/${EXPECTED_COUNT}`)
  console.log(`\nprovenance completeness: ${listingRows.filter((r) => Object.keys(r.provenance.fields).length > 0).length}/${EXPECTED_COUNT} rows carry a per-field evidence map`)
  console.log(`  evidence fields captured: ${[...new Set(listingRows.flatMap((r) => Object.keys(r.provenance.fields)))].join(', ')}`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written (0 INSERT).'); process.exit(0) }
  const { error } = await db.from('facility_listings').insert(listingRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await db.from('facility_listings').select('*', { count: 'exact', head: true }).eq('source', BATCH)
  console.log(`\ninserted ${listingRows.length} draft rows · facility_listings source='${BATCH}' now: ${count}`)
}

if (STAGE === 'publish') {
  // The gate is recomputed FROM THE DATABASE, not from the artifact.
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

  // ADR-14: no aggregator URL may reach a user-facing column on a published row.
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

// A publish is not visible until the directory cache knows about it. Every read in
// lib/directory/loadFacilities.ts is unstable_cache'd for 6h under the 'directory' tag, and this
// script writes straight to Postgres — so without this call /courts/in/<slug> hard-404s until the
// TTL lapses, which is exactly what happened to this batch on 2026-07-30. Marks the run failed
// (without aborting — the rows ARE published) if the cache could not be busted or the page is still
// not resolving.
if (STAGE === 'publish' && !DRY_RUN) {
  const rv = await revalidateDirectory({ metroArea: METRO })
  if (!rv.ok) process.exitCode = 1
}

if (STAGE === 'verify') {
  const { data: rows } = await db.from('facility_listings')
    .select('id, slug, status, source, metro_area, state, lat, lng, access_type, fee_type, reservation_policy, surface, court_configuration, line_type, net_setup, court_count, address_source, verification_status, osm_id, verified_by, provenance').eq('source', BATCH)
  const { data: cands } = await db.from('facility_candidates')
    .select('candidate_key, research_status, published_listing_id, existing_listing_id, metro_area').eq('batch', BATCH)
  const byStatus = (arr, k) => arr.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {})
  const listingIds = new Set(rows.map((r) => r.id))
  const published = rows.filter((r) => r.status === 'published')

  const checks = [
    [`facility_listings rows for batch = ${EXPECTED_COUNT}`, rows.length === EXPECTED_COUNT, rows.length],
    [`facility_candidates rows for batch = ${EXPECTED_COUNT}`, cands.length === EXPECTED_COUNT, cands.length],
    ['every listing source = batch tag (never "osm")', rows.every((r) => r.source === BATCH), byStatus(rows, 'source')],
    [`every listing metro_area = ${METRO}`, rows.every((r) => r.metro_area === METRO), byStatus(rows, 'metro_area')],
    ['every candidate metro_area matches', cands.every((c) => c.metro_area === METRO), byStatus(cands, 'metro_area')],
    ['every listing state = NC', rows.every((r) => r.state === 'NC'), byStatus(rows, 'state')],
    ['no listing carries an osm_id (pure greenfield, no reconcile)', rows.every((r) => r.osm_id == null), rows.filter((r) => r.osm_id).map((r) => r.slug)],
    ['no candidate carries existing_listing_id', cands.every((c) => c.existing_listing_id == null), 'ok'],
    ['every fee_type is a live enum value', rows.every((r) => r.fee_type == null || FEE_TYPE.has(r.fee_type)), byStatus(rows, 'fee_type')],
    ['every reservation_policy is a live enum value', rows.every((r) => r.reservation_policy == null || RESERVATION_POLICY.has(r.reservation_policy)), byStatus(rows, 'reservation_policy')],
    ['every court_configuration is a live enum value', rows.every((r) => r.court_configuration == null || COURT_CONFIGURATION.has(r.court_configuration)), byStatus(rows, 'court_configuration')],
    ['every line_type is a live enum value', rows.every((r) => r.line_type == null || LINE_TYPE.has(r.line_type)), byStatus(rows, 'line_type')],
    ['every net_setup is a live enum value', rows.every((r) => r.net_setup == null || NET_SETUP.has(r.net_setup)), byStatus(rows, 'net_setup')],
    ['surface NULL on all rows (owner decision Q5)', rows.every((r) => r.surface == null), byStatus(rows, 'surface')],
    ['verification_status = source_verified everywhere', rows.every((r) => r.verification_status === 'source_verified'), byStatus(rows, 'verification_status')],
    ['every listing has provenance with a candidate_key', rows.every((r) => r.provenance?.candidate_key), rows.filter((r) => !r.provenance?.candidate_key).length + ' missing'],
    ['every listing has a per-field evidence map', rows.every((r) => r.provenance?.fields && Object.keys(r.provenance.fields).length), rows.filter((r) => !Object.keys(r.provenance?.fields || {}).length).length + ' missing'],
    ['every listing carries the ODbL marker (all coords are OSM-derived)', rows.every((r) => r.provenance?.odbl), rows.filter((r) => !r.provenance?.odbl).length + ' missing'],
    ['no published row lacks a coordinate', published.every((r) => r.lat != null && r.lng != null), 'ok'],
    ['no published row has low-precision coordinate', published.every((r) => r.provenance?.coordinate?.precision !== 'low'), 'ok'],
    ['no published row has access_type unknown', published.every((r) => r.access_type !== 'unknown'), 'ok'],
    ['draft rows carry verified_by = NULL (reconcile-gate safety)', rows.filter((r) => r.status === 'draft').every((r) => r.verified_by == null), 'ok'],
    ['hp_hartley_ymca stays draft (low precision)', rows.filter((r) => r.slug === 'hartley-drive-family-ymca-high-point-nc').every((r) => r.status === 'draft'), byStatus(rows.filter((r) => r.slug === 'hartley-drive-family-ymca-high-point-nc'), 'status')],
    ['asheboro_rec_center address_source = osm (owner decision Q4)', rows.filter((r) => r.slug === 'asheboro-recreation-center-asheboro-nc').every((r) => r.address_source === 'osm'), byStatus(rows.filter((r) => r.slug === 'asheboro-recreation-center-asheboro-nc'), 'address_source')],
    ['published candidates ↔ published listings agree', cands.filter((c) => c.research_status === 'published').length === published.length, `${cands.filter((c) => c.research_status === 'published').length} vs ${published.length}`],
    ['every published_listing_id points at a real batch listing', cands.filter((c) => c.published_listing_id).every((c) => listingIds.has(c.published_listing_id)), 'ok'],
    ['no unpublished candidate carries published_listing_id', cands.filter((c) => c.research_status !== 'published').every((c) => c.published_listing_id == null), 'ok'],
    ['no coordinate is Places-derived (ADR-12)', rows.every((r) => !/places|google/i.test(r.provenance?.coordinate?.origin || '')), 'ok'],
  ]
  console.log(`listing status: ${JSON.stringify(byStatus(rows, 'status'))}`)
  console.log(`candidate research_status: ${JSON.stringify(byStatus(cands, 'research_status'))}`)
  console.log(`coordinate precision: ${JSON.stringify(rows.reduce((a, r) => (a[String(r.provenance?.coordinate?.precision)] = (a[String(r.provenance?.coordinate?.precision)] || 0) + 1, a), {}))}`)
  console.log(`court_count present: ${rows.filter((r) => r.court_count != null).length}/${EXPECTED_COUNT}\n`)
  let bad = 0
  for (const [label, ok, detail] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) bad++ }
  console.log(`\n${bad === 0 ? `ALL ${checks.length} CHECKS PASS ✓` : `${bad}/${checks.length} CHECKS FAILED ✗`}`)
  if (bad) process.exit(1)
}

console.log('\nDONE.')
