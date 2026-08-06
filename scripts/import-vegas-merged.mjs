/**
 * Directory — apply the Las Vegas metro merged research pass (batch `vegas-merged-2026-07-31`).
 *
 * Source of truth: court-verifier/output/las-vegas-2026-07-31/stage-4-import-manifest.json
 * (generated, not executed) + owner-decisions.md (locked owner rulings; the .md wins on conflict).
 * Both live OUTSIDE this repo, in the AI-team workspace — so the 60 rows are transcribed inline
 * here and `--stage=crosscheck` re-derives them from the manifest and aborts on any divergence.
 * That makes the transcription falsifiable instead of trusted (Little Rock lesson, 2026-07-30).
 *
 * Two write stages, each independently dry-runnable, plus three read-only stages:
 *   --stage=baseline    read-only. Prints the four reconcile counts. Run BEFORE and AFTER.
 *   --stage=crosscheck  read-only, no DB. Diffs the embedded rows against the manifest JSON.
 *   --stage=inserts     9 net-new rows → facility_listings as status='draft', osm_id=null.
 *   --stage=updates     51 keyed UPDATEs against existing `vegas-parity-2026-07` rows, matched BY ID.
 *   --stage=verify      read-only post-write assertions, including the untouched-set proof.
 *
 * INSERT / UPDATE ONLY. There is no DELETE, no TRUNCATE and no DDL anywhere in this file, and no
 * stage writes `status`, `verified_by`, `verified_at` or `enrichment_version` — asserted, not
 * assumed (see assertNoPublishFields). The published count is expected to be UNCHANGED at 252.
 *
 * Why nothing publishes:
 *   - every new row lands `status='draft'` (invisible — lib/directory/loadFacilities.ts filters
 *     status='published'), with `verified_by` NULL. `verified_by != null || enrichment_version
 *     != null` is the trust signal scripts/publish-facilities.mjs reconciles on, so leaving both
 *     NULL is load-bearing: a later reconcile pass cannot pick these rows up.
 *   - Whitney Mesa additionally carries `provenance.coordinate.precision='low'` — the shared-campus
 *     placeholder point. That is INTENDED: publish-facilities.mjs's lowPrecision() guard reads
 *     exactly that path and holds the row back until a human pins the actual court location.
 *     Do not "fix" it by faking precision (owner-decisions.md Section A #5).
 *
 * Scope fence — 13 rows are explicitly OFF LIMITS this pass (6 HOLD / 3 REJECT / 7 NEEDS-HUMAN,
 * of which 13 carry a live listing id). PROTECTED_IDS below is a hard negative guard: preflight
 * aborts if any target id lands in it, and --stage=verify proves all 13 are byte-for-byte
 * untouched. The Ward 6 retire/merge is a LATER decision — its row is left as-is, unpublished.
 * Nothing is deleted this pass.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/import-vegas-merged.mjs --stage=baseline
 *   node scripts/import-vegas-merged.mjs --stage=crosscheck --manifest=<abs path to the .json>
 *   node scripts/import-vegas-merged.mjs --stage=inserts --dry-run
 *   node scripts/import-vegas-merged.mjs --stage=inserts
 *   node scripts/import-vegas-merged.mjs --stage=updates --dry-run
 *   node scripts/import-vegas-merged.mjs --stage=updates
 *   node scripts/import-vegas-merged.mjs --stage=verify
 *   node scripts/import-vegas-merged.mjs --stage=baseline
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DRY_RUN = process.argv.includes('--dry-run')
const STAGE = (process.argv.find((a) => a.startsWith('--stage=')) || '').split('=')[1]
const MANIFEST = (process.argv.find((a) => a.startsWith('--manifest=')) || '').split('=')[1]
if (!['baseline', 'crosscheck', 'inserts', 'updates', 'verify'].includes(STAGE)) {
  console.error('Pass --stage=baseline|crosscheck|inserts|updates|verify'); process.exit(1)
}

const BATCH = 'vegas-merged-2026-07-31'      // new rows carry this traceable tag
const PARITY = 'vegas-parity-2026-07'        // the pre-existing batch the 51 UPDATEs belong to
const METRO = 'Las Vegas'
const MANIFEST_REF = 'court-verifier/output/las-vegas-2026-07-31/stage-4-import-manifest.json'
const nowIso = new Date().toISOString()

// ---- live CHECK vocabularies (re-pulled from pg_constraint 2026-07-31; keep in lockstep) ----
const ACCESS_TYPE = new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown'])
const FEE_TYPE = new Set(['free', 'fee', 'membership', 'unknown'])
const VERIFICATION_STATUS = new Set(['unverified', 'source_verified', 'human_verified'])
const ADDRESS_SOURCE = new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy'])

// Clark County NV envelope. Boulder City (~35.96) and Mesquite (~36.81) are both Clark County and
// therefore inside the Las Vegas–Henderson–Paradise MSA, which is why the box is this tall.
const ENVELOPE = { latMin: 35.5, latMax: 37.0, lngMin: -116.0, lngMax: -113.8 }

// ADR-14: aggregator hosts are a tier-4 private research input, never a user-facing column.
const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited/i

// A patch may never contain one of these. status/verified_by/verified_at/enrichment_version are the
// publish machinery; touching any of them from an import script is how a draft silently goes live.
const FORBIDDEN_PATCH_FIELDS = ['status', 'verified_by', 'verified_at', 'enrichment_version', 'enrichment', 'enriched_at']

// ---------------------------------------------------------------------------------------------
// SCOPE FENCE — do-not-touch ids (manifest hold[] + reject[] + needs_human[], id non-null only)
// ---------------------------------------------------------------------------------------------
const PROTECTED = [
  { id: 'cb3e216d-b5c0-4b77-94f8-54e4b8be32e4', name: 'BLVD Pickleball', bucket: 'hold' },
  { id: '02a47f61-b4c0-4627-aca9-d8fa3c152354', name: 'Desert Breeze Community Center', bucket: 'hold' },
  { id: '17e043a3-3a00-4621-b085-5387dc124396', name: 'Downtown Recreation Center', bucket: 'hold' },
  { id: 'd16d1356-586e-40e4-afdc-dc53bd7c6ca5', name: 'Southern Highlands Racquets', bucket: 'hold' },
  { id: '3ac2bf69-d77b-4331-96b7-fa90bd7d4dc5', name: 'Anthem Community Park', bucket: 'reject' },
  { id: '32586752-32e8-4229-a183-f8149014176d', name: 'Skye Hills Park', bucket: 'reject' },
  { id: 'e3ef1884-78ff-42d0-a2c0-2e69a9a81f51', name: 'Ward 6 Pickleball Courts', bucket: 'reject' },
  { id: '8d28be2e-d517-40d7-8d6b-cdb893474d89', name: 'Bob Baskin Park', bucket: 'needs_human' },
  { id: '64d044fb-75c8-4769-996e-9e4ae11d8990', name: 'Mirabelli Community Center', bucket: 'needs_human' },
  { id: '7101dc7b-b40f-4b8b-aab8-9995705be3b9', name: 'Neighborhood Recreation Center', bucket: 'needs_human' },
  { id: '3c8bbf3e-e8ba-41a4-92a9-37f3633a4de2', name: 'Paradise Recreation Center', bucket: 'needs_human' },
  { id: '7c9eb26d-5939-4c25-ba35-b83828671609', name: 'Saddlebrook Park', bucket: 'needs_human' },
  { id: 'adbaa969-dd43-453c-90b0-9d32e1c880e9', name: 'Spirit Park', bucket: 'needs_human' },
]
const PROTECTED_IDS = new Set(PROTECTED.map((p) => p.id))

// ---------------------------------------------------------------------------------------------
// INSERT set — 9 net-new venues (manifest `insert[]`)
//
// DELIBERATELY EXCLUDED: the manifest's 10th proposed row, `insert_additive_lead_not_in_76_count`
// (Silver Mesa Recreation Center & Pool). The apply brief scopes this pass to exactly 9 INSERTs;
// the additive lead sits outside the 76-venue reconciled set and the manifest itself asks for a
// human second look. It is a separate, later decision — not absorbed here.
// ---------------------------------------------------------------------------------------------
const INSERTS = [
  {
    name: 'Whitney Mesa Pickleball Courts',
    slug: 'whitney-mesa-pickleball-courts-henderson-nv',
    city: 'Henderson', state: 'NV', address: '1575 Galleria Dr',
    lat: 36.0757665, lng: -115.0584522,
    court_count: 4, access_type: 'public', fee_type: 'free', verification_status: 'human_verified',
    name_source_url: 'https://www.cityofhenderson.com/government/departments/parks-and-recreation/parks-and-trails/pickleball',
    provenance: {
      coordinate: { precision: 'low', note: "reused Whitney Ranch Recreation Center's point; independent Nominatim geocode of the shared address returned two inconsistent candidates, neither matching a known building on the campus" },
      owner_decision: 'owner-decisions.md Section A #5, 2026-07-31 (name + address correction, distinct-record-on-shared-campus ruling)',
      flags: ['no distinct campus pin found this pass', 'fee_type at medium confidence (aggregator)'],
    },
  },
  {
    name: 'Boulder City Parks and Recreation Center',
    slug: 'boulder-city-parks-and-recreation-center-boulder-city-nv',
    city: 'Boulder City', state: 'NV', address: null,
    lat: 35.9787015, lng: -114.8332537,
    court_count: 4, access_type: 'public', fee_type: null, verification_status: 'human_verified',
    name_source_url: 'https://www.bcnv.org/1126/Pickleball-Information',
    provenance: { indoor: true },
  },
  {
    name: 'Broadbent Park',
    slug: 'broadbent-park-boulder-city-nv',
    city: 'Boulder City', state: 'NV', address: null,
    lat: 35.9731991, lng: -114.8363103,
    court_count: 8, access_type: 'public', fee_type: null, verification_status: 'human_verified',
    name_source_url: 'https://www.bcnv.org/1126/Pickleball-Information',
    provenance: { indoor: false },
  },
  {
    name: 'ABC Park',
    slug: 'abc-park-boulder-city-nv',
    city: 'Boulder City', state: 'NV', address: null,
    lat: 35.9683039, lng: -114.8312194,
    court_count: 3, access_type: 'public', fee_type: null, verification_status: 'human_verified',
    name_source_url: 'https://www.bcnv.org/1126/Pickleball-Information',
    provenance: { note: '1 indoor + 2 outdoor' },
  },
  {
    name: 'Veterans Memorial Park',
    slug: 'veterans-memorial-park-boulder-city-nv',
    city: 'Boulder City', state: 'NV', address: null,
    lat: 35.9552190, lng: -114.8454378,
    court_count: 4, access_type: 'public', fee_type: null, verification_status: 'human_verified',
    name_source_url: 'https://www.bcnv.org/1126/Pickleball-Information',
    provenance: { indoor: false },
  },
  {
    name: 'Old Mill Pickleball Courts',
    slug: 'old-mill-pickleball-courts-mesquite-nv',
    city: 'Mesquite', state: 'NV', address: null,
    lat: 36.8095184, lng: -114.0690046,
    court_count: null, access_type: 'public', fee_type: null, verification_status: 'human_verified',
    name_source_url: null,
    provenance: {
      flags: ['City of Mesquite page opened tier-1 but exact URL not preserved from Chunk 2 — needs backfill'],
      corroboration: 'OSM leisure=pitch tag at same address',
    },
  },
  {
    name: 'Mesquite Recreation Center',
    slug: 'mesquite-recreation-center-mesquite-nv',
    city: 'Mesquite', state: 'NV', address: null,
    lat: 36.8084763, lng: -114.0699845,
    court_count: null, access_type: 'public', fee_type: null, verification_status: 'source_verified',
    name_source_url: null,
    provenance: {
      flags: ["LOW-MEDIUM CONFIDENCE — city news post describes a weekly 'Pickleball Family Nights' program, reads as shared-gym use not dedicated courts; flagged for extra scrutiny before ever publishing"],
    },
  },
  {
    name: 'Durango Hills YMCA',
    slug: 'durango-hills-ymca-las-vegas-nv',
    city: 'Las Vegas', state: 'NV', address: '3521 N Durango Dr',
    lat: 36.2248966, lng: -115.280775,
    court_count: null, access_type: 'membership', fee_type: 'membership', verification_status: 'human_verified',
    name_source_url: 'https://www.lasvegasymca.org/programs/health-wellness/pickleball/',
    provenance: { note: 'co-located with Durango Hills Park, distinct record' },
  },
  {
    name: 'The Courts at Summerlin',
    slug: 'the-courts-at-summerlin-las-vegas-nv',
    city: 'Las Vegas', state: 'NV', address: '10000 Covington Cross Dr',
    lat: 36.1865435, lng: -115.3137204,
    court_count: 8, access_type: 'membership', fee_type: 'membership', verification_status: 'human_verified',
    name_source_url: 'https://www.courtslv.com/location',
    provenance: { indoor: true },
  },
]

// ---------------------------------------------------------------------------------------------
// UPDATE set — 51 existing `vegas-parity-2026-07` rows, matched BY id (manifest `update[]`)
//
// `changes` is applied verbatim from the manifest. Two manifest rows carry a `flag` that reads as
// a caution rather than an exclusion — Knight Skye Park (access_type public→unknown) most of all.
// The manifest's own convention is that a recommendation NOT to be applied is simply absent from
// `changes` (see Centennial Hills YMCA's access_type and the Leavitt spelling, both flagged and
// both correctly omitted), so Knight Skye's presence in `changes` is treated as in-spec. It is
// also self-blocking: access_type='unknown' fails the publish gate, so the change holds the row
// back rather than exposing it. Every prior value is recorded in provenance, so it reverses with
// one statement while the row is still draft.
// ---------------------------------------------------------------------------------------------
const UPDATES = [
  { id: '17d1bf87-ba6b-4a5f-8cbf-19619c99644e', name: 'Aloha Shores Park', changes: { verification_status: 'human_verified' } },
  { id: '1d5d66d0-abb0-4945-ac5f-44ab057193e5', name: 'Ardiente', changes: { access_type: 'hoa', verification_status: 'source_verified' }, flag: "DB stores 'private'; reconciliation.md incorrectly assumed this was already fixed to hoa — it wasn't. New finding this pass." },
  { id: 'f641862b-61d0-42c2-9e19-e43ec86d3bdc', name: 'Aventura Park', changes: { verification_status: 'human_verified' } },
  { id: 'fcc64b26-6e3c-45f6-8431-9fe43f976d7f', name: 'Bill and Lillie Heinrich YMCA', changes: { court_count: null, access_type: 'membership', verification_status: 'human_verified' } },
  { id: 'd4846bd5-dee8-4734-baa8-3a9ff9025298', name: 'Bill Briare Family Park', changes: { verification_status: 'human_verified' } },
  { id: 'e10d6c85-880e-4d48-aa09-2a6d4515287b', name: 'Black Mountain Recreation Center', changes: { verification_status: 'human_verified' } },
  { id: '25c87150-afb1-4254-8d2c-53d79bfbd42a', name: 'Blooming Cactus Park', changes: { verification_status: 'human_verified' } },
  { id: 'cfd454b6-eed5-415b-83ef-2066c204b6da', name: 'Canyon Gate Country Club', changes: { court_count: 4, access_type: 'membership', verification_status: 'human_verified' }, owner_decision: 'Section A #3' },
  { id: '6aba3bdb-160b-496a-b88a-4b014dc0b219', name: 'Centennial Hills Park', changes: { verification_status: 'human_verified' }, provenance_note: 'Ward 6 Pickleball Courts retired as an alias of this record — see reject' },
  { id: 'c4bc1951-b200-450e-a225-f96fefa8bfad', name: 'Centennial Hills YMCA', changes: { court_count: null, verification_status: 'human_verified' }, flag: "access_type stored 'public'; recommend 'membership' for consistency with sibling YMCA branches, but not applied — no prior chunk explicitly ruled on this field for this row" },
  { id: '60c33127-497d-4277-b902-75b24aff381d', name: 'Chicken N Pickle - Henderson', changes: { fee_type: 'fee', verification_status: 'human_verified' } },
  { id: '055ca78e-300f-4c25-be44-c5a840cddf6a', name: 'Chuck Minker Sports Complex', changes: { court_count: null, verification_status: 'human_verified' } },
  { id: '8a20a5fc-6d09-4cac-8715-4ce232358426', name: 'Cougar Creek Park', changes: { verification_status: 'human_verified' } },
  { id: 'c5ebbffc-4b42-4061-9c58-3a91bac3900e', name: 'Deer Springs Park', changes: { verification_status: 'human_verified' } },
  { id: 'fb7e5b74-e321-45ca-bd9e-d349a12aeb69', name: 'Desert Vista Community Center', changes: { access_type: 'hoa', address: '10360 Sun City Blvd', verification_status: 'source_verified' } },
  { id: 'a9454da7-8c22-4108-a83d-de86dc9918d4', name: 'Dill Dinkers Henderson', changes: { access_type: 'membership', verification_status: 'human_verified' } },
  { id: '6a3c7895-8de7-4434-a498-98eec442edb0', name: 'Dundee Jones Park', changes: { verification_status: 'human_verified' } },
  { id: 'e90a15da-915f-4cd3-8a05-7c7b6457bc72', name: 'Durango Hills Park', changes: { verification_status: 'human_verified' } },
  { id: 'df68d7fe-1de6-4388-9d82-0ce9b33af021', name: 'Hollywood Regional Park', changes: { verification_status: 'human_verified' } },
  { id: 'c1c74b4b-e60c-4624-83be-af6f6f594453', name: 'Justice Myron Leavitt & Jaycee Community Park', changes: { verification_status: 'human_verified' }, flag: "Clark County spells it 'Myron E. Leavitt' - cosmetic only, not auto-applied" },
  { id: '68ec7bcf-ed94-48b2-9c7a-333c3514fcec', name: 'Knight Skye Park', changes: { access_type: 'unknown', verification_status: 'source_verified' }, flag: "Downgrades existing 'public' value — Skye Canyon HOA's own site confirms 3 courts but not land ownership; flagged for human confirmation before applying" },
  { id: 'cb769575-05a8-4e84-8110-6eea776bef7f', name: 'Las Vegas Motorcoach Resort', changes: { verification_status: 'human_verified' }, note: "access_type 'private' confirmed correct as-is; address 8175 Arville St confirmed correct, AI-search address trap avoided" },
  { id: '11af18fd-dda0-46b7-825e-2d13299d3229', name: 'Life Time - Summerlin', changes: { access_type: 'membership', address: '10721 W Charleston Blvd', verification_status: 'human_verified' } },
  { id: 'f8d00fa1-eb30-45fb-9b14-17f1e4254741', name: 'Lone Mountain Regional Park', changes: { lat: 36.2341950, lng: -115.3086893, verification_status: 'human_verified' } },
  { id: 'ba4e0867-473a-48d9-901a-e252cb55f345', name: 'Lorenzi Park', changes: { verification_status: 'human_verified' } },
  { id: 'd4c309b1-a9ef-4b90-8ccc-95bf931b59c3', name: 'Lt. Erik Lloyd Memorial Park', changes: { lat: 36.0766418, lng: -115.3034188, verification_status: 'human_verified' }, note: '~24km coordinate correction' },
  { id: 'ddd558c1-e1dd-472d-864f-b3fa7840d5c2', name: 'Mission Hills Park', changes: { verification_status: 'human_verified' } },
  { id: '64ec1dba-c3b1-4e2a-ad53-3257ee4e4e23', name: 'Montagna Park', changes: { verification_status: 'human_verified' } },
  { id: 'de6bb452-75ba-4a95-a1e8-e91f97c1fcb7', name: 'Mr. Pickleball Indoor', changes: { access_type: 'membership', address: '2000 S Rainbow Blvd #100', verification_status: 'human_verified' } },
  { id: '8d04f530-2e5f-4cb2-bb4e-d32bbab381ae', name: 'Oak Leaf Park', changes: { address: '6401 Farness Street', verification_status: 'human_verified' } },
  { id: '2b05fcd1-130f-45c1-97b9-9d4038fe1ea3', name: 'Patriot Community Park', changes: { verification_status: 'human_verified' } },
  { id: 'f88fae03-2c5b-4773-9676-d9d116d10ccd', name: 'Plaza Hotel & Casino', changes: { fee_type: 'fee', verification_status: 'human_verified' } },
  { id: 'fd1e08c8-acad-4b72-a359-6653a5d94e90', name: 'Police Memorial Park', changes: { lat: 36.2192743, lng: -115.3109693, verification_status: 'human_verified' } },
  { id: 'eed188b3-86f9-47a6-b4ea-2a61c76af086', name: 'Regency at Summerlin', changes: { access_type: 'hoa', verification_status: 'source_verified' } },
  { id: '291a91f8-09af-4680-9e9c-4a9ab14861b5', name: 'Reverence Pickleball Courts', changes: { access_type: 'hoa', verification_status: 'source_verified' } },
  { id: '18505075-0ab8-4ffd-b040-c70f2bfb14ea', name: "Robert E. 'Bob' Price Recreation Center / Park", changes: { address: '2100 Bonnie Ln.', verification_status: 'human_verified' } },
  { id: '8a5e490d-64c0-4b7e-8af1-d08e3acb8cac', name: 'Siena Community Association', changes: { court_count: null, access_type: 'hoa', verification_status: 'source_verified' }, owner_decision: 'Section A #4 — 4-vs-6 conflict preserved as null' },
  { id: 'fb46971e-1e53-49b7-b3d9-714a87e20765', name: 'Siena Heights Trailhead', changes: { verification_status: 'human_verified' } },
  { id: 'bfc5c309-2e8b-4068-9572-05a5579fa9da', name: 'Silver Springs Recreation Center', changes: { court_count: null, verification_status: 'human_verified' }, owner_decision: 'Section C #5 — 3-vs-1 conflict preserved as null' },
  { id: 'fea4b19c-36c9-4884-9f4d-5ade1d196036', name: 'Skye View Park', changes: { verification_status: 'source_verified' } },
  { id: '56eff40e-dc47-493b-bd3a-513bbfe4c70c', name: 'Sonata Park', changes: { verification_status: 'human_verified' } },
  { id: '7a14fde3-0136-431f-9ee0-0cd3c08fe750', name: 'Spanish Oaks Tennis Club', changes: { access_type: 'membership', verification_status: 'source_verified' } },
  { id: 'e150fb70-baff-4e69-a8fe-702774100f30', name: 'Sun City Aliante', changes: { access_type: 'hoa', verification_status: 'source_verified' }, flag: "owner-decisions.md's closing 'Still open' note is stale — Chunk 3 addendum Target 4 already resolved this to probable" },
  { id: '52f3ad3d-0d56-4273-a684-0fea3072a4b0', name: 'Sunridge Park', changes: { verification_status: 'human_verified' } },
  { id: '6f771644-62ee-474e-8929-a800ad5dc5f2', name: 'Sunset Park Pickleball Complex', changes: { fee_type: 'fee', verification_status: 'human_verified' } },
  { id: '0b27f9d4-bdf3-4ec5-a5e4-f4d215d783f8', name: 'The Pickleball Universe', changes: { address: '9001 Dean Martin Dr', access_type: 'membership', verification_status: 'human_verified' } },
  { id: '3346f120-36cd-49e7-b0e7-b3089b2f99ce', name: 'The Picklr Henderson', changes: { access_type: 'membership', verification_status: 'human_verified' } },
  { id: '26bb448b-2e07-4e47-a1ef-dd604157fa58', name: 'Vegas Indoor Pickleball', changes: { verification_status: 'human_verified' } },
  { id: 'd0c90dac-298e-4edd-abd8-a1570f9b32fa', name: 'Westgate Las Vegas Resort & Casino', changes: { fee_type: 'fee', verification_status: 'human_verified' } },
  { id: '658d2e33-0177-4e87-9a6a-236cc34ecbb5', name: 'Weston Hills Park', changes: { verification_status: 'human_verified' } },
  { id: 'ae162126-81ec-4ed6-9b0c-c7f4c1f82e90', name: 'Whitney Ranch Recreation Center', changes: { verification_status: 'human_verified' } },
]

// ---------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------
// ADR-12: every address write must set `address_source` from the pinned six-value vocabulary.
// This batch's addresses come from controlling-entity pages and one owner correction, none of them
// from Google Places — `manual_research` is the honest catch-all (ADR-14 files research-derived
// addresses there too), and the specific source URL is kept in provenance rather than inflating
// the column to `official_page` per row.
const ADDRESS_SOURCE_VALUE = 'manual_research'

const insertRows = INSERTS.map((v) => ({
  name: v.name,
  slug: v.slug,
  source: BATCH,                       // explicit — never the 'osm' NOT NULL default
  status: 'draft',                     // 0 published this pass; nothing here goes live
  osm_id: null,
  lat: v.lat, lng: v.lng,
  address: v.address,
  address_source: v.address ? ADDRESS_SOURCE_VALUE : null,
  address_verified_at: v.address ? nowIso : null,
  city: v.city, state: v.state, zip: null, country: 'US',
  metro_area: METRO,
  court_count: v.court_count,
  access_type: v.access_type,
  fee_type: v.fee_type,
  reservation_policy: null,
  indoor: null,                        // manifest records indoor inside provenance, not as a column
  lighting: null,
  surface: null,
  website: null,
  phone: null,
  public_notes: null,
  google_place_id: null,
  name_source_url: v.name_source_url,
  verification_status: v.verification_status,
  verified_at: null, verified_by: null,        // load-bearing: keeps publish-facilities.mjs off these rows
  enrichment: null, enriched_at: null, enrichment_version: null,
  location_id: null,
  provenance: {
    ...v.provenance,                   // spread at TOP level so provenance.coordinate.precision is
    batch: BATCH,                      // where publish-facilities.mjs's lowPrecision() reads it
    method: 'merged_research',
    manifest: MANIFEST_REF,
    manifest_generated_at: '2026-07-31',
    owner_decisions_ref: 'court-verifier/output/las-vegas-2026-07-31/owner-decisions.md',
    address_source_note: v.address ? `address_source=${ADDRESS_SOURCE_VALUE} per ADR-12; primary source: ${v.name_source_url || 'see flags'}` : null,
    imported_at: nowIso,
  },
}))

/** The patch actually sent for one UPDATE row, plus the before/after diff for the log. */
function buildPatch(spec, current) {
  const patch = {}
  const diff = {}
  for (const [k, to] of Object.entries(spec.changes)) {
    patch[k] = to
    diff[k] = { from: current[k] ?? null, to: to ?? null }
  }
  if ('address' in spec.changes) {
    patch.address_source = ADDRESS_SOURCE_VALUE
    patch.address_verified_at = nowIso
    diff.address_source = { from: current.address_source ?? null, to: ADDRESS_SOURCE_VALUE }
  }
  patch.provenance = {
    ...(current.provenance || {}),      // preserve the 2026-07-24 locations-migration node
    vegas_merged_2026_07_31: {
      batch: BATCH,
      manifest: MANIFEST_REF,
      owner_decisions_ref: 'court-verifier/output/las-vegas-2026-07-31/owner-decisions.md',
      owner_decision: spec.owner_decision ?? null,
      flag: spec.flag ?? null,
      note: spec.note ?? null,
      provenance_note: spec.provenance_note ?? null,
      changes_applied: diff,            // every prior value recorded — a one-statement revert
      applied_at: nowIso,
    },
  }
  return { patch, diff }
}

