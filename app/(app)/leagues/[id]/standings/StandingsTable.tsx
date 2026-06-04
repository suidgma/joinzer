'use client'

import { useState, useMemo } from 'react'

// ---- sub-components ----

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
      <polyline points={polyline} fill="none" stroke="#84cc16" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="2" fill="#65a30d" />)}
    </svg>
  )
}

function StreakBadge({ streak }: { streak: { type: 'W' | 'L'; count: number } | null }) {
  if (!streak || streak.count === 0) return <span className="text-xs text-brand-muted">—</span>
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
      streak.type === 'W' ? 'bg-lime-100 text-lime-700' : 'bg-red-50 text-red-500'
    }`}>
      {streak.type}{streak.count}
    </span>
  )
}

// ---- types ----

type SortKey = 'name' | 'wl' | 'winPct' | 'diff' | 'points' | 'streak' | string

type StandingRow = {
  id: string
  userId: string
  name: string
  profile_photo_url: string | null
  points: number
  pointsAgainst: number
  games: number
  wins: number
  losses: number
  winPct: number
  diff: number
  streak: { type: 'W' | 'L'; count: number } | null
}

type SessionInfo = { id: string; session_number: number }

type Props = {
  initialStandings: StandingRow[]
  sessionsWithData: SessionInfo[]
  sessionPts: Record<string, Record<string, number>>
  sessionWL: Record<string, Record<string, { wins: number; losses: number }>>
  standingsMethod: 'win_loss' | 'total_points'
}

// ---- sort logic ----

function sortRows(
  rows: StandingRow[],
  key: SortKey,
  dir: 'asc' | 'desc',
  sessionPts: Record<string, Record<string, number>>,
): StandingRow[] {
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'name':
        return mul * a.name.localeCompare(b.name)
      case 'wl':
        return mul * ((a.wins - b.wins) || (b.losses - a.losses))
      case 'winPct':
        return mul * (a.winPct - b.winPct)
      case 'diff':
        return mul * (a.diff - b.diff)
      case 'points':
        return mul * (a.points - b.points)
      case 'streak': {
        const score = (s: StandingRow['streak']) =>
          s ? (s.type === 'W' ? s.count : -s.count) : 0
        return mul * (score(a.streak) - score(b.streak))
      }
      default: {
        // per-session column key is `wk_${sessionId}`
        const sid = key.slice(3)
        const aVal = sessionPts[a.userId]?.[sid] ?? 0
        const bVal = sessionPts[b.userId]?.[sid] ?? 0
        return mul * (aVal - bVal)
      }
    }
  })
}

// ---- main component ----

export default function StandingsTable({
  initialStandings,
  sessionsWithData,
  sessionPts,
  sessionWL,
  standingsMethod,
}: Props) {
  // Default: sort by points scored descending
  const [sortKey, setSortKey] = useState<SortKey>('points')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      // Name sorts ascending by default; everything else descending
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(
    () => sortRows(initialStandings, sortKey, sortDir, sessionPts),
    [initialStandings, sortKey, sortDir, sessionPts],
  )

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <span className="ml-1 text-brand-border">↕</span>
    return <span className="ml-1 text-brand-active">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  function Th({
    col,
    children,
    className = '',
    extraCls = '',
  }: {
    col: SortKey
    children: React.ReactNode
    className?: string
    extraCls?: string
  }) {
    const isActive = col === sortKey
    return (
      <th
        onClick={() => handleSort(col)}
        className={`px-3 py-2 text-center text-xs uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft cursor-pointer select-none hover:bg-brand-soft/80 transition-colors ${
          isActive ? 'font-bold text-brand-dark' : 'font-semibold text-brand-muted'
        } ${className} ${extraCls}`}
      >
        {children}
        <SortIcon col={col} />
      </th>
    )
  }

  // Column order depends on standings method
  const statColOrder: SortKey[] = standingsMethod === 'win_loss'
    ? ['wl', 'winPct', 'points', 'diff', 'streak']
    : ['points', 'diff', 'wl', 'winPct', 'streak']

  const statColHeaders: Record<string, string> = {
    points: 'Points', diff: '+/-', wl: 'W-L', winPct: 'Win%', streak: 'Streak',
  }

  function StatCell({ col, p, diffStr }: { col: SortKey; p: StandingRow; diffStr: string }) {
    const base = `px-3 py-2.5 text-center border-b border-brand-border`
    if (col === 'points') return <td className={base}><span className="text-sm font-bold text-brand-dark">{p.games > 0 ? p.points : '—'}</span></td>
    if (col === 'diff')   return <td className={base}><span className={`text-xs font-medium ${p.diff > 0 ? 'text-lime-600' : p.diff < 0 ? 'text-red-400' : 'text-brand-muted'}`}>{p.games > 0 ? diffStr : '—'}</span></td>
    if (col === 'wl')     return <td className={base}><span className="text-xs text-brand-muted">{p.wins}–{p.losses}</span></td>
    if (col === 'winPct') return <td className={base}><span className="text-sm font-bold text-brand-dark">{p.games > 0 ? (p.winPct * 100).toFixed(0) + '%' : '—'}</span></td>
    if (col === 'streak') return <td className={base}><StreakBadge streak={p.streak} /></td>
    return null
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            {/* Player — left-sticky, special styling */}
            <th
              onClick={() => handleSort('name')}
              className={`sticky left-0 bg-brand-soft text-left px-3 py-2 text-xs uppercase tracking-wide border-b border-r border-brand-border whitespace-nowrap z-10 cursor-pointer select-none hover:bg-brand-soft/80 transition-colors ${
                sortKey === 'name' ? 'font-bold text-brand-dark' : 'font-semibold text-brand-muted'
              }`}
            >
              Player<SortIcon col="name" />
            </th>
            {statColOrder.map(col => <Th key={col} col={col}>{statColHeaders[col]}</Th>)}
            {sessionsWithData.map((s) => (
              <Th key={s.id} col={`wk_${s.id}`} className="border-l">
                Wk {s.session_number}
              </Th>
            ))}
            {sessionsWithData.length >= 2 && (
              <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">
                Trend
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const bySession = sessionPts[p.userId] ?? {}
            const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-brand-surface'
            const sparkValues = sessionsWithData.map(s => bySession[s.id] ?? 0)
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
                {statColOrder.map(col => <StatCell key={col} col={col} p={p} diffStr={diffStr} />)}
                {sessionsWithData.map((s) => {
                  const pts = bySession[s.id]
                  const wl  = sessionWL[p.userId]?.[s.id]
                  return (
                    <td key={s.id} className={`px-3 py-2 text-center border-b border-l border-brand-border ${rowBg}`}>
                      {pts != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          {wl && <span className="text-[10px] text-brand-muted leading-none">{wl.wins}–{wl.losses}</span>}
                          <span className="text-sm font-medium text-brand-dark leading-none">{pts}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-brand-muted">—</span>
                      )}
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
  )
}
