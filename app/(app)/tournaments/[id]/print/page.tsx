export const dynamic = 'force-dynamic'

import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import PrintBrackets from './PrintBrackets'

// Organizer "Export" target: a print-ready page rendering every division's
// bracket. Reads with the admin client (same as the public live scoreboard —
// bracket data is non-PII) and hands off to a client component that lays the
// brackets out for print and opens the browser print dialog.
export default async function PrintBracketsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const [{ data: tournament }, { data: divisionsRaw }, { data: matchesRaw }, { data: regsRaw }] =
    await Promise.all([
      db.from('tournaments').select('id, name, start_date').eq('id', params.id).single(),
      db
        .from('tournament_divisions')
        .select('id, name, format, bracket_type, format_settings_json, status')
        .eq('tournament_id', params.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
      db
        .from('tournament_matches')
        .select(`
          id, division_id, round_number, match_number, match_stage, pool_number,
          court_number, scheduled_time, team_1_registration_id, team_2_registration_id,
          team_1_score, team_2_score, winner_registration_id, status
        `)
        .eq('tournament_id', params.id)
        .eq('is_draft', false)
        .order('match_number', { ascending: true }),
      db
        .from('tournament_registrations')
        .select('id, division_id, user_id, partner_user_id, team_name, status, seed')
        .eq('tournament_id', params.id)
        .neq('status', 'cancelled'),
    ])

  if (!tournament) notFound()

  // Resolve player names separately to sidestep ambiguous FK joins.
  const userIds = Array.from(
    new Set((regsRaw ?? []).flatMap((r: any) => [r.user_id, r.partner_user_id]).filter(Boolean)),
  )
  const { data: profilesRaw } = userIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', userIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map((profilesRaw ?? []).map((p: any) => [p.id, p.name as string]))

  const matchesByDivision = new Map<string, any[]>()
  for (const m of matchesRaw ?? []) {
    if (!matchesByDivision.has(m.division_id)) matchesByDivision.set(m.division_id, [])
    matchesByDivision.get(m.division_id)!.push(m)
  }

  const regsByDivision = new Map<string, any[]>()
  for (const r of regsRaw ?? []) {
    const reg = {
      id: r.id,
      user_id: r.user_id,
      team_name: r.team_name,
      status: r.status,
      seed: r.seed ?? null,
      user_profile: nameById.get(r.user_id) ? { name: nameById.get(r.user_id)! } : null,
      partner_user_id: r.partner_user_id,
      partner_profile:
        r.partner_user_id && nameById.get(r.partner_user_id)
          ? { name: nameById.get(r.partner_user_id)! }
          : null,
    }
    if (!regsByDivision.has(r.division_id)) regsByDivision.set(r.division_id, [])
    regsByDivision.get(r.division_id)!.push(reg)
  }

  // Only divisions that actually have a generated bracket are worth printing.
  const divisions = (divisionsRaw ?? [])
    .map((d: any) => ({
      id: d.id,
      name: d.name,
      isDoubles: isDoublesFormat(d.format),
      isBracket:
        d.bracket_type === 'single_elimination' || d.bracket_type === 'double_elimination',
      pointsToWin: (d.format_settings_json as any)?.games_to ?? 11,
      matches: matchesByDivision.get(d.id) ?? [],
      regs: regsByDivision.get(d.id) ?? [],
    }))
    .filter((d) => d.matches.length > 0)

  return (
    <PrintBrackets
      tournamentId={params.id}
      tournamentName={tournament.name}
      startDate={tournament.start_date}
      divisions={divisions}
    />
  )
}
