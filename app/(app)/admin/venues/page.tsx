import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/auth/admin'
import { autoVenueCode } from '@/lib/locations/venueCode'
import VenueCodesList, { type VenueRow } from './VenueCodesList'

export const dynamic = 'force-dynamic'

export default async function AdminVenueCodesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user.email)) notFound()

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await db
    .from('locations')
    .select('id, name, city, state, short_code')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const venues: VenueRow[] = (data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    place: [l.city, l.state].filter(Boolean).join(', '),
    shortCode: l.short_code ?? '',
    autoCode: autoVenueCode(l.name),
  }))

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Venue map codes</h1>
        <Link href="/admin/locations" className="text-xs text-brand-active hover:underline whitespace-nowrap">Pending venues →</Link>
      </div>
      <p className="text-sm text-brand-muted">
        The short code shown on each venue&apos;s map pin. Leave blank to use the auto code
        (shown as the placeholder). Up to 12 characters.
      </p>
      <VenueCodesList initial={venues} />
    </main>
  )
}
