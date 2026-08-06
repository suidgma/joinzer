/**
 * DEAD-DOMAIN REPOINT — 2026-08-06. Three published venues whose cited domain stopped resolving.
 *
 * WHAT THIS IS NOT. It is not a retirement. The link-health sweep (scripts/link-health-sweep.mjs,
 * cc67070) put three rows in bucket 1 on NXDOMAIN, and the slice that followed was scoped to
 * un-publish them. Investigation found all three venues ALIVE at new URLs, so nothing is retired
 * and no status changes: rows stay `published`, candidates stay `research_status='published'`.
 *
 *   A DEAD DOMAIN IS NOT PROOF A VENUE IS CLOSED. It is proof we can no longer cite it.
 *
 * Every replacement below was identity-confirmed by finding THIS ROW'S OWN stored street address on
 * the live page — not by name similarity, which is what makes a replacement URL trustworthy rather
 * than a plausible guess. The DNS was re-verified at apex and www against two independent resolvers
 * (Google 8.8.8.8, Cloudflare 1.1.1.1) immediately before this file was written; all six lookups
 * returned NXDOMAIN.
 *
 *   node scripts/repoint-dead-domains-2026-08-06.mjs --item=all        --dry-run
 *   node scripts/repoint-dead-domains-2026-08-06.mjs --item=all
 *   node scripts/repoint-dead-domains-2026-08-06.mjs --item=fig-garden --dry-run
 *
 * WHY THIS FILE IS COMMITTED: the change touches no other tracked file — it rewrites URL columns on
 * three `facility_listings` rows and three `facility_candidates` rows. Run-and-discard would leave
 * the exact statements that touched production nowhere in git. Precedent:
 * `lancaster-followups-2026-08-05.mjs`, `publish-az-review.mjs`, `gen-vegas-parity.mjs`.
 *
 * SHAPE OF EVERY WRITE: read the row first, assert every fact this change assumes, print the exact
 * before/after, exit before the write under --dry-run, then UPDATE keyed on a UNIQUE column
 * (`slug` / `candidate_key`) with `.select()` and assert exactly 1 row came back. A statement that
 * touches 0 or 2 rows is a failed run, never a silent one.
 *
 * NOTHING RE-GEOCODES, NOTHING RE-SLUGS, NOTHING CHANGES STATUS. `/courts/<slug>` is an indexed
 * public URL for all three; the slug, lat/lng, status, verified_by and verified_at columns are
 * neither read for decisions nor written here. No Nominatim, no Places, no migration.
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

const nowIso = new Date().toISOString()

// The DNS evidence, recorded verbatim on every row this file touches so the next person to see a
// dead domain on a published venue finds the reasoning here rather than re-deriving it.
const DNS_EVIDENCE =
  'NXDOMAIN at both apex and www, on two independent resolvers (Google Public DNS 8.8.8.8 and ' +
  'Cloudflare 1.1.1.1), re-verified 2026-08-06 immediately before this write.'
const FOUND_BY = 'link-health-sweep (scripts/link-health-sweep.mjs, cc67070) — bucket 1 "gone", 2026-08-06'

/**
 * Three venues. Each entry is a complete statement of what is expected in the database BEFORE the
 * write and what it becomes AFTER, so the guards below can refuse anything that does not match.
 */
