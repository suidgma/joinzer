/**
 * LANCASTER FOLLOW-UPS — 2026-08-05. Two keyed, single-row UPDATEs against production.
 *
 * WHY THIS FILE IS COMMITTED. Neither of these two changes touches a tracked file on its own: one
 * flips a column on a `facility_candidates` row, the other backfills an address on a published
 * `facility_listings` row. Run-and-discard would leave the exact statements that touched production
 * nowhere in git. The third Lancaster follow-up — the ADR-16 dividend that takes
 * `lancaster-2026-07-31` from 5 to 7 published — is deliberately NOT here: it runs through
 * `import-metro-merged.mjs --stage=publish`, whose `expected_publish` assertion is the machine check
 * that a hand-written UPDATE would bypass. Precedent for a committed one-off: `publish-az-review.mjs`,
 * `gen-vegas-parity.mjs`.
 *
 *   node scripts/lancaster-followups-2026-08-05.mjs --item=overlook    --dry-run
 *   node scripts/lancaster-followups-2026-08-05.mjs --item=overlook
 *   node scripts/lancaster-followups-2026-08-05.mjs --item=bright-side --dry-run
 *   node scripts/lancaster-followups-2026-08-05.mjs --item=bright-side
 *
 * SHAPE OF EVERY WRITE HERE: read the row first, print the exact before/after, exit before the write
 * under --dry-run, then UPDATE keyed on a UNIQUE column with `.select()` and assert the returned row
 * count is exactly 1. A statement that touches 0 or 2 rows is a failed run, never a silent one.
 *
 * NEITHER ITEM RE-GEOCODES AND NEITHER RE-SLUGS. `/courts/bright-side-opportunities-center-lancaster-pa`
 * is an indexed public URL; the slug column is not read or written by this file.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { revalidateDirectory } from './lib/revalidate-directory.mjs'

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.split('=').slice(1).join('=') : null
}
const DRY_RUN = process.argv.includes('--dry-run')
const ITEM = arg('item')
const ITEMS = ['overlook', 'bright-side']
if (!ITEMS.includes(ITEM)) { console.error(`Pass --item=${ITEMS.join('|')}`); process.exit(1) }

const nowIso = new Date().toISOString()

function connect() {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
  )
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

/** Every write in this file goes through here, so the assert-exactly-one rule cannot be forgotten. */
async function updateExactlyOne(query, label) {
  const { data, error } = await query.select()
  if (error) { console.error(`\n${label} FAILED: ${error.message}`); process.exit(1) }
  if (!data || data.length !== 1) {
    console.error(`\n${label} affected ${data?.length ?? 0} rows, expected exactly 1 — investigate before re-running.`)
    process.exit(1)
  }
  console.log(`\n${label} — 1 row updated ✓`)
  return data[0]
}

console.log(`\n=== lancaster-followups · item=${ITEM} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===\n`)
const db = connect()

