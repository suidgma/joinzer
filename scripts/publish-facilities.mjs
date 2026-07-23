/**
 * Directory Session 3c — publish gate (reconciling).
 *
 * Computes the set of rows that SHOULD be public for a metro, and reconciles status to match:
 *   - publishes eligible rows that aren't yet published,
 *   - un-publishes (draft) rows that shouldn't be public (e.g. generic "Pickleball"/"Courts" names).
 * Idempotent. Gate = coords + slug + enrichment + a real (non-generic) name.
 *
 * Usage (needs Supabase service role in .env.local):
 *   node scripts/publish-facilities.mjs --metro=Phoenix --dry-run
 *   node scripts/publish-facilities.mjs --metro=Phoenix
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }

const DRY_RUN = process.argv.includes('--dry-run')
const METRO = (process.argv.find((a) => a.startsWith('--metro=')) || '').split('=')[1]
if (!METRO) { console.error('Pass --metro=<name>, e.g. --metro=Phoenix'); process.exit(1) }

// A name is "generic" if nothing distinctive remains after stripping pickleball/court/tennis terms,
// numbers, and stopwords — e.g. "Pickleball", "Pickle Ball", "Pickleball Courts", "8 Pickleball Courts".
// Real venues keep a proper noun ("Chicken N Pickle", "PebbleCreek…", "The Picklr…").
function isGenericName(name) {
  const t = (name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pickleball|pickle|ball|courts?|tennis|the|a|an|of|at|and)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return t.length < 3
}

// All rows in the metro that pass the hard gate (coords + city + slug + enrichment).
// city IS NOT NULL added Session 3d-0: a listing with no city isn't publishable (breaks the
// city index page + reads as incomplete). Reverse-geocode fills it first.
const { data: gated, error } = await db.from('facility_listings')
  .select('id, name, status, enrichment_version, verified_by, name_source_url')
  .eq('metro_area', METRO)
  .not('lat', 'is', null).not('lng', 'is', null).not('city', 'is', null).not('slug', 'is', null)
if (error) { console.error('select failed:', error.message); process.exit(1) }

// Eligible = coords + city + slug (above) + a non-generic name AND a trust signal — EITHER Gemini
// enrichment (enrichment_version) OR a human review sign-off (verified_by). The verified path lets
// the 3d-5 human-review batches (e.g. source 'az-review-2026-07') stay published before enrichment
// runs, instead of this reconcile pass drafting them back.
//   NOTE: verified_by alone is the trust signal — NOT verified_by+name_source_url — because ~6 of the
//   first AZ batch are genuine approved parks that lack a primary-source URL (a review-sheet gap).
//   Once those are backfilled, this can tighten to also require name_source_url (see migration
//   20260721000005: "publish gate will require it"). name_source_url is selected for that future step.
const isVerified = (r) => r.verified_by != null
const eligible = gated.filter((r) => !isGenericName(r.name) && (r.enrichment_version != null || isVerified(r)))
const eligibleIds = new Set(eligible.map((r) => r.id))

// Gate-authoritative reconcile: pull ANY currently-published row that isn't eligible — whether it
// fails the hard gate (e.g. no city) or is generic. (The old logic only saw generic rows inside the
// gated set, so a published row failing the hard gate was invisible and stayed live.)
const { data: publishedRows, error: pErr } = await db.from('facility_listings')
  .select('id, name').eq('metro_area', METRO).eq('status', 'published')
if (pErr) { console.error('published select failed:', pErr.message); process.exit(1) }

const toPublish = eligible.filter((r) => r.status !== 'published')
const toDraft = publishedRows.filter((r) => !eligibleIds.has(r.id))

console.log(`Publish gate (reconcile) — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — metro=${METRO}`)
console.log(`  eligible (gate-passing): ${eligible.length} · currently published: ${publishedRows.length}\n`)
console.log(`PUBLISH (${toPublish.length}):`); toPublish.forEach((r) => console.log(`  + ${r.name}`))
console.log(`UN-PUBLISH not-eligible (${toDraft.length}):`); toDraft.forEach((r) => console.log(`  - ${r.name}`))

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

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — ${METRO}: ${eligible.length} eligible/public${DRY_RUN ? '' : ` (published +${toPublish.length}, drafted -${toDraft.length})`}`)