const ITEMS = {
  'fig-garden': {
    slug: 'fig-garden-swim-and-racquet-club-fresno-ca',
    candidateKey: 'fresno-fig-garden-swim-racquet',
    metroArea: 'Fresno',
    deadUrl: 'https://figgardenswim.com/',
    // website and the citation are the same page here: the club's home page carries both the
    // identity proof and the pickleball claim.
    websiteNext: 'https://www.fig-garden.com/',
    sourceNext: 'https://www.fig-garden.com/',
    identityProof:
      'Live page carries this row\'s stored address — "4722 North Maroa, Fresno CA 93704" vs stored "4722 N Maroa Ave" — plus phone (559) 222-4816 and "Four Pickleball Courts".',
    note:
      'Host migration only: same club, same address, same membership model (sponsorship required). ' +
      'The venue is open; only the domain moved.',
  },

  kroc: {
    slug: 'the-salvation-army-kroc-center-of-augusta-augusta-ga',
    candidateKey: 'AUG-RIC-007',
    metroArea: 'Augusta',
    deadUrl: 'https://www.krocaugusta.org/',
    websiteNext: 'https://augustakroc.org/',
    // DELIBERATE SPLIT, and the one judgement call in this file. `website` is the user-facing link,
    // so it gets the home page. The CITATION gets /krocaugusta/sports-rec, because that page is what
    // actually evidences the pickleball claim this row makes (leagues, drop-in play, lessons) —
    // the home page does not mention pickleball at all. The old domain cited one page for both and
    // that page is gone, so this repoint is also an upgrade: the row's weakest link becomes its
    // strongest. Both URLs verified HTTP 200 on 2026-08-06.
    sourceNext: 'https://augustakroc.org/krocaugusta/sports-rec',
    identityProof:
      'Live page carries this row\'s stored address — "1833 Broad Street, Augusta, GA 30904" vs stored "1833 Broad St" — plus phone 706.364.5762.',
    note:
      'Host migration only: krocaugusta.org -> augustakroc.org, same Salvation Army Ray & Joan Kroc ' +
      'Corps Community Center at the same address. A large institution whose website moved, NOT a closure. ' +
      'The new citation independently confirms pickleball, which the dead domain can no longer do.',
  },

  foreside: {
    slug: 'foreside-fitness-and-tennis-falmouth-me',
    candidateKey: 'portland_me_015',
    metroArea: 'Portland',
    deadUrl: 'https://foresidefitnesstennis.com/',
    // DELIBERATELY NULL — NOT the replacement URL. This row's `website` is already NULL and always
    // has been; the dead domain lives only in `name_source_url`. Repointing a dead citation and
    // ADDING a user-facing website the row never carried are two different decisions, and the second
    // is an owner call (same reasoning that left lehigh-acres-park's website alone on 2026-08-05).
    // Flagged in the report as a one-line follow-up, not taken here.
    websiteNext: null,
    sourceNext: 'https://www.foresidefit.com/',
    identityProof:
      'Live page carries this row\'s stored address — "196 U.S. Route One, Falmouth, Maine 04105" vs stored "196 US Route 1" — plus phone (207) 899-9897 and pickleball programming.',
    note:
      'REBRAND, not a closure: "Foreside Fitness & Tennis" now trades as "Foreside Fit" on ' +
      'foresidefit.com. That rebrand is WHY foresidefitnesstennis.com stopped resolving — the domain ' +
      'followed the name. Same club, same address, same phone.',
    // Second, independent correction riding on the same gated write. See the block below.
    accessType: {
      from: 'public',
      to: 'membership',
      reason:
        'Stored `public` came from the ADR-13 enum mapping `commercial -> public` ' +
        '(scripts/lib/workbook-extract.mjs), whose stated premise is a walk-in-and-pay facility: ' +
        '"anyone may enter and pay". That premise is false for THIS venue — foresidefit.com sells ' +
        'membership ("Unlimited access to cardio, weights, and every class", "Join Now") and ' +
        'advertises no drop-in path. Corrected per-row from the venue\'s own live page; the mapping ' +
        'itself is untouched (changing it would be an ADR-13 deviation and an owner call).',
    },
  },
}

const KEYS = Object.keys(ITEMS)
if (ITEM !== 'all' && !KEYS.includes(ITEM)) {
  console.error(`Pass --item=${[...KEYS, 'all'].join('|')}`)
  process.exit(1)
}
const SELECTED = ITEM === 'all' ? KEYS : [ITEM]

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
  console.log(`  ${label} — 1 row updated ✓`)
  return data[0]
}

/**
 * Rewrite every per-field `source_url` that points at the dead domain, and report how many moved.
 * Walking the map rather than naming fields is deliberate: the three rows carry different field
 * sets (name/address/fee_type/access_type/reservation_policy), and a hard-coded list would silently
 * leave a dead URL behind on whichever row has a field the author forgot.
 */
function rewriteFieldSources(fields, deadUrl, nextUrl) {
  const out = {}
  const moved = []
  for (const [field, node] of Object.entries(fields || {})) {
    if (node && typeof node === 'object' && node.source_url === deadUrl) {
      out[field] = { ...node, source_url: nextUrl }
      moved.push(field)
    } else {
      out[field] = node
    }
  }
  return { fields: out, moved }
}

console.log(`\n=== repoint-dead-domains · item=${ITEM} · ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} ===`)
const db = connect()

const touchedMetros = new Set()

