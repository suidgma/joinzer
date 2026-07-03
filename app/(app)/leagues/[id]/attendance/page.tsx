import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import BoxAttendanceManager, { type BoxAttendee } from './BoxAttendanceManager'

export const dynamic = 'force-dynamic'

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export default async function BoxAttendancePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, format, format_kind')
    .eq('id', params.id)
    .single()
  if (!league) notFound()

  // Attendance run mode is box-only for now (round-robin uses the session live page).
  if ((league as any).format_kind !== 'box') redirect(`/leagues/${params.id}`)

  // Organizer or co-admin only.
  const { data: myReg } = await supabase
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  const isAdmin = league.created_by === user.id || myReg?.is_co_admin === true
  if (!isAdmin) redirect(`/leagues/${params.id}`)

  const doubles = isDoublesFormat((league as any).format)

  // Registrations (for entrant names) — non-cancelled.
  const { data: regs } = await supabase
    .from('league_registrations')
    .select('id, user_id, partner_registration_id, status, payment_status, profile:profiles!user_id(id, name)')
    .eq('league_id', params.id)
    .neq('status', 'cancelled')
  const byRegId = new Map((regs ?? []).map((r: any) => [r.id, r]))
  const nameOf = (regId: string | null): string => {
    if (!regId) return 'Player'
    const reg: any = byRegId.get(regId)
    if (!reg) return 'Player'
    const a = firstName(reg.profile?.name)
    if (!doubles) return a || 'Player'
    const partner: any = reg.partner_registration_id ? byRegId.get(reg.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : (a || 'Team')
  }

  // Box structure + attendance — box tables are RLS deny-all, so read via service role.
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: cycle } = await admin
    .from('league_periods')
    .select('id, period_number')
    .eq('league_id', params.id)
    .eq('period_kind', 'cycle')
    .eq('status', 'active')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    { label: 'Roster', href: `/leagues/${params.id}/roster` },
    { label: 'Edit', href: `/leagues/${params.id}/edit` },
  ]

  const header = (
    <div className="flex items-center gap-3">
      <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      <span className="text-brand-muted text-sm">/</span>
      <span className="text-sm font-medium text-brand-dark">Attendance</span>
    </div>
  )

  if (!cycle) {
    return (
      <DesktopShell header={header} sidebar={<ManageNav items={navItems} />}>
        <ManageNav items={navItems} mobileOnly />
        <div className="max-w-2xl bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-2xl">🏓</p>
          <p className="text-sm font-medium text-brand-dark">No active cycle</p>
          <p className="text-xs text-brand-muted">Seed boxes on the Roster screen first, then take attendance here.</p>
        </div>
      </DesktopShell>
    )
  }

  const { data: boxes } = await admin
    .from('league_boxes')
    .select('id, tier_rank, name')
    .eq('period_id', cycle.id)
    .order('tier_rank', { ascending: true })
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  const { data: members } = boxIds.length
    ? await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', boxIds)
    : { data: [] as any[] }
  const { data: attendance } = await admin
    .from('league_attendance')
    .select('id, registration_id, user_id, guest_name, status, subbing_for_registration_id')
    .eq('period_id', cycle.id)

  // registration_id → attendance row (for box members)
  const attByReg = new Map<string, any>()
  for (const a of attendance ?? []) if (a.registration_id) attByReg.set(a.registration_id, a)

  const membersByBox = new Map<string, any[]>()
  for (const m of members ?? []) {
    if (!membersByBox.has(m.box_id)) membersByBox.set(m.box_id, [])
    membersByBox.get(m.box_id)!.push(m)
  }
  const boxMemberRegIds = new Set((members ?? []).map((m: any) => m.registration_id))

  // Roster attendees — box members, grouped by box (box name is the grid group).
  const attendees: BoxAttendee[] = []
  for (const box of boxes ?? []) {
    const boxName = (box as any).name ?? `Box ${(box as any).tier_rank}`
    const boxMembers = (membersByBox.get(box.id) ?? []).slice().sort((a, b) => (a.seed_in_box ?? 0) - (b.seed_in_box ?? 0))
    for (const m of boxMembers) {
      const att = attByReg.get(m.registration_id)
      attendees.push({
        rowId: m.registration_id,
        attendanceId: att?.id ?? null,
        registrationId: m.registration_id,
        kind: 'roster',
        displayName: nameOf(m.registration_id),
        status: att?.status ?? 'not_present',
        teamName: boxName,
        subbingForRegistrationId: null,
      })
    }
  }

  // Sub / guest attendees — attendance rows that aren't box members.
  for (const a of attendance ?? []) {
    const isBoxMember = a.registration_id && boxMemberRegIds.has(a.registration_id)
    if (isBoxMember) continue
    const isGuest = !a.registration_id && !!a.guest_name
    attendees.push({
      rowId: a.id,
      attendanceId: a.id,
      registrationId: a.registration_id ?? null,
      kind: isGuest ? 'guest' : 'sub',
      displayName: a.registration_id ? nameOf(a.registration_id) : (a.guest_name ?? 'Guest'),
      status: a.status,
      subbingForRegistrationId: a.subbing_for_registration_id ?? null,
    })
  }

  // Available subs for the assign/add modals: registered players not in a box and
  // not already an attendance row this cycle.
  const attendeeUserIds = new Set((attendance ?? []).map((a: any) => a.user_id).filter(Boolean))
  const availableSubs = (regs ?? [])
    .filter((r: any) => r.status === 'registered')
    .filter((r: any) => !boxMemberRegIds.has(r.id) && !attendeeUserIds.has(r.user_id))
    .map((r: any) => ({ userId: r.user_id as string, name: r.profile?.name ?? 'Player' }))
    .filter((s: any) => s.userId)
    .sort((a: any, b: any) => a.name.localeCompare(b.name))

  return (
    <DesktopShell header={header} sidebar={<ManageNav items={navItems} />}>
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-4 pb-8">
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">Attendance</h1>
          <p className="text-xs text-brand-muted">Cycle {(cycle as any).period_number} — mark who&apos;s here and assign subs.</p>
        </div>
        <BoxAttendanceManager
          leagueId={params.id}
          periodId={cycle.id}
          initialAttendees={attendees}
          availableSubs={availableSubs}
        />
      </div>
    </DesktopShell>
  )
}
