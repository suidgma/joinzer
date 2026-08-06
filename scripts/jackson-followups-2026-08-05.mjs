/**
 * JACKSON FOLLOW-UPS — 2026-08-05. Three keyed, single-row writes against production, batched into
 * one Nominatim window because they are the same metro and three rows is a trivial spend.
 *
 *   node scripts/jackson-followups-2026-08-05.mjs --item=towne-park --dry-run
 *   node scripts/jackson-followups-2026-08-05.mjs --item=towne-park
 *   node scripts/jackson-followups-2026-08-05.mjs --item=magnolia   --dry-run
 *   node scripts/jackson-followups-2026-08-05.mjs --item=magnolia
 *   node scripts/jackson-followups-2026-08-05.mjs --item=cascades   --dry-run
 *   node scripts/jackson-followups-2026-08-05.mjs --item=cascades
 *
 * WHY THIS FILE IS COMMITTED. Same reason as scripts/lancaster-followups-2026-08-05.mjs, whose shape
 * this copies: none of these changes touches a tracked file on its own, so run-and-discard would
 * leave the exact statements that touched production nowhere in git.
 *
 * SHAPE OF EVERY WRITE: read the row first, print the exact before/after, fall through without
 * writing under --dry-run, then UPDATE keyed on a UNIQUE column with `.select()` and assert exactly
 * 1 row came back. (Do NOT `process.exit(0)` on the dry-run branch — the Supabase client holds a
 * libuv handle open and a hard exit turns a clean dry run into exit code 127. Lancaster learned this.)
 *
 * WHAT SEPARATES THIS FILE FROM THE LANCASTER ONE: these items RE-GEOCODE, which Lancaster's
 * explicitly did not. Two consequences that are easy to get wrong:
 *
 *   1. `location_precision` is a GENERATED column (migration 20260804000001) computed from
 *      `provenance.coordinate.precision`. It is therefore NEVER written directly here — we write the
 *      provenance node and the column follows. Writing the column would fail; writing only the
 *      lat/lng and leaving provenance stale would silently keep the approximate-location label on a
 *      pin that had earned its way off it.
 *   2. A re-geocode that SUCCEEDS on a held row changes that batch's publish split, which
 *      `expected_publish` in scripts/metros/jackson.json asserts against. That assertion firing is
 *      the system working. Update the expectation deliberately from the new reality and re-run
 *      --stage=publish; never hand-publish around it, and never edit the expectation to match an
 *      output you have not read.
 *
 * NO ITEM RE-SLUGS. Every slug here is an indexed public URL and the column is neither read nor
 * written by this file.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { revalidateDirectory } from './lib/revalidate-directory.mjs'
import { geocodeVenue, geocodeCachePath, flushCache, liveRequestCount, metresBetween } from './lib/geocode-nominatim.mjs'

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.split('=').slice(1).join('=') : null
}
const DRY_RUN = process.argv.includes('--dry-run')
const ITEM = arg('item')
const ITEMS = ['towne-park', 'magnolia', 'cascades']
if (!ITEMS.includes(ITEM)) { console.error(`Pass --item=${ITEMS.join('|')}`); process.exit(1) }

const nowIso = new Date().toISOString()

// Same cache the jackson batch uses, so anything learned here is retained for the metro rather than
// stranded in a throwaway file. Address VARIANTS below are new cache keys by construction, which is
// what gives a previously-missing venue a genuine retry rather than a replay of a stale miss.
const CACHE = geocodeCachePath('jackson', 'metro-research/.geocode-cache/nominatim.json')

function connect() {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
  )
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

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

/** Read one listing by slug and assert it is unique. */
async function readListing(db, slug) {
  const { data, error } = await db.from('facility_listings')
    .select('id, slug, name, status, address, address_source, address_verified_at, city, state, zip, lat, lng, location_precision, provenance')
    .eq('slug', slug)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  if (data.length !== 1) { console.error(`expected exactly 1 listing for ${slug}, found ${data.length}`); process.exit(1) }
  return data[0]
}

/**
 * Run the ladder over a set of address VARIANTS and print every rung's outcome.
 *
 * Reporting all of them is the point, not a debugging nicety: when nothing resolves, the question
 * the owner actually needs answered is "does this belong in the batched cross-metro re-geocode pass,
 * or does it need an address with a house number OSM carries" — and only the per-rung trace
 * distinguishes those two.
 */