// ---------------------------------------------------------------------------------------------
// ITEM 1 — retire the Overlook chimera.
//
// `overlook-pickleball-courts-activities-center-lancaster-pa` (batch lancaster-2026-07-31) merged
// Overlook Park and Overlook Activities Center into ONE listing, which then failed to geocode and
// published nothing. Both venues are now live as separate, correct rows from lancaster-v3-2026-08-05.
//
// NOTHING IS DELETED. The listing row and the candidate row both stay, as the audit record of what
// the 2026-07-31 pass believed. What changes is the candidate's research_status: `held` is in
// BLOCKING_RESEARCH_STATUS (scripts/lib/publish-gate.mjs), which both publishing scripts read via
// `provenance.candidate_key` -> candidate -> gateReasons(). The row was already blocked on
// `no coordinate`; this adds a second, permanent block that survives anyone fixing the coordinate,
// and it is a HUMAN DECISION rather than an absence of evidence — which is exactly the distinction
// ADR-17 draws when it keeps `held` blocking while releasing `probable`.
// ---------------------------------------------------------------------------------------------
if (ITEM === 'overlook') {
  const KEY = 'lancaster-overlook-pickleball-courts-activities-center'
  const NOTE = '[HELD 2026-08-05] chimera: merged Overlook Park + Overlook Activities Center, both now live separately from lancaster-v3-2026-08-05. Never public. Retained as audit record.'

  const { data: before, error } = await db.from('facility_candidates')
    .select('id, candidate_key, batch, proposed_name, research_status, reviewer_notes, published_listing_id')
    .eq('candidate_key', KEY)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  if (before.length !== 1) { console.error(`expected exactly 1 candidate for ${KEY}, found ${before.length}`); process.exit(1) }
  const row = before[0]

  // Guards. Each one is a fact this change assumes; if any is false the situation is not the one
  // that was gated and the run must stop rather than adapt.
  const fail = []
  if (row.batch !== 'lancaster-2026-07-31') fail.push(`batch is "${row.batch}", expected lancaster-2026-07-31`)
  if (row.published_listing_id != null) fail.push('candidate carries a published_listing_id — it is NOT unpublished, refusing to hold it')
  if (row.research_status === 'held') fail.push('already held — nothing to do (this is not an error, but re-running is a no-op)')
  if (fail.length) { fail.forEach((f) => console.error(`  x ${f}`)); process.exit(1) }

  console.log(`candidate_key : ${row.candidate_key}`)
  console.log(`proposed_name : ${row.proposed_name}`)
  console.log(`research_status: ${row.research_status}  ->  held`)
  console.log(`reviewer_notes : append " | ${NOTE}"`)

  // Deliberately NOT `process.exit(0)` on the dry-run branch. The Supabase client keeps a libuv
  // handle open, and exiting hard from here aborts the process with
  // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit code 127 — a dry run that
  // prints a perfect plan and then reports failure. Falling through lets the run end cleanly, so a
  // non-zero exit from this script always means something actually went wrong.
  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written.')
  } else {
    await updateExactlyOne(
      db.from('facility_candidates')
        .update({ research_status: 'held', reviewer_notes: `${row.reviewer_notes} | ${NOTE}` })
        .eq('candidate_key', KEY),
      'overlook chimera -> held'
    )
    console.log('\nNo cache invalidation needed: the row is a draft and has never been public.')
  }
}

