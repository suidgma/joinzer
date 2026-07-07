import { ladderAdmin, readLadderState } from '@/lib/leagues/ladderServer'

// Player-facing ladder card on the league overview: your current rank and, when a
// session is live, tonight's court + opponent. Self-contained async server
// component; renders nothing if the viewer isn't a ranked entrant.
export default async function LadderPlayerCard({
  leagueId,
  userId,
  format,
  settings,
}: {
  leagueId: string
  userId: string
  format: string | null
  settings: Record<string, unknown> | null
}) {
  const admin = ladderAdmin()
  const { orderedIds, byRegId, nameOf } = await readLadderState(admin, leagueId, format, settings)
  if (orderedIds.length === 0) return null

  // Which entrant is this viewer (their own reg, or the team whose partner they are)?
  let myEntrant: string | undefined
  for (const id of orderedIds) {
    const reg = byRegId.get(id)
    if (reg?.user_id === userId) { myEntrant = id; break }
    if (reg?.partner_registration_id && byRegId.get(reg.partner_registration_id)?.user_id === userId) { myEntrant = id; break }
  }
  if (!myEntrant) return null
  const rank = orderedIds.indexOf(myEntrant) + 1

  // Tonight's court + opponent, if a session is live and rounds are generated.
  let court: number | null = null
  let opponent: string | null = null
  const { data: period } = await admin
    .from('league_periods')
    .select('id')
    .eq('league_id', leagueId)
    .eq('period_kind', 'ladder_session')
    .eq('status', 'active')
    .maybeSingle()
  if (period) {
    const { data: fxRaw } = await admin
      .from('league_fixtures')
      .select('round_number, court_number, match_stage, team_1_registration_id, team_2_registration_id')
      .eq('period_id', period.id)
      .eq('match_stage', 'ladder_round')
    const fx = (fxRaw ?? []) as any[]
    const mine = fx.filter((f) => f.team_1_registration_id === myEntrant || f.team_2_registration_id === myEntrant)
    if (mine.length) {
      const latest = mine.reduce((a, b) => ((b.round_number ?? 0) > (a.round_number ?? 0) ? b : a))
      court = latest.court_number ?? null
      const oppId = latest.team_1_registration_id === myEntrant ? latest.team_2_registration_id : latest.team_1_registration_id
      opponent = oppId ? nameOf(oppId) : null
    }
  }

  return (
    <div className="bg-brand-soft border border-brand-border rounded-2xl p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs text-brand-muted">Your ladder rank</p>
        <p className="text-2xl font-bold text-brand-dark">#{rank}<span className="text-sm font-normal text-brand-muted"> of {orderedIds.length}</span></p>
      </div>
      {court != null ? (
        <div className="text-right">
          <p className="text-xs text-brand-muted">Now on</p>
          <p className="text-sm font-semibold text-brand-dark">Court {court}</p>
          {opponent && <p className="text-xs text-brand-muted">vs {opponent}</p>}
        </div>
      ) : (
        <p className="text-xs text-brand-muted">🪜</p>
      )}
    </div>
  )
}
