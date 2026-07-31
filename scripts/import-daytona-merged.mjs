/**
 * Directory — import + publish the Daytona Beach / Volusia County verified venue set
 * (batch `daytona-2026-07-30`).
 *
 * Input: daytona-count/daytona-candidates.json — 18 verified venues (17 fresh + 1 reconcile),
 * from court-verifier/output/daytona-2026-07-30/stage-2-verdicts.md with 7 owner decisions applied
 * (Chunk-3 brief, approved 2026-07-30). The artifact is gitignored (research working data carrying
 * tier-4 aggregator URLs — ADR-14 makes those a private research input, never republished).
 *
 * Mirrors scripts/import-reno-merged.mjs. The one structural difference from Reno (which was pure
 * greenfield, 36 INSERTs): this batch RECONCILES one venue (ormond-nova) onto a pre-existing dormant
 * OSM listing (osm_id=way/1367420477) instead of inserting a new row — so the listings stage is
 * 17 INSERT + 1 UPDATE.
 *
 * Three write stages, each independently dry-runnable and run in this order:
 *   --stage=candidates  18 rows -> facility_candidates (staging / work queue). One atomic INSERT.
 *   --stage=listings    17 rows -> facility_listings status='draft' (one atomic INSERT) + the
 *                       ormond-nova reconcile UPDATE keyed on osm_id (separate statement).
 *   --stage=publish     recompute the gate FROM THE DATABASE, flip qualifying rows to
 *                       status='published', then backlink published_listing_id + research_status.
 *   --stage=verify      read-only post-write assertions (no writes in any mode).
 *
 * WRITE SAFETY: every write (both INSERTs and the reconcile UPDATE and the publish UPDATE) sits
 * AFTER an `if (DRY_RUN) { ...; process.exit(0) }` guard. In --dry-run the process exits before any
 * write is issued. Only SELECTs (preflight collision checks, gate recompute reads) run in dry-run.
 *
 * PUBLISH GATE (owner ruling 2026-07-28, inherited): coordinate present + coordinate precision !=
 * 'low' + slug + access_type != 'unknown' + candidate research_status='verified'.
 *   court_count is deliberately NOT a gate condition.
 *   Expected effect here: nsb-bethune-beach is BLOCKED (coordinate precision='low') until re-geocoded
 *   to the exact 6656 S Atlantic number (owner flag 5). The Nova reconciled row publishes if it clears.
 *
 * source: set EXPLICITLY to the batch tag. facility_listings.source is NOT NULL DEFAULT 'osm'; omitting
 * it mislabels the dataset as OSM-ingested. Batch tag is also the one-statement rollback handle:
 *   update facility_listings set status='draft' where source='daytona-2026-07-30';
 * NOTE: the Nova reconcile RE-TAGS the OSM row's source from 'osm' to the batch tag, so the rollback
 * handle covers it too. The row's OSM lineage is preserved in provenance.osm_reconcile.osm_original.
 *
 * Established path: supabase-js + service role. READ-ONLY against every table other than
 * facility_candidates + facility_listings. No deletes, ever.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-daytona-merged.mjs --stage=candidates --dry-run
 *   node scripts/import-daytona-merged.mjs --stage=candidates
 *   node scripts/import-daytona-merged.mjs --stage=listings --dry-run
 *   node scripts/import-daytona-merged.mjs --stage=listings
 *   node scripts/import-daytona-merged.mjs --stage=publish --dry-run
 *   node scripts/import-daytona-merged.mjs --stage=publish
 *   node scripts/import-daytona-merged.mjs --stage=verify
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DRY_RUN = process.argv.includes('--dry-run')
const STAGE = (process.argv.find((a) => a.startsWith('--stage=')) || '').split('=')[1]
const INPUT = (process.argv.find((a) => a.startsWith('--input=')) || '').split('=')[1] || 'daytona-count/daytona-candidates.json'
if (!['candidates', 'listings', 'publish', 'verify'].includes(STAGE)) {
  console.error('Pass --stage=candidates|listings|publish|verify'); process.exit(1)
}

const BATCH = 'daytona-2026-07-30'
const METRO = 'Daytona Beach'
const nowIso = new Date().toISOString()

// ---- live CHECK vocabularies (re-verified against pg_constraint 2026-07-30; keep in lockstep) ----
const RESEARCH_STATUS = new Set(['pending', 'verified', 'probable', 'unresolved', 'unresolved_unnamed', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published'])
const ACCESS_TYPE = new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown'])
const FEE_TYPE = new Set(['free', 'fee', 'membership', 'unknown'])          // NOTE: no 'paid', no 'scheduled'
const RESERVATION_POLICY = new Set(['none', 'drop_in', 'reservation_recommended', 'reservation_required', 'unknown'])
const ADDRESS_SOURCE = new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])

// Volusia County envelope — a coordinate outside this is a data error, not a venue.
const ENVELOPE = { latMin: 28.80, latMax: 29.35, lngMin: -81.40, lngMax: -80.85 }

// Expected research_status shape of the artifact. A mismatch means the input changed under us.
const EXPECTED_STATUS_DIST = { verified: 18 }

// ADR-14: aggregator hosts are a tier-4 private research input. They may sit in `provenance`
// (never rendered) but must never reach a user-facing column on a PUBLISHED row.
const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited|goodrun|pickleballcourt\.directory/i

// The single reconcile: ormond-nova merges onto the dormant OSM row instead of inserting.
const RECONCILE_OSM_ID = 'way/1367420477'
const RECONCILE_LISTING_ID = '06570908-ffab-4f13-bd64-2ceeec427cd6'

// ---------------------------------------------------------------------------------------------
// Load + normalize
// ---------------------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(INPUT, 'utf8'))
const venues = doc.venues || []
const isReconcile = (v) => v.research_key === 'ormond-nova'

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
  return Object.keys(e).length ? e : null
}
const EVIDENCE_FIELDS = ['name', 'court_count', 'access_type', 'indoor', 'fee_type', 'reservation_policy', 'lighting', 'pickleball_activity', 'public_notes']

function reviewerNotes(v) {
  const parts = []
  if (v.reviewer_note) parts.push(v.reviewer_note)
  if (v.source_swap) parts.push(`source swap: ${v.source_swap}`)
  if (v.address_correction) parts.push(v.address_correction)
  if (v.conflict_note) parts.push(v.conflict_note)
  if (v.dedupe) parts.push(`dedupe: ${v.dedupe}`)
  if (v.same_site) parts.push(`same-site: ${v.same_site}`)
  if (isReconcile(v)) parts.push(`RECONCILE onto OSM ${RECONCILE_OSM_ID} (existing_listing_id=${RECONCILE_LISTING_ID})`)
  parts.push(`facts + full per-field provenance on facility_listings slug=${v.slug}`)
  return parts.join(' | ')
}

// The full evidence map. facility_candidates has no jsonb, so this is the ONLY place per-field
// source_url / source_tier / confidence / notes, the coordinate record, and the reconcile record survive.
function provenanceFor(v) {
  const fields = {}
  for (const f of EVIDENCE_FIELDS) { const e = evidence(v[f]); if (e) fields[f] = { value: fieldVal(v[f]), ...e } }
  const p = {
    batch: BATCH,
    candidate_key: v.research_key,
    method: 'directory_research',
    research_status_at_import: v.research_status,
    fields,
    coordinate: v.coordinates ? { lat: v.coordinates.lat, lng: v.coordinates.lng, precision: v.coordinates.precision ?? null, source_url: v.coordinates.source_url ?? null, origin: v.coordinates.origin ?? null, note: v.coordinates.note ?? null } : null,
    address_source: v.address_source ?? null,
    source_swap: v.source_swap ?? null,
    address_correction: v.address_correction ?? null,
    conflict_note: v.conflict_note ?? null,
    dedupe: v.dedupe ?? null,
    same_site: v.same_site ?? null,
    odbl: v.odbl ? 'Coordinate lineage is OSM-derived (ODbL). Published pages must carry OpenStreetMap attribution — components/features/directory/OsmAttribution.tsx on /courts and /courts/[slug].' : null,
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
  discovered_by: 'daytona-research',
  proposed_name: fieldVal(v.name),
  address: orNull(fieldVal(v.address)),
  zip: orNull(v.zip),
  city: orNull(v.city),
  state: orNull(v.state),
  metro_area: METRO,
  lat: v.coordinates?.lat ?? null,
  lng: v.coordinates?.lng ?? null,
  // Read from the artifact, never hardcoded null (fixed 2026-07-30). Hardcoding it here and on the
  // listing row is what left all 17 published Daytona rows without a place_id, which made
  // lib/directory/mapsUrl.ts fall through to its raw-coordinate rung — an anonymous dropped pin
  // instead of a venue card. This artifact carries no google_place_id, so the expression is a no-op
  // on a re-run; it exists so the next batch copied from this script inherits the right shape.
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
  identity_confidence: orNull(v.name?.confidence),
  pickleball_confidence: orNull(v.pickleball_activity?.confidence),
  reviewer_notes: reviewerNotes(v),
  reviewed_by: BATCH,
  address_source: v.address_source ?? null,
  // The reconcile venue links to the pre-existing OSM listing; the rest are greenfield.
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
    indoor: fieldVal(v.indoor) ?? null,
    lighting: fieldVal(v.lighting) ?? null,
    surface: null,
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

const insertVenues = venues.filter((v) => !isReconcile(v))       // 17
const reconcileVenue = venues.find(isReconcile)                   // 1 (ormond-nova)
const listingRows = insertVenues.map(listingFields)

// ---------------------------------------------------------------------------------------------
// Pre-flight assertions — any failure aborts. Never relax one to make a run pass.
// ---------------------------------------------------------------------------------------------
async function preflight({ checkCollisions, candidateKeys }) {
  const fail = []
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})

  if (venues.length !== 18) fail.push(`venue count ${venues.length} != 18`)
  const distKeys = new Set([...Object.keys(EXPECTED_STATUS_DIST), ...Object.keys(dist)])
  for (const k of distKeys) if ((dist[k] || 0) !== (EXPECTED_STATUS_DIST[k] || 0)) fail.push(`status dist ${k}: got ${dist[k] || 0}, expected ${EXPECTED_STATUS_DIST[k] || 0}`)
  if (!reconcileVenue) fail.push('expected exactly one reconcile venue (ormond-nova) — not found')

  for (const v of venues) {
    const k = v.research_key
    if (!RESEARCH_STATUS.has(v.research_status)) fail.push(`${k}: research_status "${v.research_status}"`)
    const at = fieldVal(v.access_type); if (!ACCESS_TYPE.has(at)) fail.push(`${k}: access_type "${at}"`)
    const ft = fieldVal(v.fee_type); if (ft != null && !FEE_TYPE.has(ft)) fail.push(`${k}: fee_type "${ft}" (not a live enum — 'paid'/'scheduled' are NOT valid)`)
    const rp = fieldVal(v.reservation_policy); if (rp != null && !RESERVATION_POLICY.has(rp)) fail.push(`${k}: reservation_policy "${rp}"`)
    if (v.address_source == null || !ADDRESS_SOURCE.has(v.address_source)) fail.push(`${k}: address_source "${v.address_source}"`)
    const ic = v.name?.confidence; if (ic != null && !CONFIDENCE.has(ic)) fail.push(`${k}: identity_confidence "${ic}"`)
    const pc = v.pickleball_activity?.confidence; if (pc != null && !CONFIDENCE.has(pc)) fail.push(`${k}: pickleball_confidence "${pc}"`)
    if (!v.slug) fail.push(`${k}: missing slug`)
    if (!fieldVal(v.name)) fail.push(`${k}: missing name`)

    const { lat, lng } = v.coordinates || {}
    if (lat != null || lng != null) {
      if (lat == null || lng == null) fail.push(`${k}: half-null coordinate`)
      else if (lat < ENVELOPE.latMin || lat > ENVELOPE.latMax || lng < ENVELOPE.lngMin || lng > ENVELOPE.lngMax) fail.push(`${k}: coordinate ${lat},${lng} outside the Volusia envelope`)
    }
    const origin = v.coordinates?.origin || ''
    if (/places|google/i.test(origin)) fail.push(`${k}: coordinate origin "${origin}" is Places-derived — ADR-12 forbids persisting it`)
    if (v.coordinates?.lat != null && !v.coordinates?.source_url) fail.push(`${k}: coordinate carries no source_url`)
  }

  // internal uniqueness (slug, candidate_key)
  for (const [label, vals] of [['slug', venues.map((v) => v.slug)], ['candidate_key', venues.map((v) => v.research_key)]]) {
    const seen = new Set(), dup = new Set()
    for (const x of vals) { if (seen.has(x)) dup.add(x); seen.add(x) }
    if (dup.size) fail.push(`duplicate ${label} in input: ${[...dup].join(', ')}`)
  }

  if (checkCollisions) {
    // Fresh-insert slugs must NOT already exist. The reconcile slug is checked separately: it may
    // only collide with the row we are reconciling onto (or nothing).
    const insertSlugs = insertVenues.map((v) => v.slug)
    const keys = venues.map((v) => v.research_key)
    const { data: sc, error: e1 } = await db.from('facility_listings').select('slug').in('slug', insertSlugs)
    if (e1) { fail.push(`slug collision check failed: ${e1.message}`) } else if (sc.length) fail.push(`slug collisions live (insert set): ${sc.map((r) => r.slug).join(', ')}`)

    // Reconcile slug: allowed to be free, or to belong to the reconcile target only.
    const { data: rc, error: e1b } = await db.from('facility_listings').select('id, slug, osm_id, status').eq('slug', reconcileVenue.slug)
    if (e1b) { fail.push(`reconcile slug check failed: ${e1b.message}`) }
    else if (rc.length && !(rc.length === 1 && rc[0].id === RECONCILE_LISTING_ID)) fail.push(`reconcile slug "${reconcileVenue.slug}" collides with a row that is NOT the reconcile target: ${rc.map((r) => r.id).join(', ')}`)

    // Reconcile target must exist and still be draft.
    const { data: tgt, error: e1c } = await db.from('facility_listings').select('id, osm_id, status, name, slug').eq('osm_id', RECONCILE_OSM_ID)
    if (e1c) { fail.push(`reconcile target check failed: ${e1c.message}`) }
    else if (tgt.length !== 1) fail.push(`reconcile target osm_id=${RECONCILE_OSM_ID}: expected exactly 1 row, found ${tgt.length}`)
    else {
      if (tgt[0].id !== RECONCILE_LISTING_ID) fail.push(`reconcile target id mismatch: expected ${RECONCILE_LISTING_ID}, found ${tgt[0].id}`)
      if (tgt[0].status !== 'draft') fail.push(`reconcile target is not draft (status=${tgt[0].status}) — abort, do not overwrite a published row`)
    }

    const { data: kc, error: e3 } = await db.from('facility_candidates').select('candidate_key').in('candidate_key', keys)
    if (e3) { fail.push(`candidate_key collision check failed: ${e3.message}`) }
    else if (candidateKeys === 'absent' && kc.length) fail.push(`candidate_key collisions live (candidates already seeded?): ${kc.map((r) => r.candidate_key).join(', ')}`)
    else if (candidateKeys === 'present' && kc.length !== keys.length) fail.push(`expected all 18 candidate_keys to exist before the listings stage, found ${kc.length}`)
  }

  console.log(`pre-flight: ${venues.length} venues · status ${JSON.stringify(dist)} · ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : `${fail.length} FAILURES ✗`}`)
  if (fail.length) { fail.forEach((f) => console.error(`  ✗ ${f}`)); console.error('\nABORT: pre-flight failed. Fix the input or the schema — never relax an assertion to make a run pass.'); process.exit(1) }
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------
console.log(`\n=== import-daytona-merged · stage=${STAGE} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`input: ${INPUT} · batch: ${BATCH}\n`)

if (STAGE === 'candidates') {
  await preflight({ checkCollisions: true, candidateKeys: 'absent' })
  const dist = candidateRows.reduce((a, r) => (a[r.research_status] = (a[r.research_status] || 0) + 1, a), {})
  console.log(`\nTO INSERT into facility_candidates: ${candidateRows.length}`)
  console.log(`  research_status: ${JSON.stringify(dist)}`)
  console.log(`  with coords ${candidateRows.filter((r) => r.lat != null).length}/18 · with address ${candidateRows.filter((r) => r.address).length}/18 · reconcile (existing_listing_id set) ${candidateRows.filter((r) => r.existing_listing_id).length}/18`)
  console.log(`\nall 18 rows:`)
  candidateRows.forEach((r) => console.log(`  + ${r.candidate_key.padEnd(26)} "${r.proposed_name}" | ${r.city}, ${r.state} | ${r.research_status}${r.existing_listing_id ? ` | RECONCILE->${r.existing_listing_id}` : ''}`))

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await db.from('facility_candidates').insert(candidateRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  console.log(`\ninserted ${candidateRows.length} rows · facility_candidates batch='${BATCH}' now: ${count}`)
}

if (STAGE === 'listings') {
  await preflight({ checkCollisions: true, candidateKeys: 'present' })
  const { count: candCount } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  if (candCount !== 18) { console.error(`\nABORT: expected 18 candidates for batch '${BATCH}', found ${candCount}. Run --stage=candidates first.`); process.exit(1) }

  console.log(`\nTO INSERT into facility_listings: ${listingRows.length} (status='draft', source='${BATCH}')`)
  console.log(`  access_type: ${JSON.stringify(listingRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {}))}`)
  console.log(`  fee_type:    ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.fee_type)] = (a[String(r.fee_type)] || 0) + 1, a), {}))}`)
  console.log(`  court_count present ${listingRows.filter((r) => r.court_count != null).length}/17 · coords ${listingRows.filter((r) => r.lat != null).length}/17`)
  console.log(`  low-precision coord (will be blocked at publish): ${listingRows.filter((r) => r.provenance?.coordinate?.precision === 'low').map((r) => r.slug).join(', ') || 'none'}`)

  // The Nova reconcile — computed and previewed alongside the inserts.
  const reconcileFields = listingFields(reconcileVenue)
  console.log(`\nTO UPDATE (reconcile, NOT insert) — ormond-nova onto OSM row:`)
  console.log(`  where osm_id='${RECONCILE_OSM_ID}' and status='draft'  (id=${RECONCILE_LISTING_ID})`)
  console.log(`  BEFORE: name="Pickleball Courts"  slug="${reconcileVenue.reconcile.osm_original.old_slug}"  source="osm"  city=null  metro_area=null  provenance=null`)
  console.log(`  AFTER:  name="${reconcileFields.name}"  slug="${reconcileFields.slug}"  source="${reconcileFields.source}"  city="${reconcileFields.city}"  metro_area="${reconcileFields.metro_area}"  access_type="${reconcileFields.access_type}"  fee_type=${reconcileFields.fee_type}`)
  console.log(`          osm_id PRESERVED (way/1367420477) · original OSM centroid+surface stashed in provenance.osm_reconcile.osm_original · ODbL marker set`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written (0 INSERT, 0 UPDATE).'); process.exit(0) }

  const { error: insErr } = await db.from('facility_listings').insert(listingRows)
  if (insErr) { console.error('\nINSERT failed (atomic — nothing inserted):', insErr.message); process.exit(1) }
  console.log(`\ninserted ${listingRows.length} draft rows`)

  // Reconcile UPDATE — guarded on status='draft' so it's a no-op if the row was published in the interim.
  const { data: upd, error: updErr } = await db.from('facility_listings')
    .update(reconcileFields).eq('osm_id', RECONCILE_OSM_ID).eq('status', 'draft').select('id, slug, name, source')
  if (updErr) { console.error('\nreconcile UPDATE failed:', updErr.message); process.exit(1) }
  if (!upd || upd.length !== 1) { console.error(`\nreconcile UPDATE affected ${upd?.length ?? 0} rows (expected 1) — investigate; the OSM row may have been published or removed.`); process.exit(1) }
  console.log(`reconciled 1 row: ${upd[0].slug} (was "Pickleball Courts")`)

  const { count } = await db.from('facility_listings').select('*', { count: 'exact', head: true }).eq('source', BATCH)
  console.log(`facility_listings source='${BATCH}' now: ${count} (expect 18 = 17 insert + 1 reconcile)`)
}

if (STAGE === 'publish') {
  const { data: rows, error: rErr } = await db.from('facility_listings')
    .select('id, slug, name, lat, lng, access_type, status, website, name_source_url, provenance').eq('source', BATCH)
  if (rErr) { console.error('listing read failed:', rErr.message); process.exit(1) }
  const { data: cands, error: cErr } = await db.from('facility_candidates')
    .select('id, candidate_key, research_status, published_listing_id').eq('batch', BATCH)
  if (cErr) { console.error('candidate read failed:', cErr.message); process.exit(1) }
  if (rows.length !== 18 || cands.length !== 18) { console.error(`\nABORT: expected 18/18, found listings=${rows.length} candidates=${cands.length}. Run the earlier stages first.`); process.exit(1) }

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
  console.log(`backlinked ${linked}/${eligible.length} candidates`)
  if (linked !== eligible.length) { console.error('\nWARNING: backlink incomplete — re-run --stage=publish (idempotent).'); process.exit(1) }
}

if (STAGE === 'verify') {
  const { data: rows } = await db.from('facility_listings')
    .select('id, slug, status, source, metro_area, lat, lng, access_type, fee_type, court_count, osm_id, verified_by, provenance').eq('source', BATCH)
  const { data: cands } = await db.from('facility_candidates')
    .select('candidate_key, research_status, published_listing_id, existing_listing_id').eq('batch', BATCH)
  const byStatus = (arr, k) => arr.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {})
  const listingIds = new Set(rows.map((r) => r.id))

  const checks = [
    ['facility_listings rows for batch = 18', rows.length === 18, rows.length],
    ['facility_candidates rows for batch = 18', cands.length === 18, cands.length],
    ['every listing source = batch tag (never "osm")', rows.every((r) => r.source === BATCH), byStatus(rows, 'source')],
    ['every listing metro_area = Daytona Beach', rows.every((r) => r.metro_area === METRO), byStatus(rows, 'metro_area')],
    ['reconciled Nova row present (osm_id preserved)', rows.some((r) => r.osm_id === RECONCILE_OSM_ID), rows.filter((r) => r.osm_id === RECONCILE_OSM_ID).map((r) => r.slug)],
    ['reconciled Nova row carries osm_reconcile provenance', rows.filter((r) => r.osm_id === RECONCILE_OSM_ID).every((r) => r.provenance?.osm_reconcile?.osm_id === RECONCILE_OSM_ID), 'ok'],
    ['no listing has invalid fee_type (paid/scheduled)', rows.every((r) => r.fee_type == null || FEE_TYPE.has(r.fee_type)), byStatus(rows, 'fee_type')],
    ['every listing has provenance with a candidate_key', rows.every((r) => r.provenance?.candidate_key), rows.filter((r) => !r.provenance?.candidate_key).length + ' missing'],
    ['no published row lacks a coordinate', rows.filter((r) => r.status === 'published').every((r) => r.lat != null && r.lng != null), 'ok'],
    ['no published row has low-precision coordinate', rows.filter((r) => r.status === 'published').every((r) => r.provenance?.coordinate?.precision !== 'low'), 'ok'],
    ['no published row has access_type unknown', rows.filter((r) => r.status === 'published').every((r) => r.access_type !== 'unknown'), 'ok'],
    ['draft rows carry verified_by = NULL (reconcile-gate safety)', rows.filter((r) => r.status === 'draft').every((r) => r.verified_by == null), 'ok'],
    // Slug corrected 2026-07-30 to 'mary-mcleod-bethune-beach-park-…' by the name audit. Asserts the
    // row EXISTS and is draft: the old form filtered on a slug that no longer matches anything, and
    // `[].every()` is true, so the check would have kept passing while testing nothing.
    ['bethune-beach stays draft (low precision)', rows.filter((r) => r.slug === 'mary-mcleod-bethune-beach-park-new-smyrna-beach-fl').length === 1 && rows.filter((r) => r.slug === 'mary-mcleod-bethune-beach-park-new-smyrna-beach-fl').every((r) => r.status === 'draft'), 'ok'],
    ['published candidates ↔ published listings agree', cands.filter((c) => c.research_status === 'published').length === rows.filter((r) => r.status === 'published').length, `${cands.filter((c) => c.research_status === 'published').length} vs ${rows.filter((r) => r.status === 'published').length}`],
    ['every published_listing_id points at a real batch listing', cands.filter((c) => c.published_listing_id).every((c) => listingIds.has(c.published_listing_id)), 'ok'],
    ['Nova candidate carries existing_listing_id', cands.filter((c) => c.candidate_key === 'ormond-nova').every((c) => c.existing_listing_id === RECONCILE_LISTING_ID), 'ok'],
    ['no coordinate is Places-derived (ADR-12)', rows.every((r) => !/places|google/i.test(r.provenance?.coordinate?.origin || '')), 'ok'],
  ]
  console.log(`listing status: ${JSON.stringify(byStatus(rows, 'status'))}`)
  console.log(`candidate research_status: ${JSON.stringify(byStatus(cands, 'research_status'))}`)
  console.log(`court_count present: ${rows.filter((r) => r.court_count != null).length}/18\n`)
  let bad = 0
  for (const [label, ok, detail] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) bad++ }
  console.log(`\n${bad === 0 ? `ALL ${checks.length} CHECKS PASS ✓` : `${bad}/${checks.length} CHECKS FAILED ✗`}`)
  if (bad) process.exit(1)
}

console.log('\nDONE.')
