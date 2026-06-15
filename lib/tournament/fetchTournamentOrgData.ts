import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import type { OrgMatch, OrgRegistration, OrgDivision } from '@/app/(app)/tournaments/[id]/organizer/_components/types'

export type TournamentOrgData = {
  user: { id: string } | null
  tournament: { id: string; name: string; status: string; organizer_id: string } | null
  orgRegs: OrgRegistration[]
  orgDivisions: OrgDivision[]
  orgMatches: OrgMatch[]
  canEdit: boolean
  isOrganizer: boolean
}

export async function fetchTournamentOrgData(tournamentId: string): Promise<TournamentOrgData> {
  const supabase = createClient()
  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: tournament },
    { data: divisionsRaw },
    { data: regsRaw },
    { data: matchesData },
    { data: staffRow },
  ] = await Promise.all([
    db.from('tournaments').select('id, name, status, organizer_id').eq('id', tournamentId).single(),
    db.from('tournament_divisions').select('id, name, bracket_type').eq('tournament_id', tournamentId).order('created_at', { ascending: true }),
    db.from('tournament_registrations').select('id, division_id, user_id, partner_user_id, partner_registration_id, team_name, status, checked_in').eq('tournament_id', tournamentId),
    db.from('tournament_matches').select(
      'id, division_id, round_number, match_number, match_stage, pool_number, ' +
      'court_number, scheduled_time, team_1_registration_id, team_2_registration_id, ' +
      'team_1_score, team_2_score, winner_registration_id, status'
    ).eq('tournament_id', tournamentId).order('match_number', { ascending: true }),
    user
      ? db.from('tournament_staff').select('role').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const allUserIds = Array.from(new Set(
    [
      ...(regsRaw ?? []).map((r: any) => r.user_id),
      ...(regsRaw ?? []).map((r: any) => r.partner_user_id),
    ].filter(Boolean)
  )) as string[]

  const { data: profilesRaw } = allUserIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', allUserIds)
    : { data: [] }

  const profileNames: Record<string, string> = {}
  for (const p of profilesRaw ?? []) profileNames[(p as any).id] = (p as any).name

  const isOrganizer = !!user && user.id === (tournament as any)?.organizer_id
  const isCoOrganizer = (staffRow as any)?.role === 'co_organizer'
  const canEdit = isOrganizer || isCoOrganizer

  const orgRegs: OrgRegistration[] = (regsRaw ?? []).map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    division_id: r.division_id,
    team_name: r.team_name ?? null,
    status: r.status,
    player_name: profileNames[r.user_id] ?? null,
    partner_user_id: r.partner_user_id ?? null,
    partner_registration_id: r.partner_registration_id ?? null,
    checked_in: r.checked_in ?? false,
  }))

  const orgDivisions: OrgDivision[] = (divisionsRaw ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    bracket_type: d.bracket_type,
  }))

  const orgMatches: OrgMatch[] = (matchesData ?? []) as unknown as OrgMatch[]

  return {
    user: user ? { id: user.id } : null,
    tournament: tournament as any,
    orgRegs,
    orgDivisions,
    orgMatches,
    canEdit,
    isOrganizer,
  }
}
