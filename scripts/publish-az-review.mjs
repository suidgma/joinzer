/**
 * Directory Session 3d-5 — publish the human+agent-verified AZ (Phoenix) venue batch.
 *
 * Reads phoenix-count/verified_publish.csv (review output), dedupes against facility_listings,
 * INSERTs new rows as status='published' (tagged source='az-review-2026-07' for one-command
 * rollback), and UPDATEs draft matches to published (tagged verified_by, prior status logged).
 *
 * Established path: supabase-js + service role (like ingest/publish/enrich/reverse-geocode).
 * Slug parity: kebab()/baseSlug() copied verbatim from scripts/ingest-osm-courts.mjs.
 *
 * Atomicity: the inserts go in as ONE multi-row INSERT (atomic). The ~few updates are
 * individually atomic, fully tagged, and reversible (prior status printed in the dry-run).
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/publish-az-review.mjs --dry-run        # no writes; prints the full plan
 *   node scripts/publish-az-review.mjs                  # live
 *   node scripts/publish-az-review.mjs --include-courtly # also publish phx-0210 (held by default)
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
// Held out of this publish (verified 2026-07-23): phx-0210 Courtly (booking app, not a venue) + 7
// confirmed intra-batch duplicates whose twin is published instead (0390→0144/0387, 0112→0413,
// 0101→0353, 0123→0132, 0415→0467, 0114→0109, 0375→0422) + Monte Vista 0356 (== 0468 "Village
// Resort", same resort per web verification). Fountain Hills 0013/0014 are distinct East/West → both kept.
const HELD = new Set(['phx-0210', 'phx-0390', 'phx-0112', 'phx-0101', 'phx-0123', 'phx-0415', 'phx-0114', 'phx-0375', 'phx-0356'])
const CSV = 'phoenix-count/verified_publish.csv'
const CANDIDATES = 'phoenix-count/candidates.json'

// ---- slug helpers: copied verbatim from scripts/ingest-osm-courts.mjs (keep slug parity) ----
function kebab(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
function baseSlug(name, city, state) {
  return [name, city, state].map(kebab).filter(Boolean).join('-') || 'court'
}
// generic-name test (verbatim from scripts/publish-facilities.mjs). A matched OSM row often carries a
// generic name ("Pickleball", "8 Pickleball Courts"); on publish we replace it with the verified name.
function isGenericName(name) {
  const t = (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pickleball|pickle|ball|courts?|tennis|the|a|an|of|at|and)\b/g, ' ')
    .replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length < 3
}

// ---- CSV parse (RFC4180-ish; handles quoted fields) ----
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
  const header = recs[0]
  return recs.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const rows = parseCSV(readFileSync(CSV, 'utf8'))
const candidates = JSON.parse(readFileSync(CANDIDATES, 'utf8')).candidates
const candById = Object.fromEntries(candidates.map((c) => [c.candidate_id, c]))

// ---- preload existing facility_listings (confirms schema too) ----
const { data: existing, error } = await db.from('facility_listings')
  .select('id, name, lat, lng, status, google_place_id, slug, source, city, access_type, court_count, name_source_url, verified_by, provenance, metro_area')
if (error) { console.error('preload failed (schema/column mismatch?):', error.message); process.exit(1) }
const slugSet = new Set(existing.map((r) => r.slug))
const byPlaceId = new Map(existing.filter((r) => r.google_place_id).map((r) => [r.google_place_id, r]))
const byId = new Map(existing.map((r) => [r.id, r]))
const statusCounts = existing.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})

// ---- dedup helpers ----
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'and', 'park', 'pickleball', 'courts', 'court', 'club', 'center', 'centre', 'recreation', 'community'])
function nameOverlap(a, b) {
  const na = normName(a), nb = normName(b)
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  const ta = new Set(na.split(' ').filter((w) => w.length > 2 && !STOP.has(w)))
  const tb = new Set(nb.split(' ').filter((w) => w.length > 2 && !STOP.has(w)))
  if (!ta.size || !tb.size) return false
  const inter = [...ta].filter((w) => tb.has(w)).length
  return inter / Math.min(ta.size, tb.size) >= 0.5
}
function geoNameMatch(row) {
  const lat = Number(row.lat), lng = Number(row.lng)
  for (const e of existing) {
    if (e.lat == null || e.lng == null) continue
    if (Math.abs(e.lat - lat) < 0.0011 && Math.abs(e.lng - lng) < 0.0013 && nameOverlap(row.name, e.name)) return e
  }
  return null
}
function makeUniqueSlug(base, placeId, batchSet) {
  const taken = (s) => slugSet.has(s) || batchSet.has(s)
  if (!taken(base)) return base
  const tries = []
  if (placeId) tries.push(`${base}-${kebab(placeId).slice(-6)}`)
  for (let i = 2; i <= 60; i++) tries.push(`${base}-${i}`)
  for (const s of tries) if (!taken(s)) return s
  return `${base}-${placeId ? kebab(placeId).slice(-10) : Date.now()}`
}

// ---- classify ----
const nowIso = new Date().toISOString()
const plan = { insert: [], update: [], skipPublished: [], held: [] }
const slugCollisions = []
const matchVia = { place_id: 0, existing_id: 0, 'geo+name': 0 }
const diag = { existingIdPresent: 0, existingIdInTable: 0, existingIdAgreesGeo: 0, existingIdDisagrees: [] }
const batchSlugSet = new Set()

for (const row of rows) {
  if (HELD.has(row.candidate_id)) { plan.held.push(row); continue }

  const cand = candById[row.candidate_id]
  const existingId = cand?.existing_id || null
  if (existingId) diag.existingIdPresent++
  const idMatch = existingId && byId.has(existingId) ? byId.get(existingId) : null
  if (idMatch) diag.existingIdInTable++

  const placeMatch = row.google_place_id && byPlaceId.has(row.google_place_id) ? byPlaceId.get(row.google_place_id) : null
  const geoMatch = geoNameMatch(row)

  // agreement diagnostics (existing_id vs geo+name)
  if (idMatch && geoMatch) { if (idMatch.id === geoMatch.id) diag.existingIdAgreesGeo++; else diag.existingIdDisagrees.push(`${row.candidate_id}: existing_id=${idMatch.id} geo=${geoMatch.id}`) }

  // precedence: place_id (exact) → existing_id (exact) → geo+name (heuristic)
  let match = null, via = null
  if (placeMatch) { match = placeMatch; via = 'place_id' }
  else if (idMatch) { match = idMatch; via = 'existing_id' }
  else if (geoMatch) { match = geoMatch; via = 'geo+name' }
  if (via) matchVia[via]++

  if (match) {
    if (match.status === 'published') plan.skipPublished.push({ row, match, via })
    else plan.update.push({ row, match, via, priorStatus: match.status })
  } else {
    const base = baseSlug(row.name, row.city, 'AZ')
    const slug = makeUniqueSlug(base, row.google_place_id, batchSlugSet)
    if (slug !== base) slugCollisions.push(`${row.candidate_id}: ${base} → ${slug}`)
    batchSlugSet.add(slug)
    plan.insert.push({ row, slug })
  }
}

// ---- build row payloads ----
const provenanceFor = (row) => ({ batch: BATCH, candidate_id: row.candidate_id, verified_source_url: row.verified_source_url || null, gemini_type: row.gemini_type || null, method: 'places+osm+agent+human-review' })
const insertRows = plan.insert.map(({ row, slug }) => ({
  name: row.name, slug, source: BATCH, status: 'published',
  lat: Number(row.lat), lng: Number(row.lng), city: row.city, state: 'AZ', metro_area: 'Phoenix', country: 'US',
  access_type: row.access_type || 'unknown',
  court_count: row.court_count && /^\d+$/.test(row.court_count) ? parseInt(row.court_count, 10) : null,
  google_place_id: row.google_place_id || null,
  name_source_url: row.verified_source_url || null,
  verified_at: nowIso, verified_by: BATCH, provenance: provenanceFor(row),
}))

// ---- report ----
const accDist = insertRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {})
console.log(`\n=== publish-az-review — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`existing facility_listings: ${existing.length}  (status: ${JSON.stringify(statusCounts)})`)
console.log(`CSV rows: ${rows.length}\n`)
console.log(`TO INSERT (new, → published): ${insertRows.length}`)
console.log(`TO UPDATE (draft match → published): ${plan.update.length}`)
console.log(`SKIP (match already published): ${plan.skipPublished.length}`)
console.log(`HELD (not published this run): ${plan.held.length}${plan.held.length ? ' → ' + plan.held.map((r) => `${r.candidate_id} "${r.name}"`).join(', ') : ''}`)
console.log(`\nmatch signal used: ${JSON.stringify(matchVia)}`)
console.log(`dedup diagnostics: existing_id present=${diag.existingIdPresent}, of those in facility_listings=${diag.existingIdInTable}, agrees-with-geo=${diag.existingIdAgreesGeo}, disagreements=${diag.existingIdDisagrees.length}`)
if (diag.existingIdDisagrees.length) diag.existingIdDisagrees.slice(0, 10).forEach((d) => console.log('    ⚠ ' + d))
console.log(`\nUPDATE detail (prior status captured for rollback):`)
plan.update.forEach(({ row, match, via, priorStatus }) => console.log(`  ~ ${row.candidate_id} "${row.name}" → row ${match.id} (via ${via}, was ${priorStatus})`))
plan.skipPublished.forEach(({ row, match, via }) => console.log(`  = SKIP ${row.candidate_id} "${row.name}" already published (row ${match.id}, via ${via})`))
console.log(`\nslug collisions resolved (${slugCollisions.length}):`)
slugCollisions.forEach((s) => console.log('  ' + s))
console.log(`\ninsert access_type dist: ${JSON.stringify(accDist)}`)
console.log(`insert court_count present: ${insertRows.filter((r) => r.court_count != null).length}, name_source_url present: ${insertRows.filter((r) => r.name_source_url).length}`)
console.log(`sample inserts:`)
insertRows.slice(0, 5).forEach((r) => console.log(`  + "${r.name}" | ${r.city},${r.state} | ${r.access_type} | slug=${r.slug}`))
console.log(`\n⚠ publish-gate note: these rows have NO enrichment_version. scripts/publish-facilities.mjs (reconcile gate) would DRAFT them back on its next run for Phoenix. Do not run that gate for Phoenix until these are enriched, or teach the gate to treat verified_by/name_source_url rows as eligible.`)

if (DRY_RUN) {
  console.log('\nDRY RUN — nothing written. Re-run without --dry-run to apply.')
} else {
  // ---- LIVE: atomic multi-row insert, then tagged updates ----
  if (insertRows.length) {
    const { error: insErr } = await db.from('facility_listings').insert(insertRows)
    if (insErr) { console.error('\nINSERT failed (atomic — nothing inserted):', insErr.message); process.exit(1) }
    console.log(`\ninserted ${insertRows.length} published rows`)
  }
  let updated = 0
  for (const r of insertRows) slugSet.add(r.slug) // reflect inserted slugs so update-slug uniqueness holds
  for (const { row, match } of plan.update) {
    const patch = { status: 'published', verified_at: nowIso, verified_by: BATCH, provenance: { ...(match.provenance || {}), ...provenanceFor(row) } }
    if (!match.access_type || match.access_type === 'unknown') patch.access_type = row.access_type || 'unknown'
    if (match.court_count == null && row.court_count && /^\d+$/.test(row.court_count)) patch.court_count = parseInt(row.court_count, 10)
    if (!match.name_source_url && row.verified_source_url) patch.name_source_url = row.verified_source_url
    // a generic OSM name gets replaced by the verified review name + a fresh unique slug
    if (isGenericName(match.name)) {
      patch.name = row.name
      const b = baseSlug(row.name, row.city, 'AZ'); let s = b, i = 2
      while (slugSet.has(s)) s = `${b}-${i++}`
      slugSet.add(s); patch.slug = s
    }
    const { error: uErr } = await db.from('facility_listings').update(patch).eq('id', match.id)
    if (uErr) { console.error(`update failed for ${match.id}:`, uErr.message); continue }
    updated++
  }
  console.log(`updated ${updated}/${plan.update.length} draft rows → published`)

  // ---- verify ----
  const { data: check, error: cErr } = await db.from('facility_listings')
    .select('status').or(`source.eq.${BATCH},verified_by.eq.${BATCH}`)
  if (cErr) { console.error('verify query failed:', cErr.message); process.exit(1) }
  const vc = check.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})
  console.log(`\nVERIFY — rows tagged '${BATCH}' by status: ${JSON.stringify(vc)} (total ${check.length})`)
  console.log('DONE.')
}
