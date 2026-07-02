import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import BoxManager, { type BoxVM } from './BoxManager'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export default async function LeagueBoxesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = admin()
  const { data: league } = await db
    .from('leagues')
    .select('id, name, created_by, format, format_kind')
    .eq('id', id)
    .single()
  if (!league) notFound()
  if (league.format_kind !== 'box') redirect(`/leagues/${id}`)
  if (league.created_by !== user.id) {
    const { data: myReg } = await db
      .from('league_registrations').select('is_co_admin').eq('league_id', id).eq('user_id', user.id).maybeSingle()
    if (myReg?.is_co_admin !== true) redirect(`/leagues/${id}`)
  }

  const doubles = isDoublesFormat((league as any).format)

  const { data: cycle } = await db
    .from('league_periods')
    .select('id, period_number')
    .eq('league_id', id).eq('period_kind', 'cycle').eq('status', 'active')
    .order('period_number', { ascending: false }).limit(1).maybeSingle()

  let boxes: BoxVM[] = []
  if (cycle) {
    const { data: boxRows } = await db
      .from('league_boxes').select('id, tier_rank, name').eq('period_id', cycle.id).order('tier_rank', { ascending: true })
    const boxIds = (boxRows ?? []).map((b: any) => b.id)

    const { data: memberRows } = boxIds.length
      ? await db.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', boxIds).order('seed_in_box', { ascending: true })
      : { data: [] as any[] }
    const members = (memberRows ?? []) as any[]

    const regIds = members.map(m => m.registration_id)
    const { data: regRows } = regIds.length
      ? await db.from('league_registrations')
          .select('id, partner_registration_id, profile:profiles!user_id(name, dupr_rating, estimated_rating), partner:profiles!partner_user_id(name, dupr_rating, estimated_rating)')
          .in('id', regIds)
      : { data: [] as any[] }
    const regById = new Map((regRows ?? []).map((r: any) => [r.id, r]))

    const nameOf = (regId: string): string => {
      const r: any = regById.get(regId)
      if (!r) return 'Player'
      const a = firstName(r.profile?.name)
      if (!doubles) return a || 'Player'
      const b = firstName(r.partner?.name)
      return b ? `${a}/${b}` : (a || 'Team')
    }
    const ratingOf = (regId: string): number | null => {
      const r: any = regById.get(regId)
      const r1 = r?.profile?.dupr_rating ?? r?.profile?.estimated_rating ?? null
      if (!doubles) return r1
      const r2 = r?.partner?.dupr_rating ?? r?.partner?.estimated_rating ?? null
      if (r1 != null && r2 != null) return (r1 + r2) / 2
      return r1 ?? r2
    }

    const byBox = new Map<string, any[]>()
    for (const m of members) {
      if (!byBox.has(m.box_id)) byBox.set(m.box_id, [])
      byBox.get(m.box_id)!.push(m)
    }
    boxes = (boxRows ?? []).map((b: any) => ({
      id: b.id,
      tierRank: b.tier_rank,
      name: b.name ?? `Box ${b.tier_rank}`,
      members: (byBox.get(b.id) ?? []).map(m => ({
        registrationId: m.registration_id,
        name: nameOf(m.registration_id),
        rating: ratingOf(m.registration_id),
      })),
    }))
  }

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${id}` },
    { label: 'Standings', href: `/leagues/${id}/standings` },
    { label: 'Roster', href: `/leagues/${id}/roster` },
    { label: 'Boxes', href: `/leagues/${id}/boxes` },
    { label: 'Edit', href: `/leagues/${id}/edit` },
  ]

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Boxes</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <BoxManager leagueId={id} cycleActive={!!cycle} boxes={boxes} />
    </DesktopShell>
  )
}
