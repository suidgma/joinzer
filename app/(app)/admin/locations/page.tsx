import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/auth/admin'
import { findDuplicateCandidates, type VenueLike } from '@/lib/locations/duplicates'
import PendingLocationsList, { type PendingLocation } from './PendingLocationsList'

export const dynamic = 'force-dynamic'

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
      .select('id, name, address, city, state, zip_code, country, lat, lng, creator:profiles!created_by(name)')
      .eq('status', 'pending')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    db
      .from('locations')
      .select('id, name, address, city, state, zip_code, lat, lng, status')
      .eq('is_active', true),
  ])

  const pool: VenueLike[] = (poolRows ?? []) as any[]

  const pending: PendingLocation[] = (pendingRows ?? []).map((l: any) => {
    const target: VenueLike = {
      id: l.id, name: l.name, address: l.address, city: l.city,
      state: l.state, zip_code: l.zip_code, lat: l.lat, lng: l.lng, status: 'pending',
    }
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
        using it still work).
      </p>
      <PendingLocationsList initial={pending} />
    </main>
  )
}