// ---------------------------------------------------------------------------------------------
// ITEM 3 — Bright Side's address.
//
// `bright-side-opportunities-center-lancaster-pa` is PUBLISHED with address = NULL. The v3
// source-led pass found `515 Hershey Ave` on the venue's own site — the single genuine improvement
// that research offered an existing row (scripts/metros/lancaster-v3.json records it as the reason
// the v3 counterpart was excluded rather than imported).
//
// TWO INDEPENDENT CORROBORATIONS, so this is not a single-source address write: the v3 pass geocoded
// `515 Hershey Ave` to a point ~9 m from the live row's existing pin, and the LIVE row's own
// coordinate anchor already reads `amenity/social_facility node/10785256739 "Bright Side
// Opportunities Center", house number 515`. The coordinate is therefore left alone — it already
// agrees with the address being written, and re-geocoding would spend a request to reproduce it.
//
// ADR-12: `address_source` comes from the pinned six-value vocabulary and every future address write
// must set the column. `official_page` is the honest value — brightsideopportunities.org is the
// venue's own site, i.e. the controlling entity. `address_verified_at` is its companion column and is
// stamped today, matching what --stage=listings does for a fresh row.
// ---------------------------------------------------------------------------------------------
if (ITEM === 'bright-side') {
  const SLUG = 'bright-side-opportunities-center-lancaster-pa'
  const ADDRESS = '515 Hershey Ave'
  const SOURCE_URL = 'https://www.brightsideopportunities.org/pickleball'

  const { data: before, error } = await db.from('facility_listings')
    .select('id, slug, name, status, address, address_source, address_verified_at, lat, lng, provenance')
    .eq('slug', SLUG)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  if (before.length !== 1) { console.error(`expected exactly 1 listing for ${SLUG}, found ${before.length}`); process.exit(1) }
  const row = before[0]

  // Refuse to overwrite an address someone else has already set. The gated decision was "NULL ->
  // 515 Hershey Ave", not "replace whatever is there now".
  const fail = []
  if (row.status !== 'published') fail.push(`status is "${row.status}" — this slice is a keyed UPDATE on a PUBLISHED row`)
  if (row.address != null) fail.push(`address is already "${row.address}" — refusing to overwrite; the gated change was NULL -> ${ADDRESS}`)
  if (fail.length) { fail.forEach((f) => console.error(`  x ${f}`)); process.exit(1) }

  const prov = row.provenance || {}
  const nextProvenance = {
    ...prov,
    // Top-level mirror of the column, kept consistent with it — it read `unknown_legacy` only
    // because there was no address to attribute.
    address_source: 'official_page',
    fields: {
      ...(prov.fields || {}),
      // Same {value, source_url} shape every other field on this row already uses, so the per-field
      // evidence map stays uniform rather than growing a second convention.
      address: { value: ADDRESS, source_url: SOURCE_URL },
    },
    // The audit node. Records what was there before, so the change is reversible from the row itself
    // without consulting a log. Same shape as pensacola_recovery_2026_08_04.
    lancaster_v3_address_backfill: {
      applied_at: nowIso,
      from: { address: row.address, address_source: row.address_source, address_verified_at: row.address_verified_at },
      to: { address: ADDRESS, address_source: 'official_page', address_verified_at: nowIso },
      source_url: SOURCE_URL,
      found_by: 'lancaster-v3-2026-08-05',
      research_key: 'lancaster-v3-bright-side-opportunities-center',
      note: 'Address found by the v3 source-led pass, which excluded its own counterpart row rather than importing a duplicate. Coordinate deliberately unchanged: the live anchor already resolves house number 515 and the v3 geocode of this address lands ~9 m away. Slug unchanged — the URL is indexed.',
    },
  }

  console.log(`slug          : ${row.slug} (status=${row.status})`)
  console.log(`address       : ${JSON.stringify(row.address)}  ->  ${JSON.stringify(ADDRESS)}`)
  console.log(`address_source: ${JSON.stringify(row.address_source)}  ->  "official_page"`)
  console.log(`address_verified_at: ${JSON.stringify(row.address_verified_at)}  ->  ${nowIso}`)
  console.log(`provenance    : + fields.address, + lancaster_v3_address_backfill, address_source -> official_page`)
  console.log(`UNCHANGED     : slug, name, lat/lng, status, verified_by/verified_at, every other column`)

  // See the note on the same branch in the overlook item: no hard exit, or the Supabase client's
  // open libuv handle turns a clean dry run into exit code 127.
  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written.')
  } else {
    await updateExactlyOne(
      db.from('facility_listings')
        .update({ address: ADDRESS, address_source: 'official_page', address_verified_at: nowIso, provenance: nextProvenance })
        .eq('slug', SLUG),
      'bright side address backfill'
    )

    // This row is PUBLISHED, so the edit changes what the directory serves. Every read in
    // lib/directory/loadFacilities.ts is unstable_cache'd for 6h under the 'directory' tag and this
    // script writes straight to Postgres with the service role — nothing in the request path
    // observes it. Same reason --stage=publish calls this.
    const rv = await revalidateDirectory({ metroArea: 'Lancaster' })
    if (!rv.ok) process.exitCode = 1
    console.log('\nNOTE: /api/revalidate-directory busts the "directory" tag and revalidatePath("/courts").')
    console.log('      It does NOT revalidate /courts/[slug], which is ISR (revalidate = 21600). Verify the')
    console.log('      venue page against production; a stale render there is a gap in the publish path,')
    console.log('      not in this row.')
  }
}

console.log('\nDONE.')
