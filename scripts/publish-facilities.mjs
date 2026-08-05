/**
 * Directory Session 3c — publish gate (reconciling).
 *
 * Computes the set of rows that SHOULD be public for a metro, and reconciles status to match:
 *   - publishes eligible rows that aren't yet published,
 *   - un-publishes (draft) rows that shouldn't be public (e.g. generic "Pickleball"/"Courts" names).
 * Idempotent.
 *
 * THE GATE IS IMPORTED, NOT DEFINED HERE (ADR-17). scripts/lib/publish-gate.mjs is the one
 * definition, shared with import-metro-merged.mjs, because this pass UN-publishes: any rule this
 * file applies that the importer does not would silently draft, one metro at a time, exactly the
 * rows the importer just promoted.
 *
 * TWO CONDITIONS, AND THEY ARE NOT THE SAME KIND OF THING:
 *   THE GATE  (shared)  "is this row good enough to be public?"  Governs BOTH directions.
 *   THE FENCE (here)    "has anyone deliberately released it?"   Governs the PUBLISH direction ONLY.
 *
 * The fence is what makes a permissive gate safe. 446 draft rows pass the gate today; every one of
 * them carries verified_by = NULL, so this script cannot publish any of them. Only an explicit
 * `import-metro-merged.mjs --stage=publish` run stamps that column. Applying the fence to the
 * un-publish direction as well would draft the 19 live Stockton-Lodi rows that predate the stamping
 * convention — hence gate-only there, deliberately.
 *
 * Usage (needs Supabase service role in .env.local):
 *   node scripts/publish-facilities.mjs --metro=Phoenix --dry-run
 *   node scripts/publish-facilities.mjs --metro=Phoenix
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { revalidateDirectory } from './lib/revalidate-directory.mjs'
import { GATE_TEXT, gateReasons, isApproximateLocation, passesReleaseFence } from './lib/publish-gate.mjs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }

const DRY_RUN = process.argv.includes('--dry-run')
const METRO = (process.argv.find((a) => a.startsWith('--metro=')) || '').split('=')[1]
if (!METRO) { console.error('Pass --metro=<name>, e.g. --metro=Phoenix'); process.exit(1) }

// ONE read of the whole metro, then every decision is made in JS against the shared gate.
//
// This replaced a two-query shape (a SQL-filtered "gated" set plus a separate published-rows query)
// that had already produced one defect: a published row failing the SQL half of the gate was absent
// from `gated` and therefore invisible to the un-publish pass, so it stayed live forever. Reading the
// metro once and applying one predicate to it removes the possibility of the two halves disagreeing.
const { data: rows, error } = await db.from('facility_listings')
  .select('id, name, slug, city, lat, lng, status, enrichment_version, verified_by, name_source_url, provenance, google_place_id, address')
  .eq('metro_area', METRO)
if (error) { console.error('select failed:', error.message); process.exit(1) }

// PostgREST caps an unbounded select at 1000 rows and returns them WITHOUT an error. That is
// survivable on the publish side (a row simply isn't promoted this run) and corrupting on the
// un-publish side: `toDraft` is computed from the rows we can see, so any published row past the cap
// is invisible here and stays live forever while the operator reads a clean "UN-PUBLISH (0)".
// Latent today — the largest metro is Phoenix at 186 — so this is a guard, not a fix. Fail closed
// rather than paginate: a metro at this size is a different problem that wants a human first.
if (rows.length >= 1000) {
  console.error(`\nABORT: ${rows.length} rows returned for metro=${METRO}, at or above PostgREST's 1000-row default cap.`)
  console.error('The result is silently truncated, which would make the un-publish pass reason about a partial view of the metro.')
  console.error('Add explicit pagination to this script before running it against a metro this size.')
  process.exit(1)
}

// Candidate research_status, joined in for the gate's correctness disqualifier
// (duplicate/not_venue/not_pickleball/held — see BLOCKING_RESEARCH_STATUS in the gate module).
// Deliberately permissive when there is NO candidate row (raw OSM drafts, Vegas parity, the 8 Phoenix
// rows carrying no candidate key): absence of a staging row is not evidence against a listing, and
// blocking on it would silently un-publish live Phoenix rows.
const candidateKeyOf = (r) => r.provenance?.candidate_key ?? r.provenance?.candidate_id ?? null
const candidateKeys = [...new Set(rows.map(candidateKeyOf).filter(Boolean))]
const statusByKey = new Map()
if (candidateKeys.length) {
  const { data: cands, error: cErr } = await db.from('facility_candidates').select('candidate_key, research_status').in('candidate_key', candidateKeys)
  if (cErr) { console.error('candidate status read failed:', cErr.message); process.exit(1) }
  for (const c of cands) statusByKey.set(c.candidate_key, c.research_status)
}

// Coordinate precision — NOT AN EXCLUSION (ADR-16). Kept as a REPORTING signal, and imported from the
// shared module rather than redefined here.
const lowPrecision = (r) => isApproximateLocation(r.provenance?.coordinate?.precision ?? null)

// THE GATE — shared, identical to the batch importer's, governs BOTH directions.
const gateBlockers = (r) => gateReasons({
  name: r.name, lat: r.lat, lng: r.lng, city: r.city, slug: r.slug,
  research_status: statusByKey.get(candidateKeyOf(r)) ?? null,
  // Always true here: see the gate module's note on why a missing candidate row is not evidence
  // against a listing on the reconcile path.
  hasCandidate: true,
})
const passesGate = (r) => gateBlockers(r).length === 0

// THE FENCE — publish direction ONLY. Deliberately absent from `toDraft` below.
const eligible = rows.filter((r) => passesGate(r) && passesReleaseFence(r))

const publishedRows = rows.filter((r) => r.status === 'published')
const toPublish = eligible.filter((r) => r.status !== 'published')
// Gate-only, never the fence. A published row is drafted because it stopped being GOOD ENOUGH, never
// because nobody re-authorized it — 19 live Stockton-Lodi rows predate the verified_by convention and
// must not be drafted for it.
const toDraft = publishedRows.filter((r) => !passesGate(r))

// Rows that clear the quality bar but have not been released. This is the number that makes the
// fence visible: on most metros it is large, and every one of these is a row an owner has not yet
// said go on. If this ever prints 0 while drafts exist, the fence has been removed.
const gatePassingUnreleased = rows.filter((r) => r.status !== 'published' && passesGate(r) && !passesReleaseFence(r))

console.log(`Publish gate (reconcile) — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — metro=${METRO}`)
console.log(`  gate = ${GATE_TEXT}`)
console.log(`  rows in metro: ${rows.length} · currently published: ${publishedRows.length} · gate-passing: ${rows.filter(passesGate).length}`)
console.log(`  HELD BY THE FENCE (gate-passing drafts with verified_by = NULL): ${gatePassingUnreleased.length}`)
console.log(`    these publish only via: node scripts/import-metro-merged.mjs --metro=<key> --stage=publish`)
// Reported, never excluded. This number is how an operator sees the size of the approximate-location
// set in the run log rather than having to query for it — and if it ever reads 0 for a metro that
// should have some, that is the tell that location_precision has drifted from provenance.
console.log(`  publishing WITH the approximate-location label (ADR-16, precision 'low'): ${eligible.filter(lowPrecision).length} of ${eligible.length}\n`)
console.log(`PUBLISH (${toPublish.length}):`); toPublish.forEach((r) => console.log(`  + ${r.name}`))
console.log(`UN-PUBLISH not-eligible (${toDraft.length}):`); toDraft.forEach((r) => console.log(`  - ${r.name} — ${gateBlockers(r).join('; ')}`))

// Advisory only — NEVER a gate condition (owner ruling 2026-07-30). google_place_id is what lets
// lib/directory/mapsUrl.ts link straight to the venue's Google Maps card; without it the link
// degrades to a text query, or for a row with no address to an anonymous dropped pin. That is a
// quality signal, not a publishability test: making it blocking here would un-publish 31 live rows
// across two entire metros on the next reconcile pass, because this script drafts anything that
// stops being eligible. Surface the number, let the operator decide, run scripts/backfill-place-ids.mjs.
const noPid = eligible.filter((r) => !r.google_place_id)
if (noPid.length) {
  const noAddr = noPid.filter((r) => !r.address)
  console.log(`\n⚠ ADVISORY (non-blocking) — ${noPid.length} of ${eligible.length} eligible row(s) have no google_place_id.`)
  console.log(`  Their Maps link falls back to a text query${noAddr.length ? `, and for ${noAddr.length} with no address to a bare coordinate pin` : ''}.`)
  console.log(`  Fix: node scripts/backfill-place-ids.mjs --metro=${METRO} --dry-run`)
}

if (!DRY_RUN) {
  if (toPublish.length) {
    const { error: e } = await db.from('facility_listings').update({ status: 'published' }).in('id', toPublish.map((r) => r.id))
    if (e) { console.error('\npublish failed:', e.message); process.exit(1) }
  }
  if (toDraft.length) {
    const { error: e } = await db.from('facility_listings').update({ status: 'draft' }).in('id', toDraft.map((r) => r.id))
    if (e) { console.error('\nun-publish failed:', e.message); process.exit(1) }
  }
}

// Both directions need this, not just publishes: the directory reads are unstable_cache'd for 6h
// under the 'directory' tag and this script writes straight to Postgres, so an un-published venue
// keeps rendering — and a newly published metro hard-404s — until the TTL lapses (Greensboro-High
// Point + Little Rock, 2026-07-30). See scripts/lib/revalidate-directory.mjs.
if (!DRY_RUN && (toPublish.length || toDraft.length)) {
  // The live-page assertion only makes sense when this run leaves rows published. A pure
  // un-publish pass can legitimately empty a metro, and a 404 would then be the correct outcome.
  const rv = await revalidateDirectory({ metroArea: toPublish.length ? METRO : null })
  if (!rv.ok) process.exitCode = 1
}

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — ${METRO}: ${eligible.length} eligible/public${DRY_RUN ? '' : ` (published +${toPublish.length}, drafted -${toDraft.length})`}`)
