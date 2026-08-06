import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/auth/admin'
import { findDuplicateCandidates, type VenueLike } from '@/lib/locations/duplicates'
import { summarizeVenueDetail, type SubmittedVenueDetail } from '@/lib/locations/venueDetailSummary'
import PendingLocationsList, { type PendingLocation } from './PendingLocationsList'

export const dynamic = 'force-dynamic'

/** PostgREST's server-side row cap. A read that hits it comes back short with NO error, so a
 *  truncated duplicate-check pool is indistinguishable from a complete one unless the count is
 *  requested alongside it. The directory read path shipped this bug for real once — two whole
 *  metros vanished — so the pool read below asks for the count and reports the shortfall rather
 *  than quietly checking against a partial directory. */
const POOL_CAP = 1000

/** Columns needed for duplicate scoring. Deliberately narrow: `provenance`, `name_source_url` and
 *  the rest of the evidence trail have no business on this page (ADR-14). */
const LISTING_DETAIL_COLS =
  'id, court_count, court_configuration, indoor, surface, lighting, line_type, net_setup, ' +
  'nets_provided_count, access_type, fee_type, reservation_policy, reservation_url, website, ' +
  'phone, restrooms, water_fountain, accessibility, parking, public_notes'

export default async function AdminPendingLocationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user.email)) notFound()

  // Service role: read pending venues + the creator's name (admin-gated above),
  // plus the full active directory as the pool to check each pending venue
  // against for likely duplicates.
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [{ data: pendingRows }, { data: poolRows }] = await Promise.all([
    db
      .from('locations')
      .select('id, name, address, city, state, zip_code, country, lat, lng, facility_listing_id, creator:profiles!created_by(name)')
      .eq('status', 'pending')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    db
      .from('locations')
      .select('id, name, address, city, state, zip_code, lat, lng, status')
      .eq('is_active', true),
  ])

  const pending = (pendingRows ?? []) as any[]

  // The directory pool. A user-submitted venue can duplicate a row that only exists in
  // facility_listings (2,300+ rows) and never in the 64-row operational table, which the original
  // locations-only check could not see at all. Scoped to the states actually represented among the
  // pending rows so this stays a small read rather than a full-table scan.
  const states = [...new Set(pending.map((l) => l.state).filter(Boolean))] as string[]
  let listingPool: VenueLike[] = []
  let poolTruncated = false
  if (states.length > 0) {
    const { data, count } = await db
      .from('facility_listings')
      .select('id, name, address, city, state, zip, lat, lng, status', { count: 'exact' })
      .in('state', states)
      .range(0, POOL_CAP - 1)
    listingPool = (data ?? []).map((f: any) => ({
      id: `facility:${f.id}`, // namespaced so it can never collide with a locations id
      name: f.name,
      address: f.address,
      city: f.city,
      state: f.state,
      zip_code: f.zip, // facility_listings calls it `zip`; VenueLike expects `zip_code`
      lat: f.lat,
      lng: f.lng,
      status: f.status === 'published' ? 'in directory' : 'directory draft',
    }))
    poolTruncated = typeof count === 'number' && count > (data?.length ?? 0)
  }

  // Detail for the bridged listing rows, so the queue shows what the submitter actually told us.
  const listingIds = pending.map((l) => l.facility_listing_id).filter(Boolean) as string[]
  const detailById = new Map<string, SubmittedVenueDetail>()
  if (listingIds.length > 0) {
    const { data } = await db.from('facility_listings').select(LISTING_DETAIL_COLS).in('id', listingIds)
    for (const row of (data ?? []) as any[]) detailById.set(row.id, row as SubmittedVenueDetail)
  }

  const pool: VenueLike[] = [...((poolRows ?? []) as any[]), ...listingPool]

  const pendingLocations: PendingLocation[] = pending.map((l: any) => {
    const target: VenueLike = {
      id: l.id, name: l.name, address: l.address, city: l.city,
      state: l.state, zip_code: l.zip_code, lat: l.lat, lng: l.lng, status: 'pending',
    }
    const { entries, notes } = summarizeVenueDetail(
      l.facility_listing_id ? detailById.get(l.facility_listing_id) : null
    )
    return {
      id: l.id,
      name: l.name,
      address: l.address,
      city: l.city,
      state: l.state,
      zip_code: l.zip_code,
      country: l.country,
      creatorName: l.creator?.name ?? null,
      candidates: findDuplicateCandidates(target, pool),
      detail: entries,
      notes,
      // A pending row with no bridge means the directory-side write failed at submission time and
      // the operational row was saved anyway. Surfaced rather than hidden: it is the only place
      // that failure is visible.
      hasListing: !!l.facility_listing_id,
    }
  })

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Pending venues</h1>
        <Link href="/admin/venues" className="text-xs text-brand-active hover:underline whitespace-nowrap">Venue map codes →</Link>
      </div>
      <p className="text-sm text-brand-muted">
        Venues organizers added because they weren&apos;t in the directory. They only show in
        their creator&apos;s own picker until you <strong>approve</strong> them for everyone.
        <strong> Reject</strong> hides a junk or duplicate venue from all pickers (events already
        using it still work). Approving does <strong>not</strong> publish anything to
        <Link href="/courts" className="text-brand-active hover:underline"> /courts</Link> — the
        directory record stays a draft until it is released separately.
      </p>
      {poolTruncated && (
        <p className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-lg p-2">
          Duplicate check ran against the first {POOL_CAP} directory rows in these states, not all
          of them — treat a clean result as inconclusive.
        </p>
      )}
      <PendingLocationsList initial={pendingLocations} />
    </main>
  )
}