// ---------------------------------------------------------------------------------------------
// Pre-flight — any failure aborts. Never relax an assertion to make a run pass.
// ---------------------------------------------------------------------------------------------
function assertNoPublishFields(fail) {
  for (const u of UPDATES) {
    for (const f of FORBIDDEN_PATCH_FIELDS) {
      if (f in u.changes) fail.push(`${u.name}: patch contains forbidden field "${f}" — this script never publishes`)
    }
  }
  for (const r of insertRows) {
    if (r.status !== 'draft') fail.push(`${r.slug}: insert status is "${r.status}", must be draft`)
    if (r.verified_by != null || r.verified_at != null || r.enrichment_version != null) fail.push(`${r.slug}: carries a trust signal — publish-facilities.mjs would pick it up`)
  }
}

async function preflight({ expectInsertsAbsent }) {
  const fail = []

  if (INSERTS.length !== 9) fail.push(`insert count ${INSERTS.length} != 9`)
  if (UPDATES.length !== 51) fail.push(`update count ${UPDATES.length} != 51`)
  assertNoPublishFields(fail)

  // internal uniqueness
  for (const [label, vals] of [['slug', INSERTS.map((v) => v.slug)], ['update id', UPDATES.map((u) => u.id)]]) {
    const seen = new Set(), dup = new Set()
    for (const x of vals) { if (seen.has(x)) dup.add(x); seen.add(x) }
    if (dup.size) fail.push(`duplicate ${label} in input: ${[...dup].join(', ')}`)
  }

  // SCOPE FENCE — nothing in this pass may target a hold/reject/needs-human row.
  for (const u of UPDATES) if (PROTECTED_IDS.has(u.id)) fail.push(`SCOPE FENCE: update target ${u.id} (${u.name}) is a protected hold/reject/needs-human row`)

  // enum + envelope + ADR-14, insert side
  for (const v of INSERTS) {
    if (!ACCESS_TYPE.has(v.access_type)) fail.push(`${v.slug}: access_type "${v.access_type}"`)
    if (v.fee_type != null && !FEE_TYPE.has(v.fee_type)) fail.push(`${v.slug}: fee_type "${v.fee_type}"`)
    if (!VERIFICATION_STATUS.has(v.verification_status)) fail.push(`${v.slug}: verification_status "${v.verification_status}"`)
    if (v.lat == null || v.lng == null) fail.push(`${v.slug}: missing coordinate`)
    else if (v.lat < ENVELOPE.latMin || v.lat > ENVELOPE.latMax || v.lng < ENVELOPE.lngMin || v.lng > ENVELOPE.lngMax) fail.push(`${v.slug}: coordinate ${v.lat},${v.lng} outside the Clark County envelope`)
    if (AGGREGATOR_HOST.test(v.name_source_url || '')) fail.push(`${v.slug}: name_source_url is an aggregator host (ADR-14)`)
  }
  for (const r of insertRows) if (r.address_source != null && !ADDRESS_SOURCE.has(r.address_source)) fail.push(`${r.slug}: address_source "${r.address_source}"`)

  // enum, update side
  for (const u of UPDATES) {
    const c = u.changes
    if ('access_type' in c && !ACCESS_TYPE.has(c.access_type)) fail.push(`${u.name}: access_type "${c.access_type}"`)
    if ('fee_type' in c && c.fee_type != null && !FEE_TYPE.has(c.fee_type)) fail.push(`${u.name}: fee_type "${c.fee_type}"`)
    if ('verification_status' in c && !VERIFICATION_STATUS.has(c.verification_status)) fail.push(`${u.name}: verification_status "${c.verification_status}"`)
    if (('lat' in c) !== ('lng' in c)) fail.push(`${u.name}: half a coordinate change`)
    if ('lat' in c && (c.lat < ENVELOPE.latMin || c.lat > ENVELOPE.latMax || c.lng < ENVELOPE.lngMin || c.lng > ENVELOPE.lngMax)) fail.push(`${u.name}: corrected coordinate outside the Clark County envelope`)
  }

  // live checks
  const { data: sc, error: e1 } = await db.from('facility_listings').select('slug').in('slug', INSERTS.map((v) => v.slug))
  if (e1) fail.push(`slug collision check failed: ${e1.message}`)
  else if (expectInsertsAbsent && sc.length) fail.push(`slug collisions live: ${sc.map((r) => r.slug).join(', ')}`)

  const { data: live, error: e2 } = await db.from('facility_listings').select('id, source, status').in('id', UPDATES.map((u) => u.id))
  if (e2) fail.push(`update-target read failed: ${e2.message}`)
  else {
    if (live.length !== UPDATES.length) fail.push(`expected ${UPDATES.length} live update targets, found ${live.length}`)
    const wrongSource = live.filter((r) => r.source !== PARITY)
    if (wrongSource.length) fail.push(`${wrongSource.length} update target(s) are not source='${PARITY}': ${wrongSource.map((r) => r.id).join(', ')}`)
    const notDraft = live.filter((r) => r.status !== 'draft')
    if (notDraft.length) fail.push(`${notDraft.length} update target(s) are not draft — refusing to touch a published row: ${notDraft.map((r) => r.id).join(', ')}`)
  }

  console.log(`pre-flight: ${INSERTS.length} inserts · ${UPDATES.length} updates · ${PROTECTED_IDS.size} protected ids · ${fail.length === 0 ? 'ALL ASSERTIONS PASS ✓' : `${fail.length} FAILURES ✗`}`)
  if (fail.length) { fail.forEach((f) => console.error(`  ✗ ${f}`)); console.error('\nABORT: pre-flight failed. Fix the input or the schema — never relax an assertion to make a run pass.'); process.exit(1) }
}

