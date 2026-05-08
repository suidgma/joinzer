'use client'

export type FormatType = 'round_robin' | 'single_elimination' | 'double_elimination' | 'pool_play_playoffs'

export type FormatSettings = {
  // shared
  games_to?: number
  win_by?: number
  // round_robin
  cap_score?: number | null
  ranking_method?: string
  // pool_play_playoffs
  number_of_pools?: number
  teams_per_pool?: number
  teams_advance_per_pool?: number
  pool_ranking_method?: string
  playoff_format?: string
}

export const FORMAT_DEFAULTS: Record<FormatType, FormatSettings> = {
  round_robin:        { games_to: 11, win_by: 2, cap_score: null, ranking_method: 'wins' },
  single_elimination: { games_to: 11, win_by: 2 },
  double_elimination: { games_to: 11, win_by: 2 },
  pool_play_playoffs: {
    number_of_pools: 2, teams_per_pool: 4, teams_advance_per_pool: 2,
    pool_ranking_method: 'wins', playoff_format: 'single_elimination', games_to: 11, win_by: 2,
  },
}

const FORMAT_META: Record<FormatType, { label: string; description: string }> = {
  round_robin:        { label: 'Round Robin',          description: 'Every team plays every other team.' },
  single_elimination: { label: 'Single Elimination',   description: 'One loss and you\'re out.' },
  double_elimination: { label: 'Double Elimination',   description: 'Teams eliminated after two losses.' },
  pool_play_playoffs: { label: 'Pool Play + Playoffs', description: 'Groups phase, then bracket playoffs.' },
}

export function validateFormatSettings(type: FormatType, s: FormatSettings): string | null {
  const gt = s.games_to
  if (!gt || ![11, 15, 21].includes(gt)) return 'Games to must be 11, 15, or 21.'
  const wb = s.win_by
  if (!wb || ![1, 2].includes(wb)) return 'Win by must be 1 or 2.'
  if (type === 'pool_play_playoffs') {
    if (!s.number_of_pools || s.number_of_pools < 1) return 'Must have at least 1 pool.'
    if (!s.teams_per_pool || s.teams_per_pool < 2) return 'Must have at least 2 teams per pool.'
    if (!s.teams_advance_per_pool || s.teams_advance_per_pool < 1) return 'Teams advance must be ≥ 1.'
    if (s.teams_advance_per_pool > s.teams_per_pool) return 'Teams advancing cannot exceed teams per pool.'
  }
  return null
}

export function formatSummaryLines(type: FormatType, s: FormatSettings): string[] {
  const label = FORMAT_META[type]?.label ?? type
  const game = `Games to ${s.games_to ?? 11}, win by ${s.win_by ?? 2}`
  if (type === 'round_robin') {
    const cap = s.cap_score ? `, cap ${s.cap_score}` : ''
    const rank = s.ranking_method ? ` · Ranked by ${s.ranking_method.replace(/_/g, ' ')}` : ''
    return [label, `${game}${cap}${rank}`]
  }
  if (type === 'pool_play_playoffs') {
    const pools = `${s.number_of_pools} pools × ${s.teams_per_pool} teams, top ${s.teams_advance_per_pool} advance`
    const playoffs = `Playoffs: ${(s.playoff_format ?? 'single_elimination').replace(/_/g, ' ')}`
    return [label, pools, `${game} · ${playoffs}`]
  }
  return [label, game]
}

type Props = {
  formatType: FormatType
  formatSettings: FormatSettings
  onTypeChange: (t: FormatType) => void
  onSettingsChange: (s: FormatSettings) => void
}

export default function FormatSettingsFields({ formatType, formatSettings, onTypeChange, onSettingsChange }: Props) {
  const s = formatSettings
  const set = (patch: Partial<FormatSettings>) => onSettingsChange({ ...s, ...patch })

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Tournament Format</p>

      {/* Format type selector */}
      <div className="grid grid-cols-1 gap-2">
        {(Object.keys(FORMAT_META) as FormatType[]).map(ft => (
          <label key={ft} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
            formatType === ft
              ? 'border-brand bg-brand-soft'
              : 'border-brand-border bg-white hover:bg-brand-soft/50'
          }`}>
            <input
              type="radio"
              name="format_type"
              value={ft}
              checked={formatType === ft}
              onChange={() => {
                onTypeChange(ft)
                onSettingsChange(FORMAT_DEFAULTS[ft])
              }}
              className="mt-0.5 accent-brand"
            />
            <div>
              <p className="text-sm font-semibold text-brand-dark">{FORMAT_META[ft].label}</p>
              <p className="text-xs text-brand-muted">{FORMAT_META[ft].description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Shared: games_to + win_by */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Games To</label>
          <input
            type="number"
            min="1"
            value={s.games_to ?? 11}
            onChange={e => set({ games_to: Number(e.target.value) || 11 })}
            className="w-full input"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Win By</label>
          <select value={s.win_by ?? 2} onChange={e => set({ win_by: Number(e.target.value) })} className="w-full input">
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </div>
      </div>

      {/* Round robin extras */}
      {formatType === 'round_robin' && (
        <>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Cap Score <span className="font-normal">(optional)</span></label>
            <input
              type="number"
              value={s.cap_score ?? ''}
              onChange={e => set({ cap_score: e.target.value ? Number(e.target.value) : null })}
              placeholder="No cap"
              min={1}
              max={99}
              className="w-full input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Ranking Method</label>
            <select value={s.ranking_method ?? 'wins'} onChange={e => set({ ranking_method: e.target.value })} className="w-full input">
              <option value="wins">Wins</option>
              <option value="point_differential">Point Differential</option>
              <option value="points_scored">Points Scored</option>
              <option value="head_to_head">Head to Head</option>
            </select>
          </div>
        </>
      )}

      {/* Pool play extras */}
      {formatType === 'pool_play_playoffs' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Pools</label>
              <input
                type="number"
                value={s.number_of_pools ?? 2}
                onChange={e => set({ number_of_pools: Math.max(1, Number(e.target.value)) })}
                min={1}
                className="w-full input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Teams/Pool</label>
              <input
                type="number"
                value={s.teams_per_pool ?? 4}
                onChange={e => set({ teams_per_pool: Math.max(2, Number(e.target.value)) })}
                min={2}
                className="w-full input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Advance</label>
              <input
                type="number"
                value={s.teams_advance_per_pool ?? 2}
                onChange={e => set({ teams_advance_per_pool: Math.max(1, Number(e.target.value)) })}
                min={1}
                className="w-full input"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Pool Ranking</label>
              <select value={s.pool_ranking_method ?? 'wins'} onChange={e => set({ pool_ranking_method: e.target.value })} className="w-full input">
                <option value="wins">Wins</option>
                <option value="point_differential">Point Differential</option>
                <option value="points_scored">Points Scored</option>
                <option value="head_to_head">Head to Head</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Playoff Format</label>
              <select value={s.playoff_format ?? 'single_elimination'} onChange={e => set({ playoff_format: e.target.value })} className="w-full input">
                <option value="single_elimination">Single Elim</option>
                <option value="double_elimination">Double Elim</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
