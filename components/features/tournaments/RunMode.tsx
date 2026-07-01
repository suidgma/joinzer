'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import BracketView from './BracketView'
import RunStandings from './RunStandings'
import RunCheckIn from './RunCheckIn'
import RunSchedule from './RunSchedule'
import { readTournament, putMatches, putRegistrations, type TournamentBundle, type StoredMatch } from '@/lib/offline/tournamentDB'
import { precachePages } from '@/lib/offline/precache'
import { enqueueOp } from '@/lib/offline/outbox'
import { reconcile, pendingCount } from '@/lib/offline/reconcile'
import { checkInLocally, resolvePlayoffsLocally, rescheduleLocally } from '@/lib/offline/localOps'
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '@/lib/tournament/standings'

type AnyRow = { id: string; [k: string]: any }
type LoadState = 'loading' | 'ready' | 'empty' | 'error'
type View = 'matches' | 'standings' | 'checkin' | 'schedule'

function firstName(name: string | null | undefined): string {
  return name ? name.trim().split(/\s+/)[0] : ''
}

// Offline-first day-of view: hydrate the whole tournament while online, then read AND write it
// entirely from IndexedDB — scores, check-ins, playoff seeding and reschedules all apply locally
// and queue in the outbox to replay on reconnect. See docs/phases/offline-run-mode-phase-2.md.
export default function RunMode({ tournamentId }: { tournamentId: string }) {
  const isOnline = useOnlineStatus()
  const [bundle, setBundle] = useState<TournamentBundle | null>(null)
  const bundleRef = useRef<TournamentBundle | null>(null)
  // Option 1 (docs/phases/offline-multi-device-phase-3.md): offline writes belong to the LEAD
  // organizer alone — one offline writer per tournament. Non-leads get a read-only run surface.
  const canWriteRef = useRef(false)
  const [status, setStatus] = useState<LoadState>('loading')
  const [activeDiv, setActiveDiv] = useState<string | null>(null)
  const [view, setView] = useState<View>('matches')
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    bundleRef.current = bundle
    canWriteRef.current = !!(bundle?.tournament as AnyRow | undefined)?.is_lead_organizer
  }, [bundle])

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount(tournamentId))
  }, [tournamentId])

  // Drain every queued write (scores then outbox), then bulk-refetch + replace the store and
  // re-render in place — no page reload. Used on mount-online, the `online` event, and Sync now.
  const runReconcile = useCallback(async () => {
    setSyncing(true)
    try {
      const r = await reconcile(tournamentId)
      if (r.bundle) {
        setBundle(r.bundle)
        setActiveDiv(prev => (prev && r.bundle!.divisions.some(d => d.id === prev) ? prev : r.bundle!.divisions[0]?.id ?? null))
      }
      setPending(r.pending)
    } finally {
      setSyncing(false)
    }
  }, [tournamentId])

  useEffect(() => {
    let cancelled = false
    const settle = (b: TournamentBundle | null) => {
      if (cancelled) return
      if (!b) { setStatus('empty'); return }
      setBundle(b)
      setActiveDiv(prev => prev ?? b.divisions[0]?.id ?? null)
      setStatus(b.divisions.length ? 'ready' : 'empty')
    }
    ;(async () => {
      try {
        if (navigator.onLine) {
          precachePages([`/tournaments/${tournamentId}/run`])
          // Reconcile on entry: drain any writes from a prior offline session BEFORE refetching, so
          // a bulk-refetch can't clobber un-synced local changes; then settle the fresh store.
          const r = await reconcile(tournamentId)
          if (!cancelled) { settle(r.bundle ?? await readTournament(tournamentId)); setPending(r.pending) }
          return
        }
        settle(await readTournament(tournamentId))
        refreshPending()
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [tournamentId, refreshPending])

  // On reconnect, reconcile everything (scores + outbox) and re-render from the fresh store.
  useEffect(() => {
    const onOnline = () => { runReconcile() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [runReconcile])

  const division = useMemo(
    () => bundle?.divisions.find(d => d.id === activeDiv) as AnyRow | undefined,
    [bundle, activeDiv],
  )
  const divMatches = useMemo(
    () => (bundle?.matches ?? []).filter(m => m.division_id === activeDiv),
    [bundle, activeDiv],
  )
  const divRegs = useMemo(
    () => (bundle?.registrations ?? []).filter((r: AnyRow) => r.division_id === activeDiv) as AnyRow[],
    [bundle, activeDiv],
  )
  const activeRegs = useMemo(() => divRegs.filter(r => r.status === 'registered'), [divRegs])

  const teamName = useCallback((regId: string | null | undefined) => {
    if (!regId) return '—'
    const r = divRegs.find(x => x.id === regId)
    if (!r) return '—'
    const a = firstName(r.user_profile?.name)
    if (r.partner_registration_id) {
      const p = divRegs.find(x => x.id === r.partner_registration_id)
      const b = firstName(p?.user_profile?.name)
      if (a && b) return [a, b].sort((m, n) => m.localeCompare(n)).join('/')
    }
    return a || r.team_name || regId.slice(0, 8)
  }, [divRegs])

  const standings = useMemo(() => {
    if (!division) return []
    const bt = division.bracket_type as string
    const base = bt === 'round_robin' ? divMatches.filter(m => m.match_stage === 'round_robin')
      : bt === 'pool_play_playoffs' ? divMatches.filter(m => m.match_stage === 'pool_play')
      : divMatches
    return computeStandings(base as unknown as StandingsMatchInput[], divRegs as unknown as StandingsRegInput[], teamName)
  }, [division, divMatches, divRegs, teamName])

  // "Seed playoffs" is available once base play is complete but the placeholder bracket is still
  // holding source tokens instead of teams.
  const canSeedPlayoffs = useMemo(() => {
    const bt = division?.bracket_type
    if (bt !== 'round_robin' && bt !== 'pool_play_playoffs') return false
    const baseStage = bt === 'round_robin' ? 'round_robin' : 'pool_play'
    const base = divMatches.filter(m => m.match_stage === baseStage)
    const allDone = base.length > 0 && base.every(m => m.status === 'completed')
    const hasUnseeded = divMatches.some(m => m.team_1_source != null || m.team_2_source != null)
    return allDone && hasUnseeded
  }, [division, divMatches])

  // ── Writes: apply to state + store, enqueue the intent ──────────────────────────
  const applyScored = useCallback((changed: AnyRow[]) => {
    if (!canWriteRef.current) return
    const b = bundleRef.current
    if (!b || !changed?.length) return
    const byId = new Map(changed.map(m => [m.id, m]))
    const seen = new Set<string>()
    const matches = b.matches.map(m => {
      if (!byId.has(m.id)) return m
      seen.add(m.id)
      return { ...m, ...byId.get(m.id) } as StoredMatch
    })
    // New rows (e.g. a double-elim reset decider) aren't in the store yet — append them so the
    // local bracket stays complete until the next hydrate reconciles server ids.
    for (const c of changed) {
      if (seen.has(c.id)) continue
      matches.push({ tournament_id: tournamentId, division_id: activeDiv, ...c } as StoredMatch)
    }
    setBundle({ ...b, matches })
    putMatches(matches.filter(m => byId.has(m.id))).catch(() => {})
    refreshPending()
  }, [tournamentId, activeDiv, refreshPending])

  const toggleCheckIn = useCallback(async (regId: string, checkedIn: boolean) => {
    if (!canWriteRef.current) return
    const b = bundleRef.current
    if (!b) return
    const registrations = checkInLocally(b.registrations as AnyRow[], regId, checkedIn)
    setBundle({ ...b, registrations: registrations as TournamentBundle['registrations'] })
    const reg = registrations.find(r => r.id === regId)
    if (reg) await putRegistrations([reg])
    await enqueueOp({
      url: `/api/tournaments/${tournamentId}/registrations/${regId}/checkin`,
      method: 'PATCH',
      body: JSON.stringify({ checked_in: checkedIn }),
      dedupeKey: `checkin:${regId}`,
    })
    refreshPending()
  }, [tournamentId, refreshPending])

  const doReschedule = useCallback(async (matchId: string, courtNumber: number | null, scheduledTime: string | null) => {
    if (!canWriteRef.current) return
    const b = bundleRef.current
    if (!b) return
    const matches = rescheduleLocally(b.matches, matchId, courtNumber, scheduledTime)
    setBundle({ ...b, matches })
    const m = matches.find(x => x.id === matchId)
    if (m) await putMatches([m])
    await enqueueOp({
      url: `/api/tournaments/${tournamentId}/matches/${matchId}/reschedule`,
      method: 'PATCH',
      body: JSON.stringify({ court_number: courtNumber, scheduled_time: scheduledTime }),
      dedupeKey: `reschedule:${matchId}`,
    })
    refreshPending()
  }, [tournamentId, refreshPending])

  const seedPlayoffs = useCallback(async () => {
    if (!canWriteRef.current) return
    const b = bundleRef.current
    if (!b || !division) return
    const divId = division.id
    const seededDiv = resolvePlayoffsLocally(
      b.matches.filter(m => m.division_id === divId) as any[],
      b.registrations.filter((r: AnyRow) => r.division_id === divId) as unknown as StandingsRegInput[],
      division.bracket_type,
      teamName,
    ) as StoredMatch[]
    const byId = new Map(seededDiv.map(m => [m.id, m]))
    const matches = b.matches.map(m => byId.get(m.id) ?? m)
    setBundle({ ...b, matches })
    await putMatches(seededDiv)
    await enqueueOp({
      url: `/api/tournaments/${tournamentId}/divisions/${divId}/resolve-playoffs`,
      method: 'POST',
      body: JSON.stringify({}),
      dedupeKey: `resolve:${divId}`,
    })
    refreshPending()
  }, [tournamentId, division, teamName, refreshPending])

  if (status !== 'ready' || !bundle) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
          <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Exit run mode</Link>
          {status === 'loading' && <p className="text-sm text-brand-muted">Loading tournament…</p>}
          {status === 'empty' && <p className="text-sm text-brand-muted">Open this tournament once with a connection to make it available offline.</p>}
          {status === 'error' && (
            <p className="text-sm text-red-600">
              {isOnline ? 'Couldn’t load the tournament — try again.' : 'You’re offline and this tournament isn’t saved on this device yet.'}
            </p>
          )}
        </div>
      </div>
    )
  }

  const isBracket = division?.bracket_type === 'single_elimination' || division?.bracket_type === 'double_elimination'
  const isDoubles = isDoublesFormat(division?.format ?? '')
  const pointsToWin = (division?.format_settings_json as AnyRow)?.games_to ?? 11
  const canWrite = !!(bundle.tournament as AnyRow).is_lead_organizer

  const TABS: [View, string][] = [
    ['matches', isBracket ? 'Bracket' : 'Matches'],
    ['standings', 'Standings'],
    ['checkin', 'Check-in'],
    ['schedule', 'Schedule'],
  ]

  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Exit run mode</Link>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isOnline ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-800'}`}>
            {isOnline ? 'Online' : '📴 Offline'}
          </span>
        </div>

        <div>
          <h1 className="font-heading text-lg font-bold text-brand-dark">{String(bundle.tournament.name)}</h1>
          <p className="text-xs text-brand-muted">Run mode{canWrite ? '' : ' · read-only'}</p>
        </div>

        {!canWrite && (
          <div className="rounded-xl border border-brand-border bg-brand-soft/60 px-3 py-2.5">
            <p className="text-xs font-semibold text-brand-dark">Read-only — you’re not the lead organizer</p>
            <p className="text-xs text-brand-muted mt-0.5">
              Running a tournament offline is the lead organizer’s device only.{' '}
              {isOnline ? 'To score or check players in, use the ' : 'Reconnect, then use the '}
              <Link href={`/tournaments/${tournamentId}/live`} className="font-semibold text-brand-active underline">live tournament view</Link>.
            </p>
          </div>
        )}

        {pending > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-border bg-brand-surface px-3 py-2">
            <span className="text-xs text-brand-muted">
              {pending} {pending === 1 ? 'change' : 'changes'} waiting to sync
            </span>
            {isOnline && (
              <button onClick={runReconcile} disabled={syncing}
                className="flex items-center gap-1 text-xs font-semibold text-brand-active disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        )}

        {/* Division tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {bundle.divisions.map((d: AnyRow) => (
            <button
              key={d.id}
              onClick={() => setActiveDiv(d.id)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                activeDiv === d.id ? 'bg-brand text-brand-dark border-brand' : 'bg-brand-surface text-brand-muted border-brand-border'
              }`}
            >
              {String(d.name)}
            </button>
          ))}
        </div>

        {division && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-1 bg-white rounded-full border border-brand-border p-0.5 w-fit">
              {TABS.map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors ${view === v ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'}`}>
                  {label}
                </button>
              ))}
            </div>

            {view === 'standings' && <RunStandings rows={standings} teamName={teamName} />}

            {view === 'checkin' && <RunCheckIn regs={activeRegs} teamName={teamName} onToggle={toggleCheckIn} readOnly={!canWrite} />}

            {view === 'schedule' && <RunSchedule matches={divMatches as AnyRow[]} teamName={teamName} onReschedule={doReschedule} readOnly={!canWrite} />}

            {view === 'matches' && (
              <div className="space-y-3">
                {canWrite && canSeedPlayoffs && (
                  <button onClick={seedPlayoffs}
                    className="w-full rounded-xl bg-brand text-brand-dark text-sm font-bold py-2.5">
                    Seed playoffs from standings
                  </button>
                )}
                <BracketView
                  matches={divMatches as AnyRow[] as any}
                  regs={divRegs.map(r => ({
                    id: r.id, user_id: r.user_id, team_name: r.team_name ?? null, status: r.status,
                    seed: r.seed ?? null,
                    user_profile: r.user_profile ?? null,
                    partner_user_id: r.partner_user_id ?? null,
                    partner_profile: r.partner_profile ?? null,
                  }))}
                  isOrganizer={canWrite}
                  isDoubles={isDoubles}
                  tournamentId={tournamentId}
                  divisionId={division.id}
                  onScoreUpdate={applyScored}
                  listLayout={!isBracket}
                  pointsToWin={pointsToWin}
                  externalSync
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
