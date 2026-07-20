/**
 * Directory Session 3c — publish gate.
 *
 * Flips facility_listings rows from draft → published once they meet the gate:
 * coords + slug + minimally-viable enrichment (enrichment_version present). Reusable per metro.
 *
 * Usage (needs Supabase service role in .env.local):
 *   node scripts/publish-facilities.mjs --metro=Phoenix --dry-run   # report what would publish
 *   node scripts/publish-facilities.mjs --metro=Phoenix             # publish them
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

// Gate: draft, in this metro, with coords + slug + enrichment.
const { data: eligible, error } = await db.from('facility_listings')
  .select('id, name')
  .eq('metro_area', METRO).eq('status', 'draft')
  .not('lat', 'is', null).not('lng', 'is', null).not('slug', 'is', null).not('enrichment_version', 'is', null)
if (error) { console.error('select failed:', error.message); process.exit(1) }

console.log(`Publish gate — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — metro=${METRO} — ${eligible.length} draft row(s) meet the gate\n`)
for (const f of eligible) console.log(`  ${DRY_RUN ? '·' : '✓'} ${f.name}`)

if (!DRY_RUN && eligible.length) {
  const { error: uErr } = await db.from('facility_listings').update({ status: 'published' }).in('id', eligible.map((f) => f.id))
  if (uErr) { console.error('\npublish failed:', uErr.message); process.exit(1) }
}

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — ${DRY_RUN ? 'would publish' : 'published'} ${eligible.length} facility(ies) in ${METRO}`)