async function tryVariants(label, variants) {
  console.log(`\n--- geocode ladder · ${label} · ${variants.length} address variant(s) ---`)
  let best = null
  for (const v of variants) {
    console.log(`\n  variant "${v._label}": ${JSON.stringify({ address: v.address, city: v.city, zip: v.zip })}`)
    const res = await geocodeVenue(v, {
      cachePath: CACHE,
      onAttempt: (a) => {
        const tail = a.hits === 0 ? 'no hits' : `${a.hits} hit(s)`
        console.log(`      rung ${String(a.rung).padEnd(18)} ${tail}${a.cached ? ' (cache)' : ''}${a.micro_skipped ? ` · ${a.micro_skipped} micro-feature(s) skipped` : ''}`)
        for (const m of a.micro || []) console.log(`          skipped furniture: ${m}`)
        for (const r of a.nocity?.rejected || []) console.log(`          ${r}`)
        for (const acc of a.nocity?.accepted || []) console.log(`          ${acc}`)
      },
    })
    if (!res) { console.log('      => NO RESULT from any rung'); continue }
    console.log(`      => ${res.precision.toUpperCase()}  ${res.lat},${res.lng}`)
    console.log(`         anchor: ${res.anchor}`)
    const rank = { high: 0, medium: 1, low: 2 }
    if (!best || rank[res.precision] < rank[best.precision]) best = { ...res, _variant: v._label }
  }
  flushCache()
  console.log(`\n  live Nominatim requests so far this run: ${liveRequestCount()}`)
  return best
}

/** The provenance.coordinate node every import writes, rebuilt from a fresh geocode. */
function coordinateNode(res) {
  return {
    lat: res.lat,
    lng: res.lng,
    anchor: res.anchor,
    origin: 'nominatim',
    precision: res.precision,
    source_url: 'https://nominatim.openstreetmap.org/',
    name_anchor: res.matched_name ?? null,
    matched_rung: res.matched_rung,
    address_override: null,
    shared_anchor_with: null,
    workbook_crosscheck: null,
  }
}

console.log(`\n=== jackson-followups · item=${ITEM} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===\n`)
const db = connect()