/** The reconcile counts, in one place so before/after are literally the same query. */
async function counts() {
  // supabase-js only exposes filters on the builder returned by .select(), so the head-count
  // select has to come first and the filters chain off it.
  const head = () => db.from('facility_listings').select('*', { count: 'exact', head: true })
  const one = async (q) => { const { count, error } = await q; if (error) { console.error('count failed:', error.message); process.exit(1) } return count }
  return {
    total_listings: await one(head()),
    source_vegas_parity: await one(head().eq('source', PARITY)),
    source_vegas_merged: await one(head().eq('source', BATCH)),
    published_total: await one(head().eq('status', 'published')),
    published_las_vegas: await one(head().eq('metro_area', METRO).eq('status', 'published')),
  }
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------
console.log(`\n=== import-vegas-merged · stage=${STAGE} · ${DRY_RUN ? 'DRY RUN (no writes)' : STAGE === 'inserts' || STAGE === 'updates' ? 'LIVE' : 'READ-ONLY'} ===`)
console.log(`batch: ${BATCH} · parity batch: ${PARITY} · metro: ${METRO}\n`)

if (STAGE === 'baseline') {
  const c = await counts()
  console.log('RECONCILE COUNTS')
  for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log(`\nExpected deltas for a complete apply: total +9 · ${BATCH} 0→9 · ${PARITY} unchanged · published UNCHANGED (0 delta).`)
}

if (STAGE === 'crosscheck') {
  // Re-derives the embedded rows from the manifest artifact so a transcription slip is caught by
  // the machine, not by a reader. No DB access, no writes.
  if (!MANIFEST) { console.error('Pass --manifest=<absolute path to stage-4-import-manifest.json>'); process.exit(1) }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const diffs = []
  const INSERT_COMPARED = ['name', 'slug', 'city', 'state', 'address', 'lat', 'lng', 'court_count', 'access_type', 'fee_type', 'verification_status', 'name_source_url']

  if (m.insert.length !== INSERTS.length) diffs.push(`manifest insert[] has ${m.insert.length}, embedded has ${INSERTS.length}`)
  if (m.update.length !== UPDATES.length) diffs.push(`manifest update[] has ${m.update.length}, embedded has ${UPDATES.length}`)

  const bySlug = new Map(INSERTS.map((v) => [v.slug, v]))
  for (const mi of m.insert) {
    const ours = bySlug.get(mi.slug)
    if (!ours) { diffs.push(`insert slug ${mi.slug} missing from embedded set`); continue }
    for (const k of INSERT_COMPARED) if ((mi[k] ?? null) !== (ours[k] ?? null)) diffs.push(`insert ${mi.slug}.${k}: manifest ${JSON.stringify(mi[k] ?? null)} vs embedded ${JSON.stringify(ours[k] ?? null)}`)
    if (JSON.stringify(mi.provenance ?? {}) !== JSON.stringify(ours.provenance ?? {})) diffs.push(`insert ${mi.slug}.provenance differs from manifest`)
    if (mi.status !== 'draft') diffs.push(`insert ${mi.slug}: manifest status is "${mi.status}", expected draft`)
    if (mi.osm_id !== null) diffs.push(`insert ${mi.slug}: manifest osm_id is not null`)
  }

  const byId = new Map(UPDATES.map((u) => [u.id, u]))
  for (const mu of m.update) {
    const ours = byId.get(mu.id)
    if (!ours) { diffs.push(`update id ${mu.id} (${mu.name}) missing from embedded set`); continue }
    if (mu.name !== ours.name) diffs.push(`update ${mu.id}.name: manifest "${mu.name}" vs embedded "${ours.name}"`)
    if (JSON.stringify(mu.changes) !== JSON.stringify(ours.changes)) diffs.push(`update ${mu.id} (${mu.name}) changes differ:\n      manifest ${JSON.stringify(mu.changes)}\n      embedded ${JSON.stringify(ours.changes)}`)
  }

  const manifestProtected = [...m.hold, ...m.reject, ...m.needs_human].filter((r) => r.id).map((r) => r.id)
  for (const id of manifestProtected) if (!PROTECTED_IDS.has(id)) diffs.push(`manifest protects ${id} but it is absent from PROTECTED_IDS`)
  for (const id of PROTECTED_IDS) if (!manifestProtected.includes(id)) diffs.push(`PROTECTED_IDS carries ${id} which the manifest does not list`)

  console.log(`manifest: ${MANIFEST}`)
  console.log(`  insert ${m.insert.length} · update ${m.update.length} · hold ${m.hold.length} · reject ${m.reject.length} · needs_human ${m.needs_human.length} · additive lead ${m.insert_additive_lead_not_in_76_count.length}`)
  console.log(`\nKNOWN, INTENTIONAL DIVERGENCES (apply brief overrides the manifest — surfaced, not silent):`)
  console.log(`  1. source: manifest writes '${PARITY}' on new rows; the brief mandates the traceable batch tag '${BATCH}'. Applying the brief.`)
  console.log(`  2. insert_additive_lead_not_in_76_count (${m.insert_additive_lead_not_in_76_count.map((r) => r.name).join(', ')}) is EXCLUDED — the brief scopes this pass to exactly 9 INSERTs.`)
  console.log(`  3. metro_area='${METRO}' and address_source='${ADDRESS_SOURCE_VALUE}' are set on writes; the manifest specifies neither. metro_area keeps the rows attached to the metro the whole batch belongs to; address_source is mandatory on any address write under ADR-12.`)
  console.log(`\nFIELD-LEVEL DIFF vs manifest: ${diffs.length === 0 ? 'IDENTICAL ✓' : `${diffs.length} DIVERGENCE(S) ✗`}`)
  diffs.forEach((d) => console.error(`  ✗ ${d}`))
  if (diffs.length) { console.error('\nABORT: embedded rows do not match the manifest.'); process.exit(1) }
}

if (STAGE === 'inserts') {
  await preflight({ expectInsertsAbsent: true })
  const before = await counts()
  console.log(`\nBEFORE: total ${before.total_listings} · ${BATCH} ${before.source_vegas_merged} · ${PARITY} ${before.source_vegas_parity} · published ${before.published_total}`)
  console.log(`\nTO INSERT into facility_listings: ${insertRows.length} (all status='draft', source='${BATCH}', osm_id=null)`)
  insertRows.forEach((r) => console.log(`  + ${r.slug} | ${r.city},${r.state} | ${r.access_type}/${r.fee_type ?? 'null'} | cc=${r.court_count ?? 'null'} | ${r.verification_status}${r.provenance?.coordinate?.precision === 'low' ? '  ⚠ coordinate precision=low → self-blocks the publish gate (intended)' : ''}`))
  console.log(`\n  access_type: ${JSON.stringify(insertRows.reduce((a, r) => (a[r.access_type] = (a[r.access_type] || 0) + 1, a), {}))}`)
  console.log(`  with address ${insertRows.filter((r) => r.address).length}/9 · with name_source_url ${insertRows.filter((r) => r.name_source_url).length}/9 · court_count present ${insertRows.filter((r) => r.court_count != null).length}/9`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }
  const { error } = await db.from('facility_listings').insert(insertRows)
  if (error) { console.error('\nINSERT failed (atomic — nothing inserted):', error.message); process.exit(1) }
  const after = await counts()
  console.log(`\nAFTER:  total ${after.total_listings} (${after.total_listings - before.total_listings >= 0 ? '+' : ''}${after.total_listings - before.total_listings}) · ${BATCH} ${after.source_vegas_merged} · ${PARITY} ${after.source_vegas_parity} · published ${after.published_total} (${after.published_total - before.published_total >= 0 ? '+' : ''}${after.published_total - before.published_total})`)
  if (after.published_total !== before.published_total) { console.error('\n✗ PUBLISHED COUNT MOVED — this must never happen on an insert stage.'); process.exit(1) }
}

if (STAGE === 'updates') {
  await preflight({ expectInsertsAbsent: false })
  const before = await counts()
  console.log(`\nBEFORE: total ${before.total_listings} · ${PARITY} ${before.source_vegas_parity} · published ${before.published_total}`)

  const { data: current, error: rErr } = await db.from('facility_listings')
    .select('id, name, slug, lat, lng, address, address_source, court_count, access_type, fee_type, verification_status, status, source, provenance')
    .in('id', UPDATES.map((u) => u.id))
  if (rErr) { console.error('read failed:', rErr.message); process.exit(1) }
  const currentById = new Map(current.map((r) => [r.id, r]))

  const planned = []
  for (const spec of UPDATES) {
    const cur = currentById.get(spec.id)
    if (!cur) { console.error(`✗ ${spec.name}: id ${spec.id} not found`); process.exit(1) }
    planned.push({ spec, cur, ...buildPatch(spec, cur) })
  }

  const withFieldChanges = planned.filter((p) => Object.keys(p.spec.changes).some((k) => k !== 'verification_status'))
  console.log(`\nTO UPDATE in facility_listings: ${planned.length} rows, matched BY id, guarded on source='${PARITY}' AND status='draft'`)
  console.log(`  ${withFieldChanges.length} carry a factual field change; ${planned.length - withFieldChanges.length} are verification metadata only\n`)
  for (const p of withFieldChanges) {
    const parts = Object.entries(p.diff).filter(([k]) => k !== 'verification_status' && k !== 'address_source')
      .map(([k, d]) => `${k}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`)
    console.log(`  ~ ${p.spec.name}\n      ${parts.join('\n      ')}`)
    if (p.spec.flag) console.log(`      ⚠ FLAG: ${p.spec.flag}`)
    if (p.spec.owner_decision) console.log(`      owner: ${p.spec.owner_decision}`)
  }
  const flaggedNoChange = planned.filter((p) => p.spec.flag && !withFieldChanges.includes(p))
  if (flaggedNoChange.length) {
    console.log(`\n  flags on verification-only rows (recorded in provenance, no field written):`)
    flaggedNoChange.forEach((p) => console.log(`      ⚠ ${p.spec.name}: ${p.spec.flag}`))
  }
  console.log(`\n  verification_status distribution: ${JSON.stringify(planned.reduce((a, p) => (a[p.spec.changes.verification_status] = (a[p.spec.changes.verification_status] || 0) + 1, a), {}))}`)

  if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0) }

  let applied = 0
  for (const p of planned) {
    // Guarded on source AND status: if anything moved this row since preflight, the update is a
    // provable no-op rather than a surprise write. `returning` proves exactly one row moved.
    const { data, error } = await db.from('facility_listings')
      .update(p.patch).eq('id', p.spec.id).eq('source', PARITY).eq('status', 'draft').select('id')
    if (error) { console.error(`  ✗ ${p.spec.name}: ${error.message}`); process.exit(1) }
    if (data.length !== 1) { console.error(`  ✗ ${p.spec.name}: expected 1 row updated, got ${data.length} — guard tripped, aborting`); process.exit(1) }
    applied++
  }
  const after = await counts()
  console.log(`\nupdated ${applied}/${planned.length} rows`)
  console.log(`AFTER:  total ${after.total_listings} (${after.total_listings - before.total_listings >= 0 ? '+' : ''}${after.total_listings - before.total_listings}) · ${PARITY} ${after.source_vegas_parity} · published ${after.published_total} (${after.published_total - before.published_total >= 0 ? '+' : ''}${after.published_total - before.published_total})`)
  if (after.total_listings !== before.total_listings) { console.error('\n✗ ROW COUNT MOVED on an UPDATE stage — an update became an insert.'); process.exit(1) }
  if (after.published_total !== before.published_total) { console.error('\n✗ PUBLISHED COUNT MOVED — this must never happen.'); process.exit(1) }
  if (applied !== planned.length) process.exit(1)
}

