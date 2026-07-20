/**
 * Directory Session 3b — facility enrichment runner (Phoenix).
 *
 * Selects Phoenix facility_listings rows needing enrichment, calls the swappable LLM provider,
 * validates the JSON, and writes enrichment + enriched_at + enrichment_version. Local script only.
 *
 * Usage (needs GEMINI_API_KEY + Supabase service role in .env.local):
 *   node scripts/enrich-facilities.mjs --dry-run --limit=2   # generate + print JSON, NO writes
 *   node scripts/enrich-facilities.mjs                        # live: enrich all Phoenix rows at v1
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateEnrichment, PROVIDER, MODEL } from './enrich/provider-gemini.mjs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const KEY = env.GEMINI_API_KEY
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!KEY || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing GEMINI_API_KEY / Supabase env in .env.local'); process.exit(1) }

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = parseInt((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || null
const ENRICHMENT_VERSION = 'v1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function valid(e) {
  return e && typeof e.description === 'string' && Array.isArray(e.amenities) &&
    Array.isArray(e.whatToKnow) && typeof e.nearby === 'string' && Array.isArray(e.faqs)
}

// ---- main ------------------------------------------------------------------
const { data: all, error } = await db.from('facility_listings')
  .select('id, name, city, state, access_type, indoor, surface, enrichment_version')
  .eq('metro_area', 'Phoenix').order('name')
if (error) { console.error('select failed:', error.message); process.exit(1) }

let todo = (all ?? []).filter((r) => r.enrichment_version !== ENRICHMENT_VERSION)
if (LIMIT) todo = todo.slice(0, LIMIT)

console.log(`Enrichment — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} — provider=${PROVIDER} model=${MODEL} — ${todo.length} facility(ies) at ${ENRICHMENT_VERSION}\n`)

let ok = 0, bad = 0, anyOk = false
for (const r of todo) {
  let enrichment
  try { enrichment = await generateEnrichment(r, KEY) }
  catch (e) {
    if (!anyOk && (e.status === 400 || e.status === 403)) {
      console.error(`\n✋ Gemini rejected the call (${e.status}). Check GEMINI_API_KEY in .env.local (and that the Generative Language / Gemini API is enabled for it).\n   ${e.message}`)
      process.exit(1)
    }
    console.warn(`  ✗ ${r.name}: ${e.message} — skipping`); bad++; await sleep(4500); continue
  }
  anyOk = true
  if (!valid(enrichment)) { console.warn(`  ✗ ${r.name}: malformed enrichment — skipping`); bad++; await sleep(4500); continue }
  ok++

  if (DRY_RUN) {
    console.log(`\n===== ${r.name} (${r.city || r.state}) =====`)
    console.log(JSON.stringify(enrichment, null, 2))
  } else {
    const { error: uErr } = await db.from('facility_listings')
      .update({ enrichment, enriched_at: new Date().toISOString(), enrichment_version: ENRICHMENT_VERSION })
      .eq('id', r.id)
    if (uErr) { console.warn(`  ✗ ${r.name}: write failed ${uErr.message}`); bad++ }
    else console.log(`  ✓ ${r.name}`)
  }
  await sleep(4500) // stay under free-tier RPM
}

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — enriched ${ok}, failed/skipped ${bad}, of ${todo.length}`)
