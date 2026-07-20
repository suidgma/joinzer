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

// All rows in the metro that pass the hard gate (coords + slug + enrichment).
const { data: gated, error } = await db.from('facility_listings')
  .select('id, name, status')
  .eq('metro_area', METRO)
  .not('lat', 'is', null).not('lng', 'is', null).not('slug', 'is', null).not('enrichment_version', 'is', null)
if (error) { console.error('select failed:', error.message); process.exit(1) }

const shouldBePublic = gated.filter((r) => !isGenericName(r.name))
const shouldNotBePublic = gated.filter((r) => isGenericName(r.name))
const toPublish = shouldBePublic.filter((r) => r.status !== 'published')
const toDraft = shouldNotBePublic.filter((r) => r.status === 'published') // generic ones currently live → pull

console.log(`Publish gate (reconcile) — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — metro=${METRO}`)
console.log(`  gated rows: ${gated.length} · should be public: ${shouldBePublic.length} · generic (excluded): ${shouldNotBePublic.length}\n`)
console.log(`PUBLISH (${toPublish.length}):`); toPublish.forEach((r) => console.log(`  + ${r.name}`))
console.log(`UN-PUBLISH generic (${toDraft.length}):`); toDraft.forEach((r) => console.log(`  - ${r.name}`))

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

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — ${METRO}: ${shouldBePublic.length} public, ${shouldNotBePublic.length} held back (generic names)`)