// ---------------------------------------------------------------------------------------------
// ITEM 1 — Towne Park's address, and the re-geocode that address unlocks.
//
// `towne-park-pickleball-complex-clinton-ms` is PUBLISHED carrying `853 Old Vicksburg Road`. The
// City of Clinton's own park-improvements pages put the complex at `915 Old Vicksburg Road`, and the
// v3 source-led pass geocoded that address to a HIGH-precision anchor (house number 915 on OSM way
// 13603972) where 853 only ever reached the street band.
//
// So the wrong house number is not merely a cosmetic error — it is the whole reason this row carries
// the ADR-16 approximate-location label. Fixing the address and re-geocoding should take it to
// `high` and drop the label, which is a visible change to a published page and therefore needs the
// cache invalidation at the end.
//
// ADR-12: address_source comes from the pinned vocabulary; `official_page` is honest here because
// clintonms.org is the controlling municipality. address_verified_at is its companion column.
// ---------------------------------------------------------------------------------------------
if (ITEM === 'towne-park') {
  const SLUG = 'towne-park-pickleball-complex-clinton-ms'
  const FROM_ADDRESS = '853 Old Vicksburg Road'
  const TO_ADDRESS = '915 Old Vicksburg Road'
  const SOURCE_URL = 'https://clintonms.org/parkimprovements/'

  const row = await readListing(db, SLUG)

  // Each guard is a fact this change assumes. If one is false the situation is not the one that was
  // gated, and the run stops rather than adapts.
  const fail = []
  if (row.status !== 'published') fail.push(`status is "${row.status}" — this slice is a keyed UPDATE on a PUBLISHED row`)
  if (row.address !== FROM_ADDRESS) fail.push(`address is "${row.address}", expected "${FROM_ADDRESS}" — refusing to overwrite an address someone else has already changed`)
  if (fail.length) { fail.forEach((f) => console.error(`  x ${f}`)); process.exit(1) }

  // TWO INDEPENDENT ANCHORS, DELIBERATELY, because this is a published row and the ladder proved
  // unstable on it. Running the corrected address alone returned way/13603972 twice on the SAME run
  // in two different guises: once as `place/house` with house number 915 (high) and once as the
  // whole `highway/tertiary "Old Vicksburg Road"` (low). Those two readings of one OSM way are
  // 1,099 m apart — the multi-segment-road shape, where a distance measured against a different
  // segment of the same road looks like a huge error. Whichever the ladder happens to return first
  // is not a decision anyone made, so we make it here instead.
  //
  // The tie-break is the venue's OWN feature: OSM carries `leisure/park way/512987370 "Kid's Towne
  // Park"`, which is the site the 4 courts were expanded to 8 at and renamed. A named park polygon
  // beats a house number on the road outside it, so the park anchor is what gets persisted and the
  // house number becomes the corroboration — the Bright Side two-anchor pattern.
  const parkAnchor = await tryVariants('Towne Park — the park feature itself', [
    { _label: 'park by name', name: 'Towne Park', address: null, city: row.city, state: row.state, zip: row.zip },
  ])

  if (!parkAnchor) { console.error('\nx the park feature did not resolve — stopping rather than falling back to a road anchor the ladder could not keep stable.'); process.exit(1) }
  if (parkAnchor.precision !== 'high') { console.error(`\nx park feature resolved ${parkAnchor.precision}, expected high — stopping.`); process.exit(1) }

  // THE CORROBORATING ANCHOR IS READ FROM THE v3 ARTIFACT, NOT RE-DERIVED. When the v3 pass geocoded
  // the corrected address on 2026-08-05 it recorded `place/house way/13603972, house number 915` at
  // high precision. Re-running the same query now returns the SAME OSM way as the whole
  // `highway/tertiary "Old Vicksburg Road"` at low precision instead — Nominatim is a live service
  // and its answer for this query is not stable.
  //
  // So the honest corroboration is the observation that was actually recorded and committed, not
  // whichever reading the endpoint is in the mood for. Reading it from the artifact also means this
  // guard cannot be silently weakened by a cache that has since been overwritten with the worse
  // reading — which is exactly what happened on the first run of this item.
  const AGREE_MAX_M = 500
  const v3 = JSON.parse(readFileSync('metro-research/jackson-v3/jackson-v3-candidates.json', 'utf8'))
  const v3rows = Array.isArray(v3) ? v3 : (v3.venues || v3.rows || Object.values(v3).find(Array.isArray))
  const v3row = v3rows.find((r) => r.research_key === 'jackson-v3-towne-park-pickleball-complex')
  const addressAnchor = v3row?.coordinates?.lat != null
    ? { lat: v3row.coordinates.lat, lng: v3row.coordinates.lng, precision: v3row.coordinates.precision, anchor: v3row.coordinates.anchor }
    : null
  if (!addressAnchor) { console.error('\nx no recorded v3 coordinate to corroborate against — stopping.'); process.exit(1) }

  const spread = Math.round(metresBetween(parkAnchor.lat, parkAnchor.lng, addressAnchor.lat, addressAnchor.lng))
  console.log(`\ncorroboration: park feature vs the v3 pass's recorded house-number anchor = ${spread} m apart (limit ${AGREE_MAX_M} m)`)
  console.log(`               v3 recorded: ${addressAnchor.precision} ${addressAnchor.lat},${addressAnchor.lng} — ${addressAnchor.anchor}`)
  if (spread > AGREE_MAX_M) {
    console.error(`x the two anchors disagree by ${spread} m — they are not the same site. Refusing to write a coordinate.`)
    process.exit(1)
  }

  const res = parkAnchor
  const moved = row.lat != null ? Math.round(metresBetween(res.lat, res.lng, row.lat, row.lng)) : null

  console.log(`\nslug           : ${row.slug} (status=${row.status})`)
  console.log(`address        : ${JSON.stringify(row.address)}  ->  ${JSON.stringify(TO_ADDRESS)}`)
  console.log(`address_source : ${JSON.stringify(row.address_source)}  ->  "official_page"`)
  console.log(`lat/lng        : ${row.lat},${row.lng}  ->  ${res.lat},${res.lng}${moved == null ? '' : `   (pin moves ${moved} m)`}`)
  console.log(`precision      : ${JSON.stringify(row.location_precision)}  ->  ${JSON.stringify(res.precision)}   [generated column, written via provenance.coordinate.precision]`)
  console.log(`approx label   : ${row.location_precision === 'low' ? 'ON' : 'off'}  ->  ${res.precision === 'low' ? 'ON' : 'off'}`)
  console.log(`anchor         : ${res.anchor}`)
  console.log(`UNCHANGED      : slug, name, status, verified_by/verified_at, court_count, every other column`)

  const prov = row.provenance || {}
  const nextProvenance = {
    ...prov,
    address_source: 'official_page',
    coordinate: coordinateNode(res),
    fields: { ...(prov.fields || {}), address: { value: TO_ADDRESS, source_url: SOURCE_URL } },
    jackson_v3_address_correction: {
      applied_at: nowIso,
      from: { address: row.address, address_source: row.address_source, address_verified_at: row.address_verified_at, lat: row.lat, lng: row.lng, precision: row.location_precision, coordinate: prov.coordinate ?? null },
      to: { address: TO_ADDRESS, address_source: 'official_page', address_verified_at: nowIso, lat: res.lat, lng: res.lng, precision: res.precision },
      moved_m: moved,
      source_url: SOURCE_URL,
      found_by: 'jackson-v3-2026-08-05',
      research_key: 'jackson-v3-towne-park-pickleball-complex',
      corroborating_anchor: { ...addressAnchor, spread_m: spread, read_from: 'metro-research/jackson-v3/jackson-v3-candidates.json' },
      note: 'The live row carried house number 853; the City of Clinton puts the complex at 915 Old Vicksburg Road. The persisted coordinate is the venue\'s OWN OSM feature (leisure/park "Kid\'s Towne Park"), not a road anchor: querying the corrected address returned OSM way 13603972 in two guises on one run — as place/house 915 and as the whole highway/tertiary "Old Vicksburg Road" — and those readings are 1,099 m apart, so the ladder\'s answer was unstable and the choice was made deliberately rather than taken from whichever rung won. corroborating_anchor records the house-number reading and its distance from the park feature. Slug unchanged — the URL is indexed.',
    },
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written.')
  } else {
    await updateExactlyOne(
      db.from('facility_listings')
        .update({ address: TO_ADDRESS, address_source: 'official_page', address_verified_at: nowIso, lat: res.lat, lng: res.lng, provenance: nextProvenance })
        .eq('slug', SLUG),
      'towne park address + coordinate correction'
    )
    const rv = await revalidateDirectory({ metroArea: 'Jackson' })
    if (!rv.ok) process.exitCode = 1
    console.log('\nNOTE: revalidate-directory busts the "directory" tag and revalidatePath("/courts").')
    console.log('      It does NOT revalidate /courts/[slug], which is ISR (revalidate = 21600). This row is')
    console.log('      PUBLISHED and its pin AND its approximate-location label both changed, so verify the')
    console.log('      venue page against production before calling this done.')
  }
}

