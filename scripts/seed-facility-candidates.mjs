/**
 * Directory — one-time seed of public.facility_candidates from the final Phoenix review sheet.
 *
 * Input: phoenix-count/phoenix_candidates_seed.csv — the final 481-row Phoenix review sheet, which
 * is authoritative for research_status (already carries published×139, duplicate on the intra-batch
 * holds, held on Courtly). The only status derivation is mapping the ~51 rows that have just the old
 * `decision` column (approve→verified, reject→not_venue, merge→duplicate). The file's 'published' set
 * is cross-checked against facility_listings.provenance.candidate_id (must agree on 139), and the
 * final distribution is gated to an exact expected shape. existing_id is validated against real
 * facility_listings ids. Insert-only + atomic (one multi-row INSERT); fails on any candidate_key
 * conflict (table must be empty).
 *
 * READ-ONLY against facility_listings (provenance lookup + id validation) — never writes it.
 *
 *   node scripts/seed-facility-candidates.mjs --dry-run   # validate + report, no writes
 *   node scripts/seed-facility-candidates.mjs             # live insert
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
const BATCH = 'az-review-2026-07'
const CSV = process.argv.find((a) => a.endsWith('.csv')) || 'phoenix-count/phoenix_candidates_seed.csv'

// ---- allowed values for the CHECK-constrained columns (must match the migration) ----
const STATUS = new Set(['pending', 'verified', 'probable', 'unresolved', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published'])
const DISPO = new Set(['likely_venue', 'likely_reject', 'uncertain'])
const CONF = new Set(['low', 'medium', 'high'])

function parseCSV(text) {
  const recs = []; let rec = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { rec.push(f); f = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { rec.push(f); recs.push(rec); rec = [] ; f = '' }
    else f += c
  }
  if (f.length || rec.length) { rec.push(f); recs.push(rec) }
  const header = recs[0].map((h) => h.trim())
  return recs.slice(1).filter((r) => r.some((v) => v.trim() !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const rows = parseCSV(readFileSync(CSV, 'utf8'))
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isNaN(n) ? null : n }
const int = (v) => { const n = num(v); return n == null ? null : Math.trunc(n) }
const orNull = (v) => (v == null || v === '' ? null : v)

// decision → research_status for the blank-status rows
function statusFromDecision(d) {
  const s = (d || '').trim().toLowerCase()
  if (s.startsWith('approve')) return 'verified'
  if (s.startsWith('reject')) return 'not_venue'
  if (s.startsWith('merge')) return 'duplicate'
  return null
}

// ---- read facility_listings (READ-ONLY): id set + provenance candidate_id → id ----
const { data: fl, error: flErr } = await db.from('facility_listings').select('id, provenance')
if (flErr) { console.error('facility_listings read failed:', flErr.message); process.exit(1) }
const flIds = new Set(fl.map((r) => r.id))
const provToId = new Map()
for (const r of fl) { const cid = r.provenance && r.provenance.candidate_id; if (cid) provToId.set(cid, r.id) }

// ---- build rows + collect validation issues ----
const issues = { badStatus: [], badDispo: [], badIdConf: [], badPickConf: [], unmappable: [], badExisting: [], dupKeys: [], badLatLng: [] }
const seenKeys = new Set()
const statusDist = {}
let derivedFromDecision = 0
let publishedLinked = 0, publishedUnlinked = []
let existingLinked = 0
const filePublished = new Set(), provPublished = new Set()

const out = rows.map((r) => {
  const key = r.candidate_id
  if (seenKeys.has(key)) issues.dupKeys.push(key); seenKeys.add(key)

  // research_status: the FILE is authoritative (it already carries published/duplicate/held). The
  // only derivation is mapping the ~51 rows that have just the old `decision` column.
  let status = (r.research_status || '').trim().toLowerCase()
  if (!status) { const d = statusFromDecision(r.decision); if (d) { status = d; derivedFromDecision++ } else { issues.unmappable.push(`${key} (decision=${JSON.stringify(r.decision)})`); status = 'pending' } }
  if (!STATUS.has(status)) issues.badStatus.push(`${key}: ${status}`)
  statusDist[status] = (statusDist[status] || 0) + 1

  // published_listing_id + cross-check: the file's 'published' set MUST equal the actual publish
  // state (facility_listings.provenance.candidate_id). Disagreement is a hard stop.
  let publishedListingId = null
  if (provToId.has(key)) provPublished.add(key)
  if (status === 'published') {
    filePublished.add(key)
    const pid = provToId.get(key)
    if (pid) { publishedListingId = pid; publishedLinked++ } else publishedUnlinked.push(key)
  }

  const dispo = (r.suggested_disposition || '').trim().toLowerCase() || null
  if (dispo && !DISPO.has(dispo)) issues.badDispo.push(`${key}: ${dispo}`)
  const idConf = (r.identity_confidence || '').trim().toLowerCase() || null
  if (idConf && !CONF.has(idConf)) issues.badIdConf.push(`${key}: ${idConf}`)
  const pkConf = (r.pickleball_confidence || '').trim().toLowerCase() || null
  if (pkConf && !CONF.has(pkConf)) issues.badPickConf.push(`${key}: ${pkConf}`)

  const lat = num(r.lat), lng = num(r.lng)
  if ((lat != null && (lat < -90 || lat > 90)) || (lng != null && (lng < -180 || lng > 180))) issues.badLatLng.push(key)

  // existing_id → existing_listing_id (validate against real facility_listings ids)
  let existingListingId = null
  const rawExisting = orNull(r.existing_id)
  if (rawExisting) { if (flIds.has(rawExisting)) { existingListingId = rawExisting; existingLinked++ } else issues.badExisting.push(`${key}: ${rawExisting}`) }

  return {
    candidate_key: key, batch: BATCH,
    discovered_by: orNull(r.discovered_by), proposed_name: orNull(r.proposed_name),
    address: null, zip: null, city: orNull(r.city), state: 'AZ', metro_area: 'Phoenix',
    lat, lng, google_place_id: orNull(r.place_id), osm_id: null, osm_clusters: int(r.osm_clusters),
    classifier_type: orNull(r.gemini_type), classifier_access_type: orNull(r.gemini_access_type),
    classifier_confidence: num(r.gemini_confidence), suggested_disposition: dispo,
    proposed_source_url: orNull(r.proposed_source_url), url_source: orNull(r.url_source),
    research_status: status,
    edited_name: orNull(r.edited_name), edited_access_type: orNull(r.edited_access_type),
    edited_city: orNull(r.edited_city), edited_address: orNull(r.edited_address),
    verified_source_url: orNull(r.verified_source_url), identity_confidence: idConf, pickleball_confidence: pkConf,
    reviewer_notes: orNull(r.reviewer_notes), reviewed_by: BATCH,
    existing_listing_id: existingListingId, published_listing_id: publishedListingId,
  }
})

// ---- report ----
const problems = Object.values(issues).reduce((a, v) => a + v.length, 0)
console.log(`\n=== seed-facility-candidates — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`input: ${CSV}`)
console.log(`rows parsed: ${out.length}`)
console.log(`\nfinal research_status distribution:`)
for (const [k, v] of Object.entries(statusDist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`  (derived from old 'decision' for ${derivedFromDecision} previously-blank rows; pending should be 0)`)
console.log(`\npublished_listing_id: linked ${publishedLinked} / status=published ${statusDist.published || 0}` + (publishedUnlinked.length ? ` — UNLINKED: ${publishedUnlinked.join(', ')}` : ' — all linked ✓'))
console.log(`existing_listing_id: linked ${existingLinked}` + (issues.badExisting.length ? ` — ${issues.badExisting.length} skipped (no matching facility_listings.id)` : ''))
if (issues.badExisting.length) issues.badExisting.slice(0, 20).forEach((x) => console.log(`    skip existing_id ${x}`))
console.log(`\nvalidation issues (must be 0 before live): ${problems}`)
for (const [k, v] of Object.entries(issues)) if (v.length) console.log(`  ${k} (${v.length}): ${v.slice(0, 15).join(' | ')}`)

// ---- cross-check: file's 'published' set vs facility_listings provenance (must agree on 139) ----
const onlyInFile = [...filePublished].filter((k) => !provPublished.has(k))
const onlyInProv = [...provPublished].filter((k) => !filePublished.has(k))
const crossOk = onlyInFile.length === 0 && onlyInProv.length === 0
console.log(`\ncross-check (file 'published' vs facility_listings provenance): file=${filePublished.size} prov=${provPublished.size} ${crossOk ? 'AGREE ✓' : 'DISAGREE ✗'}`)
if (onlyInFile.length) console.log(`  in file not prov: ${onlyInFile.join(', ')}`)
if (onlyInProv.length) console.log(`  in prov not file: ${onlyInProv.join(', ')}`)

// ---- exact expected-distribution gate ----
const EXPECTED = { published: 139, not_venue: 171, unresolved: 93, duplicate: 29, verified: 40, probable: 6, not_pickleball: 2, held: 1 }
const allKeys = new Set([...Object.keys(EXPECTED), ...Object.keys(statusDist)])
const distOk = [...allKeys].every((k) => (statusDist[k] || 0) === (EXPECTED[k] || 0))
console.log(`expected-distribution gate: ${distOk ? 'MATCH ✓' : 'MISMATCH ✗'}`)
if (!distOk) for (const k of allKeys) if ((statusDist[k] || 0) !== (EXPECTED[k] || 0)) console.log(`  ${k}: got ${statusDist[k] || 0}, expected ${EXPECTED[k] || 0}`)

if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); }
else {
  const hardIssues = problems - issues.badExisting.length
  if (hardIssues > 0 || !crossOk || !distOk) { console.error('\nABORT: cross-check / distribution / validation not clean — refusing to seed.'); process.exit(1) }
  const { error } = await db.from('facility_candidates').insert(out)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  console.log(`\ninserted ${out.length} rows into facility_candidates`)
  const { count } = await db.from('facility_candidates').select('*', { count: 'exact', head: true })
  console.log(`facility_candidates row count now: ${count}`)
}