if (STAGE === 'verify') {
  const { data: newRows } = await db.from('facility_listings')
    .select('id, name, slug, status, source, metro_area, city, state, lat, lng, address, address_source, court_count, access_type, fee_type, verification_status, verified_by, enrichment_version, osm_id, name_source_url, provenance')
    .eq('source', BATCH)
  const { data: updRows } = await db.from('facility_listings')
    .select('id, name, slug, status, source, court_count, access_type, fee_type, lat, lng, address, address_source, verification_status, verified_by, provenance')
    .in('id', UPDATES.map((u) => u.id))
  const { data: protRows } = await db.from('facility_listings')
    .select('id, name, status, source, verification_status, verified_by, provenance').in('id', [...PROTECTED_IDS])
  const c = await counts()

  const updById = new Map((updRows || []).map((r) => [r.id, r]))
  const specById = new Map(UPDATES.map((u) => [u.id, u]))
  const fieldMatches = (row, spec) => Object.entries(spec.changes).every(([k, v]) => {
    const got = row[k] ?? null, want = v ?? null
    return typeof got === 'number' && typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want
  })

  const checks = [
    [`facility_listings rows for source='${BATCH}' = 9`, (newRows || []).length === 9, (newRows || []).length],
    ['every new row is status=draft', (newRows || []).every((r) => r.status === 'draft'), 'ok'],
    ['every new row has osm_id = null', (newRows || []).every((r) => r.osm_id == null), 'ok'],
    ['every new row has verified_by = null (publish-gate safety)', (newRows || []).every((r) => r.verified_by == null), 'ok'],
    ['every new row has enrichment_version = null', (newRows || []).every((r) => r.enrichment_version == null), 'ok'],
    [`every new row metro_area = '${METRO}'`, (newRows || []).every((r) => r.metro_area === METRO), 'ok'],
    ['every new row carries a coordinate inside the Clark County envelope', (newRows || []).every((r) => r.lat >= ENVELOPE.latMin && r.lat <= ENVELOPE.latMax && r.lng >= ENVELOPE.lngMin && r.lng <= ENVELOPE.lngMax), 'ok'],
    ['every new row with an address carries address_source (ADR-12)', (newRows || []).filter((r) => r.address).every((r) => ADDRESS_SOURCE.has(r.address_source || '')), 'ok'],
    ['Whitney Mesa retains coordinate.precision=low (intended self-block)', (newRows || []).find((r) => r.slug === 'whitney-mesa-pickleball-courts-henderson-nv')?.provenance?.coordinate?.precision === 'low', 'ok'],
    ['no new row carries an aggregator name_source_url (ADR-14)', (newRows || []).every((r) => !AGGREGATOR_HOST.test(r.name_source_url || '')), 'ok'],
    ['the additive lead (Silver Mesa) was NOT inserted', !(newRows || []).some((r) => /silver-mesa/.test(r.slug)), 'ok'],
    [`all 51 update targets still exist and are source='${PARITY}'`, (updRows || []).length === 51 && (updRows || []).every((r) => r.source === PARITY), (updRows || []).length],
    ['all 51 update targets are still status=draft', (updRows || []).every((r) => r.status === 'draft'), 'ok'],
    ['all 51 update targets have verified_by = null', (updRows || []).every((r) => r.verified_by == null), 'ok'],
    ['every manifest field change landed exactly', [...specById.values()].every((s) => updById.has(s.id) && fieldMatches(updById.get(s.id), s)), [...specById.values()].filter((s) => !updById.has(s.id) || !fieldMatches(updById.get(s.id), s)).map((s) => s.name)],
    ['every updated row records its prior values in provenance (revertible)', (updRows || []).every((r) => r.provenance?.vegas_merged_2026_07_31?.changes_applied), 'ok'],
    ['every updated row preserved its pre-existing provenance node', (updRows || []).every((r) => r.provenance?.origin === 'locations'), (updRows || []).filter((r) => r.provenance?.origin !== 'locations').map((r) => r.name)],
    ['every address-corrected row carries address_source (ADR-12)', (updRows || []).filter((r) => specById.get(r.id) && 'address' in specById.get(r.id).changes).every((r) => ADDRESS_SOURCE.has(r.address_source || '')), 'ok'],
    [`SCOPE FENCE: all ${PROTECTED_IDS.size} hold/reject/needs-human rows untouched`, (protRows || []).length === PROTECTED_IDS.size && (protRows || []).every((r) => r.status === 'draft' && r.verification_status == null && r.verified_by == null && !r.provenance?.vegas_merged_2026_07_31), (protRows || []).filter((r) => r.verification_status != null || r.provenance?.vegas_merged_2026_07_31).map((r) => r.name)],
    ['SCOPE FENCE: Ward 6 row still present (retire/merge is a later decision, nothing deleted)', (protRows || []).some((r) => r.id === 'e3ef1884-78ff-42d0-a2c0-2e69a9a81f51'), 'ok'],
    ['published count in the Las Vegas metro is still 0', c.published_las_vegas === 0, c.published_las_vegas],
    [`facility_listings source='${PARITY}' still 64`, c.source_vegas_parity === 64, c.source_vegas_parity],
  ]

  console.log('RECONCILE COUNTS')
  for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log(`\nnew-row verification_status: ${JSON.stringify((newRows || []).reduce((a, r) => (a[r.verification_status] = (a[r.verification_status] || 0) + 1, a), {}))}`)
  console.log(`updated-row verification_status: ${JSON.stringify((updRows || []).reduce((a, r) => (a[String(r.verification_status)] = (a[String(r.verification_status)] || 0) + 1, a), {}))}\n`)

  let bad = 0
  for (const [label, ok, detail] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) bad++ }
  console.log(`\n${bad === 0 ? `ALL ${checks.length} CHECKS PASS ✓` : `${bad}/${checks.length} CHECKS FAILED ✗`}`)
  if (bad) process.exit(1)
}

console.log('\nDONE.')
