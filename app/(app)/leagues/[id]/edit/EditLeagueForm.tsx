'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatSessionDate } from '@/lib/utils/date'
import { prepareLeagueWrite, mapDivisionFormat } from '@/lib/taxonomy/write-helpers'
import TimeSelect from '@/components/features/events/TimeSelect'
import FormSection from '@/components/ui/form-section'
import FormRow from '@/components/ui/form-row'
import SessionManager from './SessionManager'

const CATEGORY_OPTIONS = [
  { value: 'men',   label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'coed',  label: 'Coed' },
  { value: 'open',  label: 'Open' },
]

function parseFormat(fmt: string): { teamType: 'doubles' | 'singles'; category: string } {
  if (fmt.endsWith('_singles') || fmt === 'open_singles') {
    const cat = fmt.replace('_singles', '')
    return { teamType: 'singles', category: ['men', 'women'].includes(cat) ? cat : 'open' }
  }
  if (fmt.endsWith('_doubles')) {
    const cat = fmt.replace('_doubles', '')
    return { teamType: 'doubles', category: ['men', 'women', 'mixed', 'coed', 'open'].includes(cat) ? cat : 'mixed' }
  }
  return { teamType: 'doubles', category: 'mixed' }
}
const SKILL_STEPS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
const REG_OPTIONS = [
  { value: 'upcoming', label: 'Coming Soon' },
  { value: 'open', label: 'Open' },
  { value: 'waitlist_only', label: 'Waitlist Only' },
  { value: 'closed', label: 'Closed' },
]
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function generateDates(start: string, count: number): string[] {
  if (!start || !count || count < 1) return []
  const dates: string[] = []
  const base = new Date(start + 'T00:00:00')
  for (let i = 0; i < count; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i * 7)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

// Convert ISO timestamptz to YYYY-MM-DDTHH:mm in PT for datetime-local inputs
function isoToPtLocal(iso: string): string {
  const d = new Date(iso)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(d).map(({ type, value }) => [type, value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Append Pacific offset to a datetime-local string (YYYY-MM-DDTHH:mm) for DB storage
function ptLocalToIso(local: string): string {
  const month = parseInt(local.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${local}:00${ptOffset}`
}

type InitialData = Record<string, any>

type SessionRow = {
  id: string
  session_number: number
  session_date: string
  session_time: string | null
  league_session_subs: { user_id: string; profile: { id: string; name: string } }[]
}

type Props = {
  leagueId: string
  initialData: InitialData
  existingSessionDates: string[]
  existingSessionCount: number
  registrantCount: number
  sessions: SessionRow[]
  formatLocked: boolean
}

export default function EditLeagueForm({
  leagueId,
  initialData: d,
  existingSessionDates,
  existingSessionCount,
  registrantCount,
  sessions,
  formatLocked,
}: Props) {
  const router = useRouter()

  const [name, setName] = useState(d.name ?? '')
  const { teamType: initTeamType, category: initCategory } = parseFormat(d.format ?? 'mixed_doubles')
  const [teamType, setTeamType] = useState<'doubles' | 'singles'>(initTeamType)
  const [partnerMode, setPartnerMode] = useState<'rotating' | 'fixed'>(
    (d as any).partner_mode === 'fixed' ? 'fixed' : 'rotating'
  )
  const [category, setCategory] = useState(initCategory)
  const [skillMin, setSkillMin] = useState(d.skill_min?.toString() ?? '2.0')
  const [skillMax, setSkillMax] = useState(d.skill_max?.toString() ?? '')
  const [locationName, setLocationName] = useState(d.location_name ?? '')
  const [startTime, setStartTime] = useState(d.start_time ?? '08:00')
  const [estimatedEndTime, setEstimatedEndTime] = useState(d.estimated_end_time ?? '17:00')
  const [startDate, setStartDate] = useState(d.start_date ?? '')
  const [registrationClosesAt, setRegistrationClosesAt] = useState(
    d.registration_closes_at ? isoToPtLocal(d.registration_closes_at) : ''
  )
  const [playDays, setPlayDays] = useState(d.play_days?.toString() ?? '')
  const [gamesPerSession, setGamesPerSession] = useState(d.games_per_session?.toString() ?? '')
  const [maxPlayers, setMaxPlayers] = useState(d.max_players?.toString() ?? '')
  const [registrationStatus, setRegistrationStatus] = useState(d.registration_status ?? 'upcoming')
  const [status, setStatus] = useState(d.status ?? 'active')
  const [description, setDescription] = useState(d.description ?? '')
  const [costDollars, setCostDollars] = useState(d.cost_cents ? String(d.cost_cents / 100) : '')
  const [standingsMethod, setStandingsMethod] = useState<'win_loss' | 'total_points'>(
    (d.standings_method as 'win_loss' | 'total_points') ?? 'total_points'
  )
  const [pointsToWin, setPointsToWin] = useState(d.points_to_win?.toString() ?? '11')
  const [winBy, setWinBy] = useState<1 | 2>((d.win_by as 1 | 2) ?? 1)
  const [subCreditCap, setSubCreditCap] = useState(d.sub_credit_cap?.toString() ?? '7')
  const [noPlayDates, setNoPlayDates] = useState<string[]>(d.no_play_dates ?? [])
  const [noPlayInput, setNoPlayInput] = useState('')
  // League format (Phase 1) — mirrors Create. Box create is enabled unless the
  // env flag is explicitly 'false'.
  const BOX_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BOX_LEAGUES !== 'false'
  const [formatKind, setFormatKind] = useState<'session_rr' | 'box'>(d.format_kind === 'box' ? 'box' : 'session_rr')
  const [boxSize, setBoxSize] = useState((d.format_settings_json?.box_size ?? 5).toString())
  const [cycleWeeks, setCycleWeeks] = useState((d.format_settings_json?.cycle_length_weeks ?? 4).toString())
  const [promoteCount, setPromoteCount] = useState((d.format_settings_json?.promote_count ?? 1).toString())
  const [relegateCount, setRelegateCount] = useState((d.format_settings_json?.relegate_count ?? 1).toString())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pointsToWinNum = parseInt(pointsToWin) || 11
  const isBox = formatKind === 'box'
  const hasRegistrants = registrantCount > 0
  const generatedDates = generateDates(startDate, parseInt(playDays) || 0)
  const lastDate = generatedDates[generatedDates.length - 1] ?? ''
  const dayLabel = startDate ? DAYS[new Date(startDate + 'T00:00:00').getDay()] : ''
  const hasNoSessions = existingSessionCount === 0
  const willGenerateSessions = hasNoSessions && generatedDates.length > 0

  function handlePointsToWinChange(val: string) {
    setPointsToWin(val)
    const max = parseInt(val) || 11
    if (parseInt(subCreditCap) > max) setSubCreditCap(String(max))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: updateErr } = await supabase
      .from('leagues')
      .update({
        name: name.trim(),
        ...prepareLeagueWrite({
            format: mapDivisionFormat(category, teamType),
            skill_min: skillMin ? parseFloat(skillMin) : null,
            skill_max: skillMax ? parseFloat(skillMax) : null,
          }),
        location_name: locationName.trim() || null,
        start_time: startTime || null,
        estimated_end_time: estimatedEndTime || null,
        start_date: startDate || null,
        end_date: isBox ? null : (lastDate || null),
        play_days: isBox ? null : (playDays ? parseInt(playDays) : null),
        games_per_session: isBox ? null : (gamesPerSession ? parseInt(gamesPerSession) : null),
        max_players: maxPlayers ? parseInt(maxPlayers) : null,
        registration_status: registrationStatus,
        registration_closes_at: registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null,
        status,
        description: description.trim() || null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        standings_method: standingsMethod,
        points_to_win: pointsToWinNum,
        win_by: winBy,
        partner_mode: teamType !== 'doubles' ? 'rotating' : (isBox ? 'fixed' : partnerMode),
        sub_credit_cap: parseInt(subCreditCap) || 7,
        no_play_dates: isBox ? [] : noPlayDates,
        format_kind: formatKind,
        format_settings_json: isBox
          ? {
              box_size: parseInt(boxSize) || 5,
              cycle_length_weeks: parseInt(cycleWeeks) || 4,
              promote_count: parseInt(promoteCount) || 1,
              relegate_count: parseInt(relegateCount) || 1,
            }
          : {},
      })
      .eq('id', leagueId)

    if (updateErr) { setError(updateErr.message); setLoading(false); return }

    // Generate sessions only if none exist yet — box leagues use cycles, not sessions.
    if (!isBox && willGenerateSessions) {
      const roundsPerSession = gamesPerSession ? parseInt(gamesPerSession) : 7
      const rows = generatedDates.map((d, i) => ({
        league_id: leagueId,
        session_date: d,
        session_number: i + 1,
        rounds_planned: roundsPerSession,
      }))
      await supabase.from('league_sessions').insert(rows)
    }

    router.push(`/leagues/${leagueId}`)
  }

  const lockHint = hasRegistrants
    ? `Heads up — ${registrantCount} player${registrantCount !== 1 ? 's' : ''} already registered. Changing these may affect their eligibility.`
    : undefined

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      <FormSection title="Basics" description="League details, format, and scoring rules." defaultOpen>
        <FormRow label="League name" htmlFor="name" required>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        {BOX_ENABLED && (
          <FormRow
            label="League format"
            helpText={formatLocked
              ? 'Format is locked — this league already has sessions or boxes. Delete them first to switch format (box settings below stay editable).'
              : 'Round Robin: weekly sessions with rotating play. Box: skill-tiered boxes over cycles, with promotion & relegation.'}
          >
            <div className="grid grid-cols-2 gap-2">
              {([['session_rr', 'Round Robin'], ['box', 'Box League']] as const).map(([val, label]) => {
                const active = formatKind === val
                const disabled = formatLocked && !active
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={disabled}
                    onClick={() => { if (!formatLocked) setFormatKind(val) }}
                    className={`p-2.5 rounded-lg border text-left ${active ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-sm font-semibold text-brand-dark">{label}</div>
                  </button>
                )
              })}
            </div>
          </FormRow>
        )}
        <FormRow label="Team type" helpText={lockHint}>
          <div className="grid grid-cols-2 gap-2">
            {(['doubles', 'singles'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTeamType(t); if (t === 'singles' && (category === 'mixed' || category === 'coed')) setCategory('open') }}
                className={`p-2.5 rounded-lg border text-left ${teamType === t ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
              >
                <div className="text-sm font-semibold text-brand-dark capitalize">{t}</div>
              </button>
            ))}
          </div>
        </FormRow>
        {teamType === 'doubles' && isBox && (
          <FormRow label="Partner mode">
            <p className="text-sm text-brand-muted">
              Box doubles use <span className="font-semibold text-brand-dark">fixed partners</span> — the same pair competes as one entrant for the whole cycle.
            </p>
          </FormRow>
        )}
        {teamType === 'doubles' && !isBox && (
          <FormRow label="Partner mode">
            <div className="grid grid-cols-2 gap-2">
              {(['rotating', 'fixed'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPartnerMode(m)}
                  className={`p-2.5 rounded-lg border text-left ${partnerMode === m ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                >
                  <div className="text-sm font-semibold text-brand-dark capitalize">{m}</div>
                  <div className="text-xs text-brand-muted mt-0.5">
                    {m === 'rotating' ? 'New partner every match' : 'Same partner all season'}
                  </div>
                </button>
              ))}
            </div>
          </FormRow>
        )}
        <FormRow label="Category" htmlFor="category" width="sm" helpText={lockHint}>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full input"
          >
            {CATEGORY_OPTIONS.filter(o => teamType === 'doubles' || !['mixed', 'coed'].includes(o.value)).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Skill range" width="md" helpText={lockHint ?? 'Leave blank to open to all skill levels.'}>
          <div className="flex items-center gap-3">
            <select
              value={skillMin}
              onChange={(e) => setSkillMin(e.target.value)}
              className="flex-1 input"
            >
              {SKILL_STEPS.map(v => <option key={v} value={String(v)}>{v.toFixed(1)}</option>)}
            </select>
            <span className="text-sm text-brand-muted shrink-0">to</span>
            <select
              value={skillMax}
              onChange={(e) => setSkillMax(e.target.value)}
              className="flex-1 input"
            >
              <option value="">No max</option>
              {SKILL_STEPS.map(v => <option key={v} value={String(v)}>{v.toFixed(1)}</option>)}
            </select>
          </div>
        </FormRow>
        <FormRow label="Points to win" htmlFor="points-to-win" width="xs">
          <input
            id="points-to-win"
            type="number"
            min="1"
            value={pointsToWin}
            onChange={(e) => handlePointsToWinChange(e.target.value)}
            placeholder="11"
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Win by" width="sm">
          <div className="flex rounded-xl overflow-hidden border border-brand-border h-[38px]">
            <button type="button" onClick={() => setWinBy(1)}
              className={`flex-1 text-sm font-medium transition-colors ${winBy === 1 ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}>
              Win by 1
            </button>
            <button type="button" onClick={() => setWinBy(2)}
              className={`flex-1 text-sm font-medium transition-colors ${winBy === 2 ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}>
              Win by 2
            </button>
          </div>
        </FormRow>
        <FormRow label="Standings method" width="md">
          <div className="flex rounded-xl overflow-hidden border border-brand-border h-[38px]">
            <button type="button" onClick={() => setStandingsMethod('total_points')}
              className={`flex-1 text-sm font-medium transition-colors ${standingsMethod === 'total_points' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}>
              Total Points
            </button>
            <button type="button" onClick={() => setStandingsMethod('win_loss')}
              className={`flex-1 text-sm font-medium transition-colors ${standingsMethod === 'win_loss' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}>
              Win-Loss
            </button>
          </div>
        </FormRow>
        <FormRow label="Sub credit cap" width="sm" helpText="Max points credited to an absent player when a sub plays in their place.">
          <select value={subCreditCap} onChange={(e) => setSubCreditCap(e.target.value)} className="w-full input">
            {Array.from({ length: pointsToWinNum }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>{n}{n === 7 && pointsToWinNum >= 7 ? ' (default)' : ''}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Description" htmlFor="description">
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full input resize-none"
          />
        </FormRow>
      </FormSection>

      <FormSection title="Schedule" description="Location, dates, and session cadence." defaultOpen>
        <FormRow label="Location" htmlFor="location">
          <input
            id="location"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Start date" htmlFor="start-date" width="sm" required>
          <input
            id="start-date"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Times" width="md">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Start</label>
              <TimeSelect value={startTime} onChange={setStartTime} />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Est. end</label>
              <TimeSelect value={estimatedEndTime} onChange={setEstimatedEndTime} />
            </div>
          </div>
        </FormRow>
        {isBox && (
          <>
            <FormRow label="Box size" width="xs" helpText="Players per box. Boxes are formed from the roster by rating.">
              <input type="number" min="3" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} className="w-full input" />
            </FormRow>
            <FormRow label="Cycle length" width="sm" helpText="Weeks per cycle before promotion & relegation.">
              <input type="number" min="1" value={cycleWeeks} onChange={(e) => setCycleWeeks(e.target.value)} className="w-full input" />
            </FormRow>
            <FormRow label="Promote / relegate" width="md" helpText="How many teams move up from each box (and down) at cycle end.">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-brand-muted mb-1">Promote top</label>
                  <input type="number" min="0" value={promoteCount} onChange={(e) => setPromoteCount(e.target.value)} className="w-full input" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-brand-muted mb-1">Relegate bottom</label>
                  <input type="number" min="0" value={relegateCount} onChange={(e) => setRelegateCount(e.target.value)} className="w-full input" />
                </div>
              </div>
            </FormRow>
          </>
        )}
        {!isBox && (
          <>
        <FormRow
          label="Season length"
          width="md"
          helpText="Play days = number of weekly sessions. Games per session controls rounds generated each night."
        >
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-brand-muted mb-1">Play days</label>
              <input type="number" min="1" value={playDays} onChange={(e) => setPlayDays(e.target.value)} className="w-full input" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-brand-muted mb-1">Games / session</label>
              <input type="number" min="1" value={gamesPerSession} onChange={(e) => setGamesPerSession(e.target.value)} className="w-full input" />
            </div>
          </div>
        </FormRow>
        <FormRow
          label="No-play dates"
          width="md"
          helpText="Skip weeks — sessions on these dates won't be scheduled. Existing sessions are not removed automatically."
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="date"
                value={noPlayInput}
                onChange={(e) => setNoPlayInput(e.target.value)}
                className="flex-1 input"
              />
              <button
                type="button"
                onClick={() => {
                  if (!noPlayInput || noPlayDates.includes(noPlayInput)) return
                  setNoPlayDates(prev => [...prev, noPlayInput].sort())
                  setNoPlayInput('')
                }}
                className="px-3 py-1.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
              >
                Add
              </button>
            </div>
            {noPlayDates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {noPlayDates.map(d => {
                  const conflictsWithSession = existingSessionDates.includes(d)
                  return (
                    <span
                      key={d}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        conflictsWithSession
                          ? 'bg-red-50 border border-red-200 text-red-700'
                          : 'bg-amber-50 border border-amber-200 text-amber-800'
                      }`}
                    >
                      {conflictsWithSession && '⚠ '}
                      {formatSessionDate(d)}
                      <button
                        type="button"
                        onClick={() => setNoPlayDates(prev => prev.filter(x => x !== d))}
                        className="ml-0.5 opacity-60 hover:opacity-100"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            {noPlayDates.some(d => existingSessionDates.includes(d)) && (
              <p className="text-xs text-red-600">
                ⚠ One or more skip dates overlap with existing sessions. Those sessions won't be removed automatically — delete them from the Session Manager if needed.
              </p>
            )}
          </div>
        </FormRow>
        {hasNoSessions && (
          <FormRow label="Session preview">
            {generatedDates.length > 0 ? (
              <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-semibold text-brand-dark">
                  {generatedDates.length} sessions · every {dayLabel}
                </p>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {generatedDates.map((d, i) => (
                    <p key={d} className="text-xs text-brand-muted">
                      Play {i + 1} — {formatSessionDate(d)}
                    </p>
                  ))}
                </div>
                <p className="text-xs text-brand-active font-medium">These sessions will be created when you save.</p>
              </div>
            ) : (
              <p className="text-sm text-brand-muted">Set a start date and play days to preview the session schedule.</p>
            )}
          </FormRow>
        )}
        <SessionManager leagueId={leagueId} sessions={sessions} />
          </>
        )}
      </FormSection>

      <FormSection title="Registration" defaultOpen>
        <FormRow label="Status" width="sm">
          <select value={registrationStatus} onChange={(e) => setRegistrationStatus(e.target.value)} className="w-full input">
            {REG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormRow>
        <FormRow label="Max players" htmlFor="max-players" width="xs">
          <input
            id="max-players"
            type="number"
            min="2"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow
          label="Registration deadline"
          htmlFor="reg-closes"
          width="md"
          helpText="Closes automatically at this time (Pacific). Leave blank to manage manually."
        >
          <input
            id="reg-closes"
            type="datetime-local"
            value={registrationClosesAt}
            onChange={(e) => setRegistrationClosesAt(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Entry fee" htmlFor="cost" width="sm" helpText="Leave blank for a free league.">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
            <input
              id="cost"
              type="number"
              min="0"
              step="1"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0"
              className="w-full input pl-7"
            />
          </div>
        </FormRow>
      </FormSection>

      <FormSection title="Publishing" defaultOpen>
        <FormRow label="League status" width="sm">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full input">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormRow>
      </FormSection>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim() || !startDate}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  )
}
