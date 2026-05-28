'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { LocationOption } from '@/lib/types'
import { prepareLeagueWrite } from '@/lib/taxonomy/write-helpers'
import { formatSessionDate } from '@/lib/utils/date'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import TimeSelect from '@/components/features/events/TimeSelect'

const FORMAT_OPTIONS = [
  { value: 'individual_round_robin', label: 'Individual Round Robin' },
  { value: 'mens_doubles', label: "Men's Doubles" },
  { value: 'womens_doubles', label: "Women's Doubles" },
  { value: 'mixed_doubles', label: 'Mixed Doubles' },
  { value: 'coed_doubles', label: 'Coed Doubles' },
  { value: 'open_singles', label: 'Singles' },
  { value: 'custom', label: 'Custom' },
]

const SKILL_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'beginner_plus', label: 'Beginner+' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'intermediate_plus', label: 'Intermediate+' },
  { value: 'advanced', label: 'Advanced' },
]

const REG_OPTIONS = [
  { value: 'upcoming', label: 'Coming Soon' },
  { value: 'open', label: 'Open' },
  { value: 'waitlist_only', label: 'Waitlist Only' },
  { value: 'closed', label: 'Closed' },
]

// Append Pacific offset to a datetime-local string (YYYY-MM-DDTHH:mm) for DB storage
function ptLocalToIso(local: string): string {
  const month = parseInt(local.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${local}:00${ptOffset}`
}

export default function CreateLeagueForm({ locations }: { locations: LocationOption[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('mixed_doubles')
  const [skillLevel, setSkillLevel] = useState('intermediate')
  const [locationId, setLocationId] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [estimatedEndTime, setEstimatedEndTime] = useState('17:00')
  const [startDate, setStartDate] = useState('')
  const [registrationClosesAt, setRegistrationClosesAt] = useState('')
  const [deadlineTouched, setDeadlineTouched] = useState(false)

  const [playDays, setPlayDays] = useState('7')
  const [gamesPerSession, setGamesPerSession] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('')
  const [registrationStatus, setRegistrationStatus] = useState('upcoming')
  const [description, setDescription] = useState('')
  const [pointsToWin, setPointsToWin] = useState('11')
  const [winBy, setWinBy] = useState<1 | 2>(1)
  const [subCreditCap, setSubCreditCap] = useState('7')
  const [costDollars, setCostDollars] = useState('')
  const [standingsMethod, setStandingsMethod] = useState<'win_loss' | 'total_points'>('win_loss')
  const [noPlayDates, setNoPlayDates] = useState<string[]>([])
  const [noPlayInput, setNoPlayInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedLocation = locations.find((l) => l.id === locationId)

  const pointsToWinNum = parseInt(pointsToWin) || 11

  // Auto-set deadline to 7 days before league start date at 23:59 PT when startDate changes
  useEffect(() => {
    if (!deadlineTouched && startDate) {
      const d = new Date(startDate + 'T00:00:00')
      d.setDate(d.getDate() - 7)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      setRegistrationClosesAt(`${yyyy}-${mm}-${dd}T23:59`)
    }
  }, [startDate, deadlineTouched])

  function handlePointsToWinChange(val: string) {
    setPointsToWin(val)
    const max = parseInt(val) || 11
    if (parseInt(subCreditCap) > max) setSubCreditCap(String(max))
  }

  // Cursor-based weekly date generator. Advances one week at a time; dates in
  // skipDates are bypassed without consuming a session slot, so the season end
  // extends by the number of skipped weeks. Cap prevents infinite loop if the
  // skip list somehow covers every candidate week.
  function generateDates(start: string, count: number, skipDates: Set<string> = new Set()): string[] {
    if (!start || !count || count < 1) return []
    const dates: string[] = []
    const cursor = new Date(start + 'T00:00:00')
    const maxWeeks = count * 3
    let weeksAdvanced = 0
    while (dates.length < count && weeksAdvanced < maxWeeks) {
      const dateStr = cursor.toISOString().slice(0, 10)
      if (!skipDates.has(dateStr)) dates.push(dateStr)
      cursor.setDate(cursor.getDate() + 7)
      weeksAdvanced++
    }
    return dates
  }

  function addNoPlayDate() {
    if (!noPlayInput || noPlayDates.includes(noPlayInput)) return
    setNoPlayDates(prev => [...prev, noPlayInput].sort())
    setNoPlayInput('')
  }

  function removeNoPlayDate(date: string) {
    setNoPlayDates(prev => prev.filter(d => d !== date))
  }

  const generatedDates = generateDates(startDate, parseInt(playDays) || 0, new Set(noPlayDates))
  const lastDate = generatedDates[generatedDates.length - 1] ?? ''

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayLabel = startDate ? DAYS[new Date(startDate + 'T00:00:00').getDay()] : ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Commit any date sitting in the input that the organizer forgot to Add.
    // Derive synchronously — setNoPlayDates won't flush before the INSERT reads noPlayDates.
    // Commit any date sitting in the input that the organizer forgot to Add.
    // Derive synchronously — setNoPlayDates won't flush before the INSERT reads noPlayDates.
    const finalNoPlayDates = noPlayInput && !noPlayDates.includes(noPlayInput)
      ? [...noPlayDates, noPlayInput].sort()
      : noPlayDates
    const submitDates = generateDates(startDate, parseInt(playDays) || 0, new Set(finalNoPlayDates))

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .insert({
        name: name.trim(),
        ...prepareLeagueWrite({ format, skill_level: skillLevel }),
        location_name: selectedLocation?.name ?? null,
        location_id: locationId || null,
        start_time: startTime || null,
        estimated_end_time: estimatedEndTime || null,
        start_date: startDate || null,
        end_date: submitDates[submitDates.length - 1] ?? lastDate ?? null,
        play_days: playDays ? parseInt(playDays) : null,
        games_per_session: gamesPerSession ? parseInt(gamesPerSession) : null,
        max_players: maxPlayers ? parseInt(maxPlayers) : null,
        registration_status: registrationStatus,
        registration_closes_at: registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null,
        description: description.trim() || null,
        points_to_win: pointsToWinNum,
        win_by: winBy,
        sub_credit_cap: parseInt(subCreditCap) || 7,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        standings_method: standingsMethod,
        no_play_dates: finalNoPlayDates,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (leagueErr || !league) {
      setError(leagueErr?.message ?? 'Failed to create league')
      setLoading(false)
      return
    }

    if (submitDates.length > 0) {
      const roundsPerSession = gamesPerSession ? parseInt(gamesPerSession) : 7
      const rows = submitDates.map((d, i) => ({
        league_id: league.id,
        session_date: d,
        session_number: i + 1,
        rounds_planned: roundsPerSession,
      }))
      await supabase.from('league_sessions').insert(rows)
    }

    router.push(`/leagues/${league.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="League Name *">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wednesday Night Mixed Doubles" className="w-full input" />
      </Field>

      <Field label="Format *">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full input">
          {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {isDoublesFormat(format) && (
          <p className="mt-2 text-[11px] text-brand-muted leading-relaxed">
            <strong className="text-brand-dark">Partners rotate each match.</strong>{' '}
            The scheduler pairs players with a different partner every round to maximize variety.
            Fixed-team mode (same partner all season) is on the roadmap — let us know if your players want it.
          </p>
        )}
      </Field>

      <Field label="Skill Level *">
        <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} className="w-full input">
          {SKILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Registration Status">
        <select value={registrationStatus} onChange={(e) => setRegistrationStatus(e.target.value)} className="w-full input">
          {REG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Location">
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full input">
          <option value="">— Select a location —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.subarea ? ` (${l.subarea})` : ''} · {l.court_count} courts
            </option>
          ))}
        </select>
      </Field>

      <Field label="Start Date">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" />
      </Field>

      <Field label="Times">
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
      </Field>

      <Field label="Registration deadline" hint="Closes automatically at this time (Pacific). Auto-set to 7 days before start. Leave blank to manage manually.">
        <input
          type="datetime-local"
          value={registrationClosesAt}
          onChange={(e) => { setRegistrationClosesAt(e.target.value); setDeadlineTouched(true) }}
          className="w-full input"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Play Days">
          <input type="number" min="1" value={playDays} onChange={(e) => setPlayDays(e.target.value)} placeholder="8" className="w-full input" />
        </Field>
        <Field label="Games/Play">
          <input type="number" min="1" value={gamesPerSession} onChange={(e) => setGamesPerSession(e.target.value)} placeholder="7" className="w-full input" />
        </Field>
        <Field label="Max Players">
          <input type="number" min="2" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="16" className="w-full input" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Points to Win">
          <input
            type="number"
            min="1"
            value={pointsToWin}
            onChange={(e) => handlePointsToWinChange(e.target.value)}
            placeholder="11"
            className="w-full input"
          />
        </Field>
        <Field label="Win By">
          <div className="flex rounded-xl overflow-hidden border border-brand-border h-[38px]">
            <button
              type="button"
              onClick={() => setWinBy(1)}
              className={`flex-1 text-sm font-medium transition-colors ${winBy === 1 ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
            >
              Win by 1
            </button>
            <button
              type="button"
              onClick={() => setWinBy(2)}
              className={`flex-1 text-sm font-medium transition-colors ${winBy === 2 ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
            >
              Win by 2
            </button>
          </div>
        </Field>
      </div>

      <Field label="Sub Credit Cap" hint="Max points credited to an absent player when a sub plays in their place.">
        <select value={subCreditCap} onChange={(e) => setSubCreditCap(e.target.value)} className="w-full input">
          {Array.from({ length: pointsToWinNum }, (_, i) => i + 1).map((n) => (
            <option key={n} value={String(n)}>{n}{n === 7 && pointsToWinNum >= 7 ? ' (default)' : ''}</option>
          ))}
        </select>
      </Field>

      <Field label="No-play dates" hint="Sessions that fall on these dates shift forward one week. Season end extends by the number of skips.">
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
              onClick={addNoPlayDate}
              disabled={!noPlayInput || noPlayDates.includes(noPlayInput)}
              className="px-3 py-2 rounded-xl bg-brand text-brand-dark text-sm font-medium hover:bg-brand-hover disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
          {noPlayDates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {noPlayDates.map(d => (
                <span key={d} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                  {formatSessionDate(d)}
                  <button type="button" onClick={() => removeNoPlayDate(d)} className="text-amber-600 hover:text-amber-900 leading-none ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Field>

      {/* Auto-generated schedule preview */}
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
        </div>
      ) : (
        <p className="text-xs text-brand-muted">Set a start date and number of play days to auto-generate the session schedule.</p>
      )}

      <Field label="Standings Method">
        <div className="flex rounded-xl overflow-hidden border border-brand-border h-[38px]">
          <button
            type="button"
            onClick={() => setStandingsMethod('win_loss')}
            className={`flex-1 text-sm font-medium transition-colors ${standingsMethod === 'win_loss' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
          >
            Win-Loss
          </button>
          <button
            type="button"
            onClick={() => setStandingsMethod('total_points')}
            className={`flex-1 text-sm font-medium transition-colors ${standingsMethod === 'total_points' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
          >
            Total Points
          </button>
        </div>
      </Field>

      <Field label="Registration Fee (optional)" hint="Leave blank for free. Players pay via Stripe at registration.">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
          <input
            type="number"
            min="0"
            step="1"
            value={costDollars}
            onChange={(e) => setCostDollars(e.target.value)}
            placeholder="0"
            className="w-full input pl-7"
          />
        </div>
      </Field>

      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Additional details about the league…" className="w-full input resize-none" />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Creating…' : 'Create League'}
      </button>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-brand-dark mb-1">{label}</label>
      {hint && <p className="text-xs text-brand-muted mb-1">{hint}</p>}
      {children}
    </div>
  )
}
