#!/usr/bin/env node
/**
 * ADR-18 TIER DEBT — re-tier `source_verified` rows that were imported from a NON-`verified`
 * candidate down to the honest `listed`.
 *
 * WHY THIS EXISTS. ADR-18 made the confidence tier DERIVED from the candidate's research_status:
 * `verificationStatusFor(rs)` is `rs === 'verified' ? 'source_verified' : 'listed'`. Rows imported
 * before ADR-18 got a hardcoded 'source_verified' regardless, so a `probable` row — one no
 * controlling entity confirmed — carries a column claiming a controlling entity confirmed it. That
 * is the lie ADR-18 exists to stop a column from telling.
 *
 * WHY IT MUST RUN BEFORE THE PUBLISH. `--stage=verify` asserts
 * `verification_status === verificationStatusFor(provenance.research_status_at_import)` over EVERY
 * row in the batch (import-metro-merged.mjs, the ADR-18 check). Publishing first does not fix the
 * mismatch — `--stage=publish` writes only status/verified_at/verified_by and never touches the tier
 * — so the verify run would fail on rows the publish run had just promoted.
 *
 * SCOPE IS DELIBERATELY TWO BATCHES, NOT THE SITE. 141 rows site-wide match a loose reading of this
 * predicate and 248 more carry no `research_status_at_import` key at all; sweeping them is its own
 * gated data pass with its own evidence. This script refuses to touch anything outside the two
 * batches named below, and asserts the exact expected row count before writing a thing.
 *
 * NOT USER-VISIBLE. `lib/directory/loadFacilities.ts` does not select `verification_status` in any
 * of its four queries, so this corrects an internal record and changes no rendered byte.
 *
 * Usage:  node scripts/retier-adr18-debt.mjs --dry-run
 *         node scripts/retier-adr18-debt.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DRY_RUN = process.argv.includes('--dry-run')
const NOW = new Date().toISOString()
const PROVENANCE_KEY = 'adr18_retier_2026_08_05'

/** The only batches this script may touch. Enumerated, never pattern-matched. */
const BATCHES = ['colorado-springs-2026-08-03', 'little-rock-2026-07-30']
/** Asserted before any write — a different number means the world moved and the run must stop. */
const EXPECTED = { 'colorado-springs-2026-08-03': 10, 'little-rock-2026-07-30': 2 }
const EXPECTED_TOTAL = 12

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log(`\n=== retier-adr18-debt · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
console.log(`batches: ${BATCHES.join(', ')}`)
console.log(`rule: verification_status 'source_verified' -> 'listed' where research_status_at_import <> 'verified'\n`)

const { data: rows, error } = await db.from('facility_listings')
  .select('id, slug, source, status, verification_status, provenance')
  .in('source', BATCHES)
if (error) { console.error('read failed:', error.message); process.exit(1) }

const targets = rows.filter((r) =>
  r.verification_status === 'source_verified' &&
  r.provenance?.research_status_at_import !== 'verified')

// ---- preflight assertions -------------------------------------------------------------------
const fail = []
const byBatch = targets.reduce((a, r) => (a[r.source] = (a[r.source] || 0) + 1, a), {})
for (const b of BATCHES) {
  if ((byBatch[b] || 0) !== EXPECTED[b]) fail.push(`${b}: expected ${EXPECTED[b]} debt rows, found ${byBatch[b] || 0}`)
}
if (targets.length !== EXPECTED_TOTAL) fail.push(`total: expected ${EXPECTED_TOTAL}, found ${targets.length}`)
const published = targets.filter((r) => r.status !== 'draft')
if (published.length) fail.push(`${published.length} target row(s) are NOT draft: ${published.map((r) => r.slug).join(', ')}`)

console.log(`targets: ${targets.length}`)
for (const r of targets) {
  console.log(`  ${r.source.padEnd(30)} ${r.slug.padEnd(62)} ${r.status} · at_import=${r.provenance?.research_status_at_import}`)
}
console.log(`\npreflight: ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : 'FAILED ✗'}`)
fail.forEach((f) => console.error(`  ✗ ${f}`))
if (fail.length) { console.error('\nABORT — preflight failed, nothing written.'); process.exit(1) }

if (DRY_RUN) {
  console.log(`\nDRY RUN — nothing written. ${targets.length} rows would move source_verified -> listed.`)
} else {
  let updated = 0
  for (const r of targets) {
    // Merge into the existing provenance — never replace it. Prior value recorded so the row is a
    // one-statement revert and "what changed here" is answerable months from now.
    const provenance = {
      ...(r.provenance || {}),
      [PROVENANCE_KEY]: {
        applied_at: NOW,
        reason: 'ADR-18: tier is derived from research_status_at_import; source_verified on a non-verified candidate overstates the evidence',
        changes_applied: { verification_status: { from: r.verification_status, to: 'listed' } },
      },
    }
    // Guarded on every column that defines the precondition: if anything moved between the read and
    // this write, the update matches 0 rows and the run aborts instead of surprising us.
    const { data: back, error: uErr } = await db.from('facility_listings')
      .update({ verification_status: 'listed', provenance })
      .eq('id', r.id).eq('source', r.source).eq('status', 'draft').eq('verification_status', 'source_verified')
      .select('id')
    if (uErr) { console.error(`  update failed for ${r.slug}:`, uErr.message); process.exit(1) }
    if (!back || back.length !== 1) { console.error(`  ABORT: ${r.slug} matched ${back?.length ?? 0} rows, expected exactly 1`); process.exit(1) }
    updated++
  }
  console.log(`\nre-tiered ${updated}/${targets.length} rows`)

  // ---- post-assertions ------------------------------------------------------------------------
  const { data: after } = await db.from('facility_listings')
    .select('id, slug, source, status, verification_status, provenance').in('source', BATCHES)
  const remaining = after.filter((r) =>
    r.verification_status === 'source_verified' && r.provenance?.research_status_at_import !== 'verified')
  const listedNow = after.filter((r) => r.verification_status === 'listed')
  const stillOk = after.filter((r) =>
    r.provenance?.research_status_at_import === 'verified' && r.verification_status === 'source_verified')
  console.log(`\npost-assertions:`)
  console.log(`  debt rows remaining in these batches: ${remaining.length} ${remaining.length === 0 ? '✓' : '✗ ' + remaining.map((r) => r.slug).join(', ')}`)
  console.log(`  rows now tiered 'listed':             ${listedNow.length}`)
  console.log(`  verified-at-import rows untouched:    ${stillOk.length}`)
  if (remaining.length) process.exitCode = 1
}