// ---------------------------------------------------------------------------------------------
// ITEMS 2 & 3 — the two coordinate-blocked holds.
//
// Both were established to carry a CONFIRMED-correct street address (Magnolia against the operator's
// own site, Cascades against the Clinton Chamber directory), so each is a geocoder miss rather than a
// research failure. This attempts the ladder over several address forms and writes a coordinate only
// if one resolves. Nothing here publishes anything: a coordinate makes the row ELIGIBLE, and the
// actual publish runs through --stage=publish so the expected_publish assertion still governs.
//
// The address COLUMN is never rewritten by these two items. Variants are query forms used to
// interrogate OSM; adopting one as the venue's address would be inventing a fact the research does
// not support. Only the coordinate is persisted.
// ---------------------------------------------------------------------------------------------
if (ITEM === 'magnolia' || ITEM === 'cascades') {
  const SPEC = {
    magnolia: {
      slug: 'magnolia-pickleball-gluckstadt-ms',
      label: 'Magnolia Pickleball',
      variants: (row) => [
        { _label: 'live address as-is', name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip },
        { _label: 'suite stripped', name: row.name, address: '547 Church Road', city: row.city, state: row.state, zip: row.zip },
        { _label: 'suite stripped, city=Madison', name: row.name, address: '547 Church Road', city: 'Madison', state: row.state, zip: row.zip },
      ],
      note: 'Address confirmed as "547 Church Rd Suite G. Gluckstadt, MS 39110" on the operator\'s own site. The suite designator is what defeats the structured rung; Gluckstadt is a young municipality (incorporated 2021) that OSM and USPS often still file under Madison, hence the third variant.',
    },
    cascades: {
      slug: 'clinton-pickleball-club-at-cascades-clinton-ms',
      label: 'Clinton Pickleball Club at Cascades',
      variants: (row) => [
        { _label: 'live address as-is', name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip },
        { _label: 'chamber form "60 Cascades West"', name: row.name, address: '60 Cascades West', city: row.city, state: row.state, zip: row.zip },
        { _label: 'street only, no house number', name: row.name, address: 'Cascades Circle West', city: row.city, state: row.state, zip: row.zip },
        { _label: 'name only', name: row.name, address: null, city: row.city, state: row.state, zip: row.zip },
      ],
      note: 'Address confirmed as "60 Cascades West, Clinton MS 39056" by the Clinton Chamber sports-and-recreation directory. The live row carries the fuller "60 Cascades Circle West".',
    },
  }[ITEM]

  const row = await readListing(db, SPEC.slug)

  const fail = []
  if (row.status !== 'draft') fail.push(`status is "${row.status}" — this item only touches a row still held as draft`)
  if (row.lat != null || row.lng != null) fail.push(`row already has a coordinate (${row.lat},${row.lng}) — nothing to recover`)
  if (fail.length) { fail.forEach((f) => console.error(`  x ${f}`)); process.exit(1) }

  console.log(`slug   : ${row.slug} (status=${row.status}, lat/lng NULL)`)
  console.log(`address: ${JSON.stringify(row.address)}, ${row.city} ${row.state} ${row.zip}`)
  console.log(`context: ${SPEC.note}`)

  const res = await tryVariants(SPEC.label, SPEC.variants(row))

  if (!res) {
    console.log(`\nRESULT: ${SPEC.label} did NOT resolve on any variant. The row stays held, correctly.`)
    console.log('        Nothing is written — a held row with no coordinate is the honest state, and')
    console.log('        this trace is the input to the batched cross-metro re-geocode decision.')
  } else {
    console.log(`\nRESULT: resolved ${res.precision.toUpperCase()} via variant "${res._variant}"`)
    console.log(`        ${res.lat},${res.lng}`)
    console.log(`        anchor: ${res.anchor}`)
    console.log(`lat/lng   : NULL  ->  ${res.lat},${res.lng}`)
    console.log(`precision : NULL  ->  ${JSON.stringify(res.precision)}   [generated from provenance.coordinate.precision]`)
    console.log(`UNCHANGED : address, slug, name, status (stays DRAFT — publishing runs through --stage=publish)`)

    const prov = row.provenance || {}
    const nextProvenance = {
      ...prov,
      coordinate: coordinateNode(res),
      jackson_regeocode_2026_08_05: {
        applied_at: nowIso,
        from: { lat: row.lat, lng: row.lng, precision: row.location_precision, coordinate: prov.coordinate ?? null },
        to: { lat: res.lat, lng: res.lng, precision: res.precision },
        matched_variant: res._variant,
        queried_address: SPEC.variants(row).find((v) => v._label === res._variant)?.address ?? null,
        note: `Coordinate recovered by re-running the ladder over address variants; the venue's own address column is UNCHANGED because the variant was a query form, not a newly-sourced fact. ${SPEC.note}`,
      },
    }

    if (DRY_RUN) {
      console.log('\nDRY RUN — nothing written.')
    } else {
      await updateExactlyOne(
        db.from('facility_listings')
          .update({ lat: res.lat, lng: res.lng, provenance: nextProvenance })
          .eq('slug', SPEC.slug),
        `${SPEC.label} coordinate recovery`
      )
      console.log('\nRow is still DRAFT and has never been public, so no cache invalidation is needed here.')
      console.log('NEXT: it now passes the gate. Update expected_publish in scripts/metros/jackson.json')
      console.log('      deliberately, then run --stage=publish. Do NOT hand-publish around the assertion.')
    }
  }
}

console.log('\nDONE.')
