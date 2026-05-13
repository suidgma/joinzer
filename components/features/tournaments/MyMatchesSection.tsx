'use client'

function formatTime(t: string | null | undefined): string | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
}

type Registration = {
  id: string
  user_id: string
  team_name: string | null
  status: string
  user_profile: { name: string } | null
  partner_user_id?: string | null
  partner_profile?: { name: string } | null
}

type Division = {
  id: string
  name: string
  team_type: string
  tournament_registrations: Registration[]
}

type Props = {
  currentUserId: string
  matches: Match[]
  divisions: Division[]
}

function lastName(name: string | null | undefined): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1]
}

function TeamNameDisplay({ regId, regs, isDoubles }: {
  regId: string | null
  regs: Registration[]
  isDoubles: boolean
}) {
  if (!regId) return <span>TBD</span>
  const r = regs.find(x => x.id === regId)
  if (!r) return <span>TBD</span>
  if (!isDoubles) return <span>{r.team_name || r.user_profile?.name || 'Unknown'}</span>
  const p1 = lastName(r.user_profile?.name) || r.team_name || 'Unknown'
  if (r.partner_profile?.name) {
    return <span>{p1} / {lastName(r.partner_profile.name)}</span>
  }
  return <span>{p1} / <span className="text-yellow-500 font-bold">?</span></span>
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Upcoming',
  ready: 'Ready',
  in_progress: 'Live',
  completed: 'Final',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-brand-muted bg-gray-100',
  ready: 'text-yellow-700 bg-yellow-50',
  in_progress: 'text-brand-active bg-brand-soft',
  completed: 'text-gray-500 bg-gray-100',
}

export default function MyMatchesSection({ currentUserId, matches, divisions }: Props) {
  const allRegs = divisions.flatMap(d => d.tournament_registrations)
  const divisionMap = Object.fromEntries(divisions.map(d => [d.id, d.name]))

  // Registration ids belonging to the current user
  const myRegIds = new Set(allRegs.filter(r => r.user_id === currentUserId).map(r => r.id))

  const myMatches = matches.filter(m =>
    myRegIds.has(m.team_1_registration_id ?? '') ||
    myRegIds.has(m.team_2_registration_id ?? '')
  ).sort((a, b) => {
    // Sort: live first, then upcoming, then completed
    const order = { in_progress: 0, ready: 1, pending: 2, completed: 3 }
    return (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4)
  })

  if (myMatches.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">My Matches</h2>
      <div className="space-y-2">
        {myMatches.map(m => {
          const iAmTeam1 = myRegIds.has(m.team_1_registration_id ?? '')
          const isDoubles = divisions.find(d => d.id === m.division_id)?.team_type === 'doubles'
          const myRegId = iAmTeam1 ? m.team_1_registration_id : m.team_2_registration_id
          const oppRegId = iAmTeam1 ? m.team_2_registration_id : m.team_1_registration_id
          const myScore = iAmTeam1 ? m.team_1_score : m.team_2_score
          const oppScore = iAmTeam1 ? m.team_2_score : m.team_1_score
          const won = m.status === 'completed' && m.winner_registration_id === myRegId
          const lost = m.status === 'completed' && m.winner_registration_id != null && m.winner_registration_id !== myRegId

          return (
            <div key={m.id} className="bg-brand-surface border border-brand-border rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-brand-muted shrink-0">{divisionMap[m.division_id] ?? 'Division'}</span>
                  {m.court_number != null && (
                    <span className="text-xs text-brand-muted shrink-0">· Court {m.court_number}</span>
                  )}
                  {m.scheduled_time && (
                    <span className="text-xs text-brand-muted shrink-0">· {formatTime(m.scheduled_time)}</span>
                  )}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[m.status] ?? 'text-brand-muted bg-gray-100'}`}>
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Me */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-brand-dark truncate"><TeamNameDisplay regId={myRegId} regs={allRegs} isDoubles={isDoubles} /></p>
                  {m.status === 'completed' && (
                    <p className={`text-xs font-bold mt-0.5 ${won ? 'text-green-600' : lost ? 'text-red-500' : 'text-brand-muted'}`}>
                      {won ? 'Won' : lost ? 'Lost' : 'Tie'}
                    </p>
                  )}
                </div>

                {/* Score */}
                {m.status === 'completed' && myScore != null && oppScore != null ? (
                  <div className="text-center shrink-0">
                    <p className="text-lg font-bold text-brand-dark tabular-nums">{myScore} – {oppScore}</p>
                  </div>
                ) : (
                  <div className="text-center shrink-0">
                    <p className="text-xs text-brand-muted font-medium">vs</p>
                  </div>
                )}

                {/* Opponent */}
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-medium text-brand-body truncate"><TeamNameDisplay regId={oppRegId} regs={allRegs} isDoubles={isDoubles} /></p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
