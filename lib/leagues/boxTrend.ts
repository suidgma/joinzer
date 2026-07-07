// Box position trend: for each completed cycle, each player's OVERALL rank across
// all boxes (box 1 top → box N bottom, then by within-box standings, flattened to
// 1..N). Powers the "position by cycle" grid on box standings — the box analogue of
// round-robin's per-week columns. Service-role reads (box tables are RLS deny-all).

import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'
import type { ladderAdmin } from '@/lib/leagues/ladderServer'

type Admin = ReturnType<typeof ladderAdmin>
const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export type BoxTrendRow = { regId: string; name: string; positions: (number | null)[]; current: number }

export async function getBoxPositionTrend(admin: Admin, leagueId: string, format: string | null) {
  const doubles = isDoublesFormat(format)

  const { data: regsRaw } = await admin
    .from('league_registrations')
    .select('id, partner_registration_id, profile:profiles!user_id(name)')
    .eq('league_id', leagueId)
    .neq('status', 'cancelled')
  const byRegId = new Map<string, any>((regsRaw ?? []).map((r: any) => [r.id, r]))
  const nameOf = (regId: string): string => {
    const r = byRegId.get(regId)
    if (!r) return 'Player'
    const a = firstName(r.profile?.name)
    if (!doubles) return a || 'Player'
    const partner = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : a || 'Team'
  }

  const { data: cyclesRaw } = await admin
    .from('league_periods').select('id, period_number, status')
    .eq('league_id', leagueId).eq('period_kind', 'cycle').eq('status', 'completed')
    .order('period_number', { ascending: true })
  const cycles = (cyclesRaw ?? []) as any[]
  if (cycles.length === 0) return { rows: [] as BoxTrendRow[], cycleNumbers: [] as number[] }

  const cycleIds = cycles.map((c) => c.id)
  const { data: boxes } = await admin.from('league_boxes').select('id, period_id, tier_rank').in('period_id', cycleIds)
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  const { data: members } = boxIds.length
    ? await admin.from('league_box_members').select('box_id, registration_id').in('box_id', boxIds)
    : { data: [] as any[] }
  const { data: fixtures } = cycleIds.length
    ? await admin.from('league_fixtures')
        .select('id, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, period_id')
        .in('period_id', cycleIds)
    : { data: [] as any[] }
  const allFixtures = (fixtures ?? []) as any[]

  const boxesByCycle = new Map<string, any[]>()
  for (const b of boxes ?? []) {
    if (!boxesByCycle.has(b.period_id)) boxesByCycle.set(b.period_id, [])
    boxesByCycle.get(b.period_id)!.push(b)
  }
  const membersByBox = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!membersByBox.has(m.box_id)) membersByBox.set(m.box_id, [])
    membersByBox.get(m.box_id)!.push(m.registration_id)
  }

  // Per-cycle overall position: flatten boxes (tier order) → within-box standings.
  const posByCycle = new Map<string, Map<string, number>>()
  for (const cycle of cycles) {
    const cboxes = (boxesByCycle.get(cycle.id) ?? []).slice().sort((a, b) => a.tier_rank - b.tier_rank)
    const posMap = new Map<string, number>()
    let pos = 0
    for (const b of cboxes) {
      const memberIds = membersByBox.get(b.id) ?? []
      const regsForBox = memberIds.map((id) => ({ id, status: 'registered', partner_registration_id: byRegId.get(id)?.partner_registration_id ?? null }))
      const rows = computeFixtureStandings(allFixtures as any, regsForBox as any, { boxId: b.id }, nameOf)
      for (const row of rows) {
        pos++
        posMap.set(row.regId, pos)
      }
    }
    posByCycle.set(cycle.id, posMap)
  }

  const allRegs = new Set<string>()
  for (const posMap of posByCycle.values()) for (const rid of posMap.keys()) allRegs.add(rid)

  const rows: BoxTrendRow[] = [...allRegs].map((regId) => {
    const positions = cycles.map((c) => posByCycle.get(c.id)?.get(regId) ?? null)
    const current = [...positions].reverse().find((p) => p != null) ?? Number.MAX_SAFE_INTEGER
    return { regId, name: nameOf(regId), positions, current }
  }).sort((a, b) => a.current - b.current)

  return { rows, cycleNumbers: cycles.map((c) => c.period_number as number) }
}
