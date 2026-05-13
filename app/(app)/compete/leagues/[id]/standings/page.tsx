import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <span className="text-xs text-brand-muted">—</span>

  const W = 72, H = 24, pad = 3

  if (values.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle cx={W / 2} cy={H / 2} r="3" fill="#65a30d" />
      </svg>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const coords = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (W - pad * 2),
    y: H - pad - ((v - min) / range) * (H - pad * 2),
  }))

  const polyline = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline
        points={polyline}
        fill="none"
        stroke="#84cc16"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="2" fill="#65a30d" />
      ))}
    </svg>
  )
}

function StreakBadge({ streak }: { streak: { type: 'W' | 'L'; count: number } | null }) {
  if (!streak || streak.count === 0) return <span className="text-xs text-brand-muted">—</span>
  const isWin = streak.type === 'W'
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
      isWin ? 'bg-lime-100 text-lime-700' : 'bg-red-50 text-red-500'
    }`}>
      {streak.type}{streak.count}
    </span>
  )
}

export default async function LeagueStandingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, format, created_by, sub_credit_cap, standings_method').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, profile:profiles(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  if (!league) notFound()

  const sessionIds = (sessions ?? []).map((s) => s.id)
  const subCreditCap: number = (league as unknown as Record<string, unknown>)?.sub_credit_cap as number ?? 7
  const standingsMethod: 'win_loss' | 'total_points' = ((league as unknown as Record<string, unknown>)?.standings_method as string ?? 'win_loss') as 'win_loss' | 'total_points'

  // Map sessionId → chronological index for streak ordering
  const sessionOrder = new Map((sessions ?? []).map((s, i) => [s.id, i]))

  const [{ data: matches }, { data: subSessionPlayers }] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from('league_matches')
          .select('session_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
          .in('session_id', sessionIds)
          .not('team1_score', 'is', null)
      : Promise.resolve({ data: [] }),
    sessionIds.length > 0
      ? supabase
          .from('league_session_players')
          .select('id, user_id, session_id, sub_for_session_player_id')
          .in('session_id', sessionIds)
          .not('sub_for_session_player_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  // Build sub redirect maps
  const absentSpIds = (subSessionPlayers ?? []).map(s => s.sub_for_session_player_id as string).filter(Boolean)
  const { data: absentSpRows } = absentSpIds.length > 0
    ? await supabase.from('league_session_players').select('id, user_id').in('id', absentSpIds)
    : { data: [] }
  const absentUserBySpId = new Map((absentSpRows ?? []).map(p => [p.id as string, p.user_id as string]))

  type SubInfo = { subToAbsent: Map<string, string>; absentUserIds: Set<string> }
  const subInfoBySession = new Map<string, SubInfo>()
  for (const sp of subSessionPlayers ?? []) {
    const sid = sp.session_id as string
    const subUid = sp.user_id as string
    const absentUid = absentUserBySpId.get(sp.sub_for_session_player_id as string)
    if (!subUid || !absentUid) continue
    if (!subInfoBySession.has(sid)) subInfoBySession.set(sid, { subToAbsent: new Map(), absentUserIds: new Set() })
    const info = subInfoBySession.get(sid)!
    info.subToAbsent.set(subUid, absentUid)
    info.absentUserIds.add(absentUid)
  }

  // Per-player stats
  type Stats = {
    points: number
    pointsAgainst: number
    games: number
    wins: number
    losses: number
    // chronological match results for streak: { sessionOrder, won }
    matchResults: { order: number; won: boolean }[]
  }
  const statsMap = new Map<string, Stats>()
  const sessionPts = new Map<string, Map<string, number>>()

  for (const reg of registrations ?? []) {
    statsMap.set(reg.user_id, { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] })
  }

  for (const m of matches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const team1Players = [m.team1_player1_id, m.team1_player2_id].filter(Boolean)
    const team2Players = [m.team2_player1_id, m.team2_player2_id].filter(Boolean)
    const info = subInfoBySession.get(m.session_id)
    const team1Won = m.team1_score > m.team2_score
    const order = sessionOrder.get(m.session_id) ?? 0

    const apply = (pid: string, pts: number, against: number, won: boolean) => {
      let effectivePid = pid
      let effectivePts = pts
      if (info) {
        const absentUid = info.subToAbsent.get(pid)
        if (absentUid) { effectivePid = absentUid; effectivePts = Math.min(pts, subCreditCap) }
        else if (info.absentUserIds.has(pid)) { effectivePts = Math.min(pts, subCreditCap) }
      }
      const s = statsMap.get(effectivePid) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
      s.games++
      s.points += effectivePts
      s.pointsAgainst += against
      if (won) s.wins++; else s.losses++
      s.matchResults.push({ order, won })
      statsMap.set(effectivePid, s)

      if (!sessionPts.has(effectivePid)) sessionPts.set(effectivePid, new Map())
      const bySession = sessionPts.get(effectivePid)!
      bySession.set(m.session_id, (bySession.get(m.session_id) ?? 0) + effectivePts)
    }

    for (const pid of team1Players) { if (pid) apply(pid, m.team1_score, m.team2_score, team1Won) }
    for (const pid of team2Players) { if (pid) apply(pid, m.team2_score, m.team1_score, !team1Won) }
  }

  // Compute streak from chronological match results
  function computeStreak(results: { order: number; won: boolean }[]): { type: 'W' | 'L'; count: number } | null {
    if (results.length === 0) return null
    const sorted = [...results].sort((a, b) => a.order - b.order)
    const last = sorted[sorted.length - 1]
    let count = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].won === last.won) count++
      else break
    }
    return { type: last.won ? 'W' : 'L', count }
  }

  const standings = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
    const s = statsMap.get(r.user_id) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
    const streak = computeStreak(s.matchResults)
    const winPct = s.games > 0 ? s.wins / s.games : 0
    return { ...p, userId: r.user_id, ...s, streak, winPct, diff: s.points - s.pointsAgainst }
  }).sort((a, b) =>
    standingsMethod === 'total_points'
      ? b.points - a.points || b.diff - a.diff || b.winPct - a.winPct
      : b.winPct - a.winPct || b.diff - a.diff || b.points - a.points
  )

  const hasResults = !!matches && matches.length > 0
  const isManager = user?.id === league.created_by
  const firstSession = sessions?.[0]
  const registeredCount = (registrations ?? []).length
  const sessionList = sessions ?? []

  const sessionsWithData = sessionList.filter(s =>
    (matches ?? []).some(m => m.session_id === s.id)
  )

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Standings</h1>
        <p className="text-xs text-brand-muted">
          {standingsMethod === 'total_points' ? 'Ranked by total points, then point differential' : 'Ranked by win %, then point differential'}
        </p>
      </div>

      {!hasResults ? (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-2xl">🏓</p>
          <p className="text-sm font-medium text-brand-dark">No results yet</p>
          <p className="text-xs text-brand-muted">
            {registeredCount > 0
              ? `${registeredCount} player${registeredCount !== 1 ? 's' : ''} registered. Standings will appear once match results are entered.`
              : 'Standings will appear once players register and match results are entered.'}
          </p>
          {isManager && firstSession && (
            <Link
              href={`/compete/leagues/${params.id}/sessions/${firstSession.id}/results`}
              className="inline-block mt-2 text-xs text-brand-active font-medium underline underline-offset-2"
            >
              Enter results for play 1 →
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-brand-soft text-left px-3 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-r border-brand-border whitespace-nowrap z-10">
                  Player
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">W-L</th>
                <th className={`px-3 py-2 text-center text-xs uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft ${standingsMethod === 'win_loss' ? 'font-bold text-brand-dark' : 'font-semibold text-brand-muted'}`}>Win%</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">+/-</th>
                {standingsMethod === 'total_points' && (
                  <th className="px-3 py-2 text-center text-xs font-bold text-brand-dark uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">Total Pts</th>
                )}
                <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">Streak</th>
                {sessionsWithData.map((s) => (
                  <th key={s.id} className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">
                    Wk {s.session_number}
                  </th>
                ))}
                {sessionsWithData.length >= 2 && (
                  <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">
                    Trend
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.map((p, i) => {
                const bySession = sessionPts.get(p.userId) ?? new Map()
                const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-brand-surface'
                const sparkValues = sessionsWithData.map(s => bySession.get(s.id) ?? 0)
                const diffStr = p.diff > 0 ? `+${p.diff}` : String(p.diff)
                return (
                  <tr key={p.id}>
                    <td className={`sticky left-0 px-3 py-2.5 border-r border-b border-brand-border whitespace-nowrap z-10 ${rowBg}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-brand-muted text-xs w-4 text-right flex-shrink-0">{i + 1}</span>
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                          {p.profile_photo_url
                            ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                            : <span className="flex items-center justify-center w-full h-full text-brand-muted text-[10px]">{p.name[0]}</span>
                          }
                        </div>
                        <span className="text-sm font-medium text-brand-dark">{p.name}</span>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                      <span className="text-xs text-brand-muted">{p.wins}–{p.losses}</span>
                    </td>
                    <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                      <span className="text-sm font-bold text-brand-dark">
                        {p.games > 0 ? (p.winPct * 100).toFixed(0) + '%' : '—'}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                      <span className={`text-xs font-medium ${p.diff > 0 ? 'text-lime-600' : p.diff < 0 ? 'text-red-400' : 'text-brand-muted'}`}>
                        {p.games > 0 ? diffStr : '—'}
                      </span>
                    </td>
                    {standingsMethod === 'total_points' && (
                      <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                        <span className="text-sm font-bold text-brand-dark">{p.games > 0 ? p.points : '—'}</span>
                      </td>
                    )}
                    <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                      <StreakBadge streak={p.streak} />
                    </td>
                    {sessionsWithData.map((s) => {
                      const val = bySession.get(s.id)
                      return (
                        <td key={s.id} className={`px-3 py-2.5 text-center border-b border-l border-brand-border ${rowBg}`}>
                          {val != null
                            ? <span className="text-sm text-brand-dark">{val}</span>
                            : <span className="text-xs text-brand-muted">—</span>
                          }
                        </td>
                      )
                    })}
                    {sessionsWithData.length >= 2 && (
                      <td className={`px-2 py-1 text-center border-b border-l border-brand-border ${rowBg}`}>
                        <Sparkline values={sparkValues} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
