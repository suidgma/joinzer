/**
 * Directory — import + publish the Reno–Sparks merged candidate set (batch `reno-merged-2026-07-28`).
 *
 * Input: reno-count/merged-candidates.json — 36 venues, the union of two independent nine-stage
 * research runs (Claude v2 + ChatGPT Work, both 2026-07-27), merged and re-sourced 2026-07-28.
 * The artifact is gitignored (research working data carrying tier-4 aggregator URLs — ADR-14 makes
 * those a private research input that must never be republished).
 *
 * Three write stages, each independently dry-runnable and run in this order:
 *   --stage=candidates  36 rows → facility_candidates (staging / work queue). One atomic INSERT.
 *   --stage=listings    36 rows → facility_listings as status='draft'. One atomic INSERT.
 *   --stage=publish     recompute the gate FROM THE DATABASE, flip the qualifying rows to
 *                       status='published', then backlink published_listing_id + research_status.
 *   --stage=verify      read-only post-write assertions (no writes in any mode).
 *
 * Why both tables (and why all 36 in each):
 *   facility_candidates is the lifecycle/work queue but has no jsonb and no venue-fact columns —
 *   it cannot hold court_count / indoor / fee_type / website / phone or ANY per-field provenance.
 *   facility_listings.provenance (jsonb, unconstrained) can hold all of it. So every venue gets a
 *   listing row; the ones that don't clear the gate stay `draft` (invisible — lib/directory/
 *   loadFacilities.ts filters status='published') with verified_by left NULL so the reconcile gate
 *   in publish-facilities.mjs can't pick them up. Nothing is force-published.
 *
 * PUBLISH GATE (owner ruling 2026-07-28): coordinate present + coordinate precision != 'low' +
 * slug + access_type != 'unknown' + candidate research_status='verified'.
 *   court_count is deliberately NOT a gate condition. Brief §5's gate is "coords + slug + minimally
 *   viable enrichment (or manually approved)" — a non-null court_count was an extra condition the
 *   research side added, never Joinzer's. Removing it realigns us with policy.
 *
 * source: set EXPLICITLY to the batch tag. facility_listings.source is NOT NULL DEFAULT 'osm', and
 * omitting it would label this dataset as OSM-ingested — especially wrong here because 23 of the 36
 * rows genuinely DO carry OSM-derived coordinates, so the mislabel would be half-true and hard to
 * spot. Batch tag (not the literal 'merged_research') matches the live convention — 'osm',
 * 'az-review-2026-07', 'vegas-parity-2026-07' — and is what makes the one-statement rollback work:
 *   update facility_listings set status='draft' where source='reno-merged-2026-07-28';
 * The dataset KIND is recorded as provenance.method='merged_research'.
 *
 * Established path: supabase-js + service role, same as ingest/publish/enrich/seed. READ-ONLY
 * against every table other than facility_candidates + facility_listings. No deletes, ever.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-reno-merged.mjs --stage=candidates --dry-run
 *   node scripts/import-reno-merged.mjs --stage=candidates
 *   node scripts/import-reno-merged.mjs --stage=listings --dry-run
 *   node scripts/import-reno-merged.mjs --stage=listings
 *   node scripts/import-reno-merged.mjs --stage=publish --dry-run
 *   node scripts/import-reno-merged.mjs --stage=publish
 *   node scripts/import-reno-merged.mjs --stage=verify
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
const INPUT = (process.argv.find((a) => a.startsWith('--input=')) || '').split('=')[1] || 'reno-count/merged-candidates.json'
if (!['candidates', 'listings', 'publish', 'verify'].includes(STAGE)) {
  console.error('Pass --stage=candidates|listings|publish|verify'); process.exit(1)
}

const BATCH = 'reno-merged-2026-07-28'
const METRO = 'Reno-Sparks'
const nowIso = new Date().toISOString()

// ---- live CHECK vocabularies (verified against pg_constraint 2026-07-28; keep in lockstep) ----
const RESEARCH_STATUS = new Set(['pending', 'verified', 'probable', 'unresolved', 'unresolved_unnamed', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published'])
const ACCESS_TYPE = new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown'])
const FEE_TYPE = new Set(['free', 'fee', 'membership', 'unknown'])
const RESERVATION_POLICY = new Set(['none', 'drop_in', 'reservation_recommended', 'reservation_required', 'unknown'])
const ADDRESS_SOURCE = new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])

// Washoe/Storey envelope — a coordinate outside this is a data error, not a venue.
const ENVELOPE = { latMin: 39.0, latMax: 40.1, lngMin: -120.2, lngMax: -119.2 }

// Expected research_status shape of the artifact. A mismatch means the input changed under us.
const EXPECTED_STATUS_DIST = { verified: 33, probable: 2, held: 1 }

// ADR-14: aggregator hosts are a tier-4 private research input. They may sit in `provenance`
// (never rendered) but must never reach a user-facing column on a PUBLISHED row.
const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited/i

// Court counts suppressed on import — stored as NULL, full evidence retained in provenance.
// Same documented-exception idiom as publish-az-review.mjs's HELD set.
const COURT_COUNT_SUPPRESSED = {
  'regency-at-caramella-ranch':
    'Disputed and tier-5-only: 55places.com says 7, OSM says 3, REPORT.md §5 records the count as ' +
    'Unresolved with no controlling-entity source. The venue itself is legitimately `verified` on a ' +
    'tier-1 HOA source, so the row publishes — but an aggregator-only, actively disputed integer is ' +
    'not rendered as fact (ADR-14). Evidence kept in provenance.fields.court_count.',
}

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
  return Object.keys(e).length ? e : null
}

const EVIDENCE_FIELDS = ['name', 'address', 'court_count', 'access_type', 'indoor', 'fee_type', 'reservation_policy', 'lighting', 'pickleball_activity', 'public_notes']

function discoveredBy(v) {
  const p = v.present_in || {}
  const c = p.claude_run_2026_07_27, g = p.chatgpt_run_2026_07_27
  return c && g ? 'claude-run+chatgpt-run' : g ? 'chatgpt-run' : c ? 'claude-run' : 'unknown'
}

function reviewerNotes(v) {
  const parts = []
  const blockers = v.publish_gate?.blockers || []
  if (blockers.length) parts.push(`research-side blockers: ${blockers.join('; ')}`)
  if (v.status_rationale) parts.push(`status rationale: ${v.status_rationale}`)
  if (v._claude_run_conflict) parts.push(`conflict: ${v._claude_run_conflict}`)
  if (v._chatgpt_priority_review_note) parts.push(`chatgpt note: ${v._chatgpt_priority_review_note}`)
  if (v.next_review_at) parts.push(`next review ${v.next_review_at}: ${v.next_review_reason || ''}`.trim())
  if (COURT_COUNT_SUPPRESSED[v.research_key]) parts.push(`court_count suppressed on import — ${COURT_COUNT_SUPPRESSED[v.research_key]}`)
  parts.push(`facts + full per-field provenance on facility_listings slug=${v.slug}`)
  return parts.join(' | ')
}

// The full evidence map. facility_candidates has no jsonb, so this is the ONLY place the per-field
// source_url / source_tier / confidence / notes, the coordinate ladder record, aliases, sub_area,
// next_review_at, workbook_status and the publish-gate verdict survive. Nothing is dropped.
function provenanceFor(v) {
  const fields = {}
  for (const f of EVIDENCE_FIELDS) { const e = evidence(v[f]); if (e) fields[f] = { value: fieldVal(v[f]), ...e } }
  const p = {
    batch: BATCH,
    candidate_key: v.research_key,
    method: 'merged_research',
    merged_from: v.provenance?.merged_from ?? null,
    present_in: v.present_in ?? null,
    workbook_status: v.workbook_status ?? null,
    research_status_at_import: v.research_status,
    research_status_basis: v.provenance?.research_status_basis ?? null,
    status_rationale: v.status_rationale ?? null,
    evidence_tier_legend: doc._meta?.evidence_tiers ?? null,
    fields,
    coordinate: v.provenance?.coordinate ?? null,
    google_place_id: v.provenance?.google_place_id ?? null,
    address_source: v.address_source ?? null,
    aliases: v.aliases ?? [],
    sub_area: v.sub_area ?? null,
    next_review_at: v.next_review_at ?? null,
    next_review_reason: v.next_review_reason ?? null,
    publish_gate_research_side: v.publish_gate ?? null,
    conflicts: {
      claude_run: v._claude_run_conflict ?? null,
      chatgpt_priority_review: v._chatgpt_priority_review_note ?? null,
      claude_run_evidence_tier_as_labelled: v._claude_run_evidence_tier_as_labelled ?? null,
    },
    osm_clusters_within_800m: v.osm?.clusters_within_800m ?? null,
    odbl: /ODbL/i.test(v.coordinates?.licence || '')
      ? 'Coordinate is OSM-derived (ODbL). Published pages must carry OpenStreetMap attribution — wired in components/features/directory/OsmAttribution.tsx on /courts and /courts/[slug].'
      : null,
    imported_at: nowIso,
    artifact_updated: doc._meta?.updated ?? null,
  }
  if (COURT_COUNT_SUPPRESSED[v.research_key]) {
    p.court_count_suppressed = { reason: COURT_COUNT_SUPPRESSED[v.research_key], suppressed_value: fieldVal(v.court_count) }
  }
  return p
}

// ---------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------
const candidateRows = venues.map((v) => ({
  candidate_key: v.research_key,
  batch: BATCH,
  discovered_by: discoveredBy(v),
  proposed_name: fieldVal(v.name),
  address: orNull(fieldVal(v.address)),
  zip: orNull(v.zip),
  city: orNull(v.city),
  state: orNull(v.state),
  metro_area: METRO,
  lat: v.coordinates?.lat ?? null,
  lng: v.coordinates?.lng ?? null,
  google_place_id: orNull(fieldVal(v.google_place_id)),
  osm_id: null,                                   // the artifact carries cluster way-samples, not a canonical element id
  osm_clusters: v.osm?.clusters_within_800m?.length ?? null,
  classifier_type: null,                          // no Gemini classifier ran on this batch
  classifier_access_type: null,
  classifier_confidence: null,
  suggested_disposition: null,
  proposed_source_url: orNull(v.name?.source_url),
  url_source: 'merged_research',
  research_status: v.research_status,
  edited_name: null, edited_access_type: null, edited_city: null, edited_address: null,
  verified_source_url: orNull(v.name?.source_url),
  identity_confidence: orNull(v.name?.confidence),
  pickleball_confidence: orNull(v.pickleball_activity?.confidence),
  reviewer_notes: reviewerNotes(v),
  reviewed_by: BATCH,
  address_source: v.address_source ?? null,
  existing_listing_id: null,                      // greenfield — 0 pre-existing rows in the Reno envelope
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
  court_count: COURT_COUNT_SUPPRESSED[v.research_key] ? null : (fieldVal(v.court_count) ?? null),
  access_type: fieldVal(v.access_type) ?? 'unknown',
  fee_type: fieldVal(v.fee_type) ?? null,
  reservation_policy: fieldVal(v.reservation_policy) ?? null,
  indoor: fieldVal(v.indoor) ?? null,
  lighting: fieldVal(v.lighting) ?? null,
  surface: null,                                   // not researched — no fake default
  website: orNull(v.website),
  phone: orNull(v.phone),
  public_notes: orNull(fieldVal(v.public_notes)),
  google_place_id: orNull(fieldVal(v.google_place_id)),
  name_source_url: orNull(v.name?.source_url),
  verification_status: 'source_verified',
  verified_at: null, verified_by: null,            // published rows only — set by --stage=publish
  enrichment: null, enriched_at: null, enrichment_version: null,
  location_id: null,
  provenance: provenanceFor(v),
}))

// ---------------------------------------------------------------------------------------------
// Pre-flight assertions — any failure aborts. Never relax one to make a run pass.
// ---------------------------------------------------------------------------------------------
// checkCollisions       — slug + place_id must not already exist in facility_listings (all write stages)
// candidateKeys: 'absent' — pre-insert: no candidate_key may exist yet (--stage=candidates)
// candidateKeys: 'present'— post-insert: all 36 must exist exactly (--stage=listings)
async function preflight({ checkCollisions, candidateKeys }) {
  const fail = []
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})

  if (venues.length !== 36) fail.push(`venue count ${venues.length} != 36`)
  const distKeys = new Set([...Object.keys(EXPECTED_STATUS_DIST), ...Object.keys(dist)])
  for (const k of distKeys) if ((dist[k] || 0) !== (EXPECTED_STATUS_DIST[k] || 0)) fail.push(`status dist ${k}: got ${dist[k] || 0}, expected ${EXPECTED_STATUS_DIST[k] || 0}`)

  for (const v of venues) {
    const k = v.research_key
    if (!RESEARCH_STATUS.has(v.research_status)) fail.push(`${k}: research_status "${v.research_status}"`)
    const at = fieldVal(v.access_type); if (!ACCESS_TYPE.has(at)) fail.push(`${k}: access_type "${at}"`)
    const ft = fieldVal(v.fee_type); if (ft != null && !FEE_TYPE.has(ft)) fail.push(`${k}: fee_type "${ft}"`)
    const rp = fieldVal(v.reservation_policy); if (rp != null && !RESERVATION_POLICY.has(rp)) fail.push(`${k}: reservation_policy "${rp}"`)
    if (v.address_source == null || !ADDRESS_SOURCE.has(v.address_source)) fail.push(`${k}: address_source "${v.address_source}"`)
    if (v.address_source !== 'manual_research') fail.push(`${k}: address_source must be manual_research per ADR-12, got "${v.address_source}"`)
    const ic = v.name?.confidence; if (ic != null && !CONFIDENCE.has(ic)) fail.push(`${k}: identity_confidence "${ic}"`)
    const pc = v.pickleball_activity?.confidence; if (pc != null && !CONFIDENCE.has(pc)) fail.push(`${k}: pickleball_confidence "${pc}"`)
    if (!v.slug) fail.push(`${k}: missing slug`)
    if (!fieldVal(v.name)) fail.push(`${k}: missing name`)

    const { lat, lng } = v.coordinates || {}
    if (lat != null || lng != null) {
      if (lat == null || lng == null) fail.push(`${k}: half-null coordinate`)
      else if (lat < ENVELOPE.latMin || lat > ENVELOPE.latMax || lng < ENVELOPE.lngMin || lng > ENVELOPE.lngMax) fail.push(`${k}: coordinate ${lat},${lng} outside the Washoe/Storey envelope`)
    }
    // ADR-12: no Google Places `location` may be persisted.
    const origin = v.coordinates?.origin || ''
    if (/places|google/i.test(origin)) fail.push(`${k}: coordinate origin "${origin}" is Places-derived — ADR-12 forbids persisting it`)
    if (v.coordinates?.lat != null && !v.coordinates?.source_url) fail.push(`${k}: coordinate carries no source_url`)
  }

  // internal uniqueness
  for (const [label, vals] of [['slug', venues.map((v) => v.slug)], ['candidate_key', venues.map((v) => v.research_key)], ['google_place_id', venues.map((v) => fieldVal(v.google_place_id)).filter(Boolean)]]) {
    const seen = new Set(), dup = new Set()
    for (const x of vals) { if (seen.has(x)) dup.add(x); seen.add(x) }
    if (dup.size) fail.push(`duplicate ${label} in input: ${[...dup].join(', ')}`)
  }

  if (checkCollisions) {
    const slugs = venues.map((v) => v.slug)
    const placeIds = venues.map((v) => fieldVal(v.google_place_id)).filter(Boolean)
    const keys = venues.map((v) => v.research_key)
    const { data: sc, error: e1 } = await db.from('facility_listings').select('slug').in('slug', slugs)
    if (e1) { fail.push(`slug collision check failed: ${e1.message}`) } else if (sc.length) fail.push(`slug collisions live: ${sc.map((r) => r.slug).join(', ')}`)
    const { data: pc, error: e2 } = await db.from('facility_listings').select('slug, google_place_id').in('google_place_id', placeIds)
    if (e2) { fail.push(`place_id collision check failed: ${e2.message}`) } else if (pc.length) fail.push(`place_id collisions live: ${pc.map((r) => r.google_place_id).join(', ')}`)
    const { data: kc, error: e3 } = await db.from('facility_candidates').select('candidate_key').in('candidate_key', keys)
    if (e3) { fail.push(`candidate_key collision check failed: ${e3.message}`) }
    else if (candidateKeys === 'absent' && kc.length) fail.push(`candidate_key collisions live (candidates already seeded?): ${kc.map((r) => r.candidate_key).join(', ')}`)
    else if (candidateKeys === 'present' && kc.length !== keys.length) fail.push(`expected all 36 candidate_keys to exist before the listings insert, found ${kc.length}`)
  }

  console.log(`pre-flight: ${venues.length} venues · status ${JSON.stringify(dist)} · ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : `${fail.length} FAILURES ✗`}`)
  if (fail.length) { fail.forEach((f) => console.error(`  ✗ ${f}`)); console.error('\nABORT: pre-flight failed. Fix the input or the schema — never relax an assertion to make a run pass.'); process.exit(1) }
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------
console.log(`\n=== import-reno-merged · stage=${STAGE} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`input: ${INPUT} · batch: ${BATCH}\n`)

if (STAGE === 'candidates') {
  await preflight({ checkCollisions: true, candidateKeys: 'absent' })
  const dist = candidateRows.reduce((a, r) => (a[r.research_status] = (a[r.research_status] || 0) + 1, a), {})
  console.log(`\nTO INSERT into facility_candidates: ${candidateRows.length}`)
  console.log(`  research_status: ${JSON.stringify(dist)}`)
  console.log(`  discovered_by:   ${JSON.stringify(candidateRows.reduce((a, r) => (a[r.discovered_by] = (a[r.discovered_by] || 0) + 1, a), {}))}`)
  console.log(`  address_source:  ${JSON.stringify(candidateRows.reduce((a, r) => (a[r.address_source] = (a[r.address_source] || 0) + 1, a), {}))}`)
  console.log(`  with coords ${candidateRows.filter((r) => r.lat != null).length}/36 · with place_id ${candidateRows.filter((r) => r.google_place_id).length}/36 · with address ${candidateRows.filter((r) => r.address).length}/36`)
  console.log(`\nsample:`)
  candidateRows.slice(0, 3).forEach((r) => console.log(`  + ${r.candidate_key} "${r.proposed_name}" | ${r.city},${r.state} | ${r.research_status}`))

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await db.from('facility_candidates').insert(candidateRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  console.log(`\ninserted ${candidateRows.length} rows · facility_candidates batch='${BATCH}' now: ${count}`)
}

if (STAGE === 'listings') {
  await preflight({ checkCollisions: true, candidateKeys: 'present' })
  const { count: candCount } = await db.from('facility_candidates').select('*', { count: 'exact', head: true }).eq('batch', BATCH)
  if (candCount !== 36) { console.error(`\nABORT: expected 36 candidates for batch '${BATCH}', found ${candCount}. Run --stage=candidates first.`); process.exit(1) }

  console.log(`\nTO INSERT into facility_listings: ${listingRows.length} (all status='draft', source='${BATCH}')`)
  console.log(`  access_type: ${JSON.stringify(listingRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {}))}`)
  console.log(`  fee_type:    ${JSON.stringify(listingRows.reduce((a, r) => (a[String(r.fee_type)] = (a[String(r.fee_type)] || 0) + 1, a), {}))}`)
  console.log(`  court_count present ${listingRows.filter((r) => r.court_count != null).length}/36 · coords ${listingRows.filter((r) => r.lat != null).length}/36 · website ${listingRows.filter((r) => r.website).length}/36 · phone ${listingRows.filter((r) => r.phone).length}/36`)
  console.log(`  ODbL-coordinate rows (attribution obligation): ${listingRows.filter((r) => r.provenance.odbl).length}/36`)
  for (const [k, reason] of Object.entries(COURT_COUNT_SUPPRESSED)) console.log(`  ⚠ court_count suppressed for ${k} — ${reason.slice(0, 110)}…`)
  console.log(`\nprovenance completeness: ${listingRows.filter((r) => Object.keys(r.provenance.fields).length > 0).length}/36 rows carry a per-field evidence map`)
  console.log(`  evidence fields captured: ${[...new Set(listingRows.flatMap((r) => Object.keys(r.provenance.fields)))].join(', ')}`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await db.from('facility_listings').insert(listingRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const { count } = await db.from('facility_listings').select('*', { count: 'exact', head: true }).eq('source', BATCH)
  console.log(`\ninserted ${listingRows.length} draft rows · facility_listings source='${BATCH}' now: ${count}`)
}

if (STAGE === 'publish') {
  // The gate is recomputed FROM THE DATABASE, not from the artifact's own publish_gate flag.
  const { data: rows, error: rErr } = await db.from('facility_listings')
    .select('id, slug, name, lat, lng, access_type, status, website, name_source_url, provenance').eq('source', BATCH)
  if (rErr) { console.error('listing read failed:', rErr.message); process.exit(1) }
  const { data: cands, error: cErr } = await db.from('facility_candidates')
    .select('id, candidate_key, research_status, published_listing_id').eq('batch', BATCH)
  if (cErr) { console.error('candidate read failed:', cErr.message); process.exit(1) }
  if (rows.length !== 36 || cands.length !== 36) { console.error(`\nABORT: expected 36/36, found listings=${rows.length} candidates=${cands.length}. Run the earlier stages first.`); process.exit(1) }

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
  console.log(`       (court_count is NOT a gate condition — owner ruling 2026-07-28)\n`)
  console.log(`ELIGIBLE → publish: ${eligible.length}`)
  console.log(`BLOCKED  → stay draft: ${blocked.length}`)
  blocked.forEach(({ row, reasons }) => console.log(`  - ${row.slug} — ${reasons.join('; ')}`))
  console.log(`\nADR-14 aggregator scan over publishing rows: ${adr14.length === 0 ? 'CLEAN ✓' : 'VIOLATIONS ✗'}`)
  adr14.forEach(({ row }) => console.error(`  ✗ ${row.slug}: website=${row.website} name_source_url=${row.name_source_url}`))
  if (adr14.length) { console.error('\nABORT: an aggregator URL would land on a user-facing column of a published row (ADR-14).'); process.exit(1) }
  console.log(`\nODbL-coordinate rows among the publishing set: ${eligible.filter(({ row }) => row.provenance?.odbl).length} — attribution renders on /courts and /courts/[slug] (OsmAttribution).`)

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
  if (linked !== eligible.length) { console.error('\nWARNING: backlink incomplete — re-run --stage=publish (idempotent for already-published rows).'); process.exit(1) }
}

// A publish is not visible until the directory cache knows about it — the reads in
// lib/directory/loadFacilities.ts are unstable_cache'd for 6h under the 'directory' tag and this
// script writes straight to Postgres, so /courts/in/<slug> hard-404s until the TTL lapses
// (Greensboro-High Point + Little Rock, 2026-07-30). Marks the run failed without aborting — the
// rows ARE published.
if (STAGE === 'publish' && !DRY_RUN) {
  const rv = await revalidateDirectory({ metroArea: METRO })
  if (!rv.ok) process.exitCode = 1
}

if (STAGE === 'verify') {
  const { data: rows } = await db.from('facility_listings')
    .select('id, slug, status, source, metro_area, lat, lng, access_type, court_count, address_source, verified_by, provenance').eq('source', BATCH)
  const { data: cands } = await db.from('facility_candidates')
    .select('candidate_key, research_status, published_listing_id, address_source').eq('batch', BATCH)
  const byStatus = (arr, k) => arr.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {})
  const listingIds = new Set(rows.map((r) => r.id))

  const checks = [
    ['facility_listings rows for batch = 36', rows.length === 36, rows.length],
    ['facility_candidates rows for batch = 36', cands.length === 36, cands.length],
    ['every listing source = batch tag (never "osm")', rows.every((r) => r.source === BATCH), byStatus(rows, 'source')],
    ['every listing metro_area = Reno-Sparks', rows.every((r) => r.metro_area === METRO), byStatus(rows, 'metro_area')],
    ['every listing has provenance with a candidate_key', rows.every((r) => r.provenance?.candidate_key), rows.filter((r) => !r.provenance?.candidate_key).length + ' missing'],
    ['every listing has a per-field evidence map', rows.every((r) => r.provenance?.fields && Object.keys(r.provenance.fields).length), rows.filter((r) => !Object.keys(r.provenance?.fields || {}).length).length + ' missing'],
    ['address_source = manual_research wherever an address exists (listings)', rows.every((r) => r.address_source === 'manual_research'), byStatus(rows, 'address_source')],
    ['address_source = manual_research (candidates)', cands.every((c) => c.address_source === 'manual_research'), byStatus(cands, 'address_source')],
    ['no published row lacks a coordinate', rows.filter((r) => r.status === 'published').every((r) => r.lat != null && r.lng != null), 'ok'],
    ['no published row has low-precision coordinate', rows.filter((r) => r.status === 'published').every((r) => r.provenance?.coordinate?.precision !== 'low'), 'ok'],
    ['no published row has access_type unknown', rows.filter((r) => r.status === 'published').every((r) => r.access_type !== 'unknown'), 'ok'],
    ['draft rows carry verified_by = NULL (reconcile-gate safety)', rows.filter((r) => r.status === 'draft').every((r) => r.verified_by == null), 'ok'],
    ['published candidates ↔ published listings agree', cands.filter((c) => c.research_status === 'published').length === rows.filter((r) => r.status === 'published').length, `${cands.filter((c) => c.research_status === 'published').length} vs ${rows.filter((r) => r.status === 'published').length}`],
    ['every published_listing_id points at a real batch listing', cands.filter((c) => c.published_listing_id).every((c) => listingIds.has(c.published_listing_id)), 'ok'],
    ['no unpublished candidate carries published_listing_id', cands.filter((c) => c.research_status !== 'published').every((c) => c.published_listing_id == null), 'ok'],
    ['no coordinate is Places-derived (ADR-12)', rows.every((r) => !/places|google/i.test(r.provenance?.coordinate?.origin || '')), 'ok'],
  ]
  console.log(`listing status: ${JSON.stringify(byStatus(rows, 'status'))}`)
  console.log(`candidate research_status: ${JSON.stringify(byStatus(cands, 'research_status'))}`)
  console.log(`court_count present: ${rows.filter((r) => r.court_count != null).length}/36`)
  console.log(`ODbL-coordinate rows: ${rows.filter((r) => r.provenance?.odbl).length}/36 (published: ${rows.filter((r) => r.provenance?.odbl && r.status === 'published').length})\n`)
  let bad = 0
  for (const [label, ok, detail] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) bad++ }
  console.log(`\n${bad === 0 ? `ALL ${checks.length} CHECKS PASS ✓` : `${bad}/${checks.length} CHECKS FAILED ✗`}`)
  if (bad) process.exit(1)
}

console.log('\nDONE.')