for (const key of SELECTED) {
  const it = ITEMS[key]
  console.log(`\n---------- ${key} · ${it.slug} ----------`)

  // ---- read + guard the LISTING -------------------------------------------------------------
  const { data: lRows, error: lErr } = await db.from('facility_listings')
    .select('id, slug, name, status, metro_area, access_type, address, website, name_source_url, provenance')
    .eq('slug', it.slug)
  if (lErr) { console.error('listing read failed:', lErr.message); process.exit(1) }
  if (lRows.length !== 1) { console.error(`expected exactly 1 listing for ${it.slug}, found ${lRows.length}`); process.exit(1) }
  const listing = lRows[0]

  // ---- read + guard the CANDIDATE -----------------------------------------------------------
  const { data: cRows, error: cErr } = await db.from('facility_candidates')
    .select('id, candidate_key, batch, research_status, verified_source_url, proposed_source_url, reviewer_notes, published_listing_id')
    .eq('candidate_key', it.candidateKey)
  if (cErr) { console.error('candidate read failed:', cErr.message); process.exit(1) }
  if (cRows.length !== 1) { console.error(`expected exactly 1 candidate for ${it.candidateKey}, found ${cRows.length}`); process.exit(1) }
  const cand = cRows[0]

  // Each guard is a fact this change assumes. If any is false the situation is not the one that was
  // gated, and the run must stop rather than adapt to it.
  const fail = []
  if (listing.status !== 'published') fail.push(`listing status is "${listing.status}", expected published — this slice repoints LIVE rows and changes no status`)
  if (listing.metro_area !== it.metroArea) fail.push(`listing metro_area is "${listing.metro_area}", expected "${it.metroArea}"`)
  if (listing.name_source_url !== it.deadUrl) fail.push(`listing.name_source_url is ${JSON.stringify(listing.name_source_url)}, expected the dead ${JSON.stringify(it.deadUrl)} — someone may have already repointed this row`)
  // website: either it holds the dead URL (fig-garden, kroc) or it is NULL and stays NULL (foreside).
  if (it.websiteNext === null) {
    if (listing.website !== null) fail.push(`listing.website is ${JSON.stringify(listing.website)}, expected NULL — this item was scoped as "do not add a website"`)
  } else if (listing.website !== it.deadUrl) {
    fail.push(`listing.website is ${JSON.stringify(listing.website)}, expected the dead ${JSON.stringify(it.deadUrl)}`)
  }
  if (cand.research_status !== 'published') fail.push(`candidate research_status is "${cand.research_status}", expected published`)
  if (cand.published_listing_id !== listing.id) fail.push('candidate.published_listing_id does not point at this listing')
  if (cand.verified_source_url !== it.deadUrl) fail.push(`candidate.verified_source_url is ${JSON.stringify(cand.verified_source_url)}, expected the dead ${JSON.stringify(it.deadUrl)}`)
  if (cand.proposed_source_url !== it.deadUrl) fail.push(`candidate.proposed_source_url is ${JSON.stringify(cand.proposed_source_url)}, expected the dead ${JSON.stringify(it.deadUrl)}`)
  if (it.accessType && listing.access_type !== it.accessType.from) fail.push(`listing.access_type is "${listing.access_type}", expected "${it.accessType.from}"`)
  if (fail.length) { fail.forEach((f) => console.error(`  x ${f}`)); process.exit(1) }

  // ---- build the provenance patch -----------------------------------------------------------
  const prov = listing.provenance || {}
  const { fields: nextFields, moved } = rewriteFieldSources(prov.fields, it.deadUrl, it.sourceNext)

  // The access_type correction is a value change on top of the source rewrite, so it is applied
  // after and records why the previous value was there.
  if (it.accessType) {
    nextFields.access_type = {
      ...nextFields.access_type,
      value: it.accessType.to,
      source_url: it.sourceNext,
      // workbook_value ('commercial') is deliberately preserved: it is what the workbook actually
      // said, and erasing it would hide the mapping that produced the wrong value.
      override_note: it.accessType.reason,
      corrected_at: nowIso,
    }
  }

  const nextProvenance = {
    ...prov,
    fields: nextFields,
    // The audit node. Records what was there before, so the change is reversible from the row itself
    // without consulting a log. Same shape as lancaster_v3_address_backfill / pensacola_recovery.
    dead_domain_repoint_2026_08_06: {
      applied_at: nowIso,
      dead_domain: new URL(it.deadUrl).host,
      dead_url: it.deadUrl,
      dns_evidence: DNS_EVIDENCE,
      found_by: FOUND_BY,
      replacement_website: it.websiteNext,
      replacement_source_url: it.sourceNext,
      identity_proof: it.identityProof,
      venue_status: 'OPEN — verified live at the replacement URL. A dead domain is not proof a venue is closed; it is proof we can no longer cite it.',
      from: {
        website: listing.website,
        name_source_url: listing.name_source_url,
        ...(it.accessType ? { access_type: listing.access_type } : {}),
      },
      to: {
        website: it.websiteNext,
        name_source_url: it.sourceNext,
        ...(it.accessType ? { access_type: it.accessType.to } : {}),
      },
      provenance_fields_repointed: moved,
      note: it.note,
      ...(it.accessType ? { access_type_correction: it.accessType.reason } : {}),
      unchanged: 'slug, name, lat/lng, coordinate provenance, status, verified_by, verified_at, court_count',
    },
  }

  const candNote =
    `[REPOINTED 2026-08-06] ${new URL(it.deadUrl).host} went NXDOMAIN (${FOUND_BY}); venue verified OPEN at ` +
    `${it.sourceNext}. ${it.note}${it.accessType ? ` access_type ${it.accessType.from} -> ${it.accessType.to}.` : ''}`

  // ---- print the exact before/after ---------------------------------------------------------
  console.log(`  status         : ${listing.status} (UNCHANGED)`)
  console.log(`  candidate      : ${cand.candidate_key} · research_status=${cand.research_status} (UNCHANGED)`)
  console.log(`  website        : ${JSON.stringify(listing.website)}  ->  ${JSON.stringify(it.websiteNext)}${it.websiteNext === null ? '  [deliberately unchanged — adding one is an owner call]' : ''}`)
  console.log(`  name_source_url: ${JSON.stringify(listing.name_source_url)}  ->  ${JSON.stringify(it.sourceNext)}`)
  if (it.accessType) console.log(`  access_type    : ${JSON.stringify(listing.access_type)}  ->  ${JSON.stringify(it.accessType.to)}`)
  console.log(`  cand.verified_source_url: ${JSON.stringify(cand.verified_source_url)}  ->  ${JSON.stringify(it.sourceNext)}`)
  console.log(`  cand.proposed_source_url: ${JSON.stringify(cand.proposed_source_url)}  ->  ${JSON.stringify(it.sourceNext)}`)
  console.log(`  provenance     : fields repointed [${moved.join(', ') || 'none'}] + dead_domain_repoint_2026_08_06${it.accessType ? ' + access_type override_note' : ''}`)
  console.log(`  UNCHANGED      : slug, name, lat/lng, status, verified_by/verified_at, every other column`)

  if (DRY_RUN) continue

  // ---- write --------------------------------------------------------------------------------
  const listingPatch = {
    name_source_url: it.sourceNext,
    provenance: nextProvenance,
    ...(it.websiteNext !== null ? { website: it.websiteNext } : {}),
    ...(it.accessType ? { access_type: it.accessType.to } : {}),
  }
  await updateExactlyOne(
    db.from('facility_listings').update(listingPatch).eq('slug', it.slug),
    `${key} listing repoint`
  )
  await updateExactlyOne(
    db.from('facility_candidates')
      .update({
        verified_source_url: it.sourceNext,
        proposed_source_url: it.sourceNext,
        reviewer_notes: cand.reviewer_notes ? `${cand.reviewer_notes} | ${candNote}` : candNote,
      })
      .eq('candidate_key', it.candidateKey),
    `${key} candidate repoint`
  )
  touchedMetros.add(it.metroArea)
}

// ---- cache invalidation, once per touched metro ----------------------------------------------
// These rows are PUBLISHED, so the edit changes what the directory serves. Every read in
// lib/directory/loadFacilities.ts is unstable_cache'd for 6h under the 'directory' tag and this
// script writes straight to Postgres with the service role — nothing in the request path observes
// it. Same reason --stage=publish calls this.
if (DRY_RUN) {
  console.log('\nDRY RUN — nothing written. No cache invalidation issued.')
} else {
  for (const metroArea of touchedMetros) {
    const rv = await revalidateDirectory({ metroArea })
    if (!rv.ok) process.exitCode = 1
  }
  console.log('\nNOTE: /api/revalidate-directory busts the "directory" tag and revalidatePath("/courts").')
  console.log('      It names NO /courts/[slug] path, and those pages are ISR (revalidate = 21600).')
  console.log('      Whether the tag reaches them is an OPEN QUESTION — verify all three venue pages')
  console.log('      against production and report which way it went. Three pages changing at once is')
  console.log('      a cleaner test of this than the single-row Lancaster case that first raised it.')
}

console.log('\nDONE.')
