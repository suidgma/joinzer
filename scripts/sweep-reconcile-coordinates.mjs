/**
 * READ-ONLY sweep: what would the reconcile coordinate guard say about every configured reconcile?
 *
 * WHY IT EXISTS. Tightening a rule retroactively breaks configs written before it — adding mandatory
 * evidence_url/adjudicated_on to `reconciles[]` once turned Little Rock, the regression anchor,
 * red on the very sweep meant to prove nothing regressed. So a new assertion owes a corpus check
 * before it merges, not after.
 *
 * IT CANNOT BE RUN THROUGH THE IMPORTER. The guard lives in preflight's `checkCollisions` block,
 * which `--stage=project` skips (it opens no database connection) and which `--stage=candidates`
 * reaches only after asserting the batch's candidate_keys are ABSENT — false for every metro already
 * imported. This asks the same question against the same live rows without fighting either guard.
 *
 * KNOWN BLIND SPOT, stated rather than papered over: for a metro that has ALREADY been imported, the
 * reconcile has already overwritten the target, so `target.lat` IS the incoming coordinate and the
 * check reads clean by construction (Orlando reports 0 m for exactly this reason). This sweep proves
 * the rule breaks no config that can still RUN it; it cannot retro-detect a trade already made. That
 * blindness is the defect the guard exists to close.
 *
 * Issues SELECTs only. No writes, no Nominatim requests, no stage side effects.
 *
 *   node scripts/sweep-reconcile-coordinates.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { assertReconcileCoordinate } from './lib/reconcile-merge.mjs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log('\n=== reconcile coordinate sweep · READ-ONLY (SELECT only, no writes, no geocoding) ===\n')

const tally = { reconciles: 0, ok: 0, destroys: 0, degrades_unack: 0, degrades_ack: 0, skipped: 0, alreadyImported: 0 }
const findings = []

for (const file of readdirSync('scripts/metros').filter((f) => f.endsWith('.json')).sort()) {
  const config = JSON.parse(readFileSync(`scripts/metros/${file}`, 'utf8'))
  if (!config.reconciles?.length) continue
  if (!existsSync(config.input)) {
    tally.skipped += config.reconciles.length
    console.log(`  ~ ${file.padEnd(30)} artifact absent (${config.input}) — cannot evaluate`)
    continue
  }
  const doc = JSON.parse(readFileSync(config.input, 'utf8'))
  for (const rec of config.reconciles) {
    tally.reconciles++
    const v = (doc.venues || []).find((x) => x.research_key === rec.candidate_key)
    const { data, error } = await db.from('facility_listings').select('id, slug, status, source, lat, lng').eq('osm_id', rec.osm_id)
    if (error) { console.log(`  ! ${file}/${rec.candidate_key}: ${error.message}`); continue }
    const target = data?.[0]
    if (!target) { console.log(`  ? ${file}/${rec.candidate_key}: no live row carries ${rec.osm_id}`); continue }

    const alreadyImported = target.source === config.batch
    if (alreadyImported) tally.alreadyImported++

    const r = assertReconcileCoordinate({
      incoming: { lat: v?.coordinates?.lat ?? null, lng: v?.coordinates?.lng ?? null, provenance: { coordinate: { precision: v?.coordinates?.precision ?? null } } },
      target,
      rec,
    })
    const key = r.verdict === 'ok' ? 'ok' : r.verdict === 'destroys' ? 'destroys' : (r.fatal ? 'degrades_unack' : 'degrades_ack')
    tally[key]++
    if (r.verdict !== 'ok') {
      findings.push(`${file.replace('.json', '')}/${rec.candidate_key} — ${r.verdict}${r.fatal ? ' (UNACKNOWLEDGED)' : ' (acknowledged)'}${alreadyImported ? ' [already imported: target IS the imported row, so this is blind]' : ''}`)
      console.log(`  ${r.fatal ? '✗' : '⚠'} ${file.replace('.json', '')}/${rec.candidate_key}`)
      console.log(`      ${r.report}`)
    }
  }
}

console.log(`\nreconciles examined : ${tally.reconciles}`)
console.log(`  ok                : ${tally.ok}`)
console.log(`  destroys (fatal)  : ${tally.destroys}`)
console.log(`  degrades, no ack  : ${tally.degrades_unack}`)
console.log(`  degrades, acked   : ${tally.degrades_ack}`)
console.log(`  not evaluable     : ${tally.skipped} (artifact absent)`)
console.log(`  already imported  : ${tally.alreadyImported} — see the blind-spot note in this file's header`)
if (findings.length) { console.log('\nfindings:'); findings.forEach((f) => console.log(`  - ${f}`)) }
console.log('\nREAD-ONLY — nothing was written.')
