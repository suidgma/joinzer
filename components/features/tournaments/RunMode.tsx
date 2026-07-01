'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import BracketView from './BracketView'
import { readTournament, type TournamentBundle } from '@/lib/offline/tournamentDB'
import { hydrateFromServer } from '@/lib/offline/hydrate'
import { precachePages } from '@/lib/offline/precache'
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '@/lib/tournament/standings'

type AnyRow = Record<string, any>
type LoadState = 'loading' | 'ready' | 'empty' | 'error'

function firstName(name: string | null | undefined): string {
  return name ? name.trim().split(/\s+/)[0] : ''
}

// Offline-first day-of view: hydrate the whole tournament while online, then read it (and,
// after Step 4, write to it) entirely from IndexedDB — so it cold-loads with no signal.
export default function RunMode({ tournamentId }: { tournamentId: string }) {
  const isOnline = useOnlineStatus()
  const [bundle, setBundle] = useState<TournamentBundle | null>(null)
  const [status, setStatus] = useState<LoadState>('loading')
  const [activeDiv, setActiveDiv] = useState<string | null>(null)
  const [view, setView] = useState<'matches' | 'standings'>('matches')

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
          const fresh = await hydrateFromServer(tournamentId)
          precachePages([`/tournaments/${tournamentId}/run`])
          if (fresh) return settle(fresh)
        }
        settle(await readTournament(tournamentId))
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [tournamentId])

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

  const teamName = (regId: string) => {
    const r = divRegs.find(x => x.id === regId)
    if (!r) return '—'
    const a = firstName(r.user_profile?.name)
    if (r.partner_registration_id) {
      const p = divRegs.find(x => x.id === r.partner_registration_id)
      const b = firstName(p?.user_profile?.name)
      if (a && b) return [a, b].sort((m, n) => m.localeCompare(n)).join('/')
    }
    return a || r.team_name || regId.slice(0, 8)
  }

  const standings = useMemo(() => {
    if (!division) return []
    const bt = division.bracket_type as string
    const base = bt === 'round_robin' ? divMatches.filter(m => m.match_stage === 'round_robin')
      : bt === 'pool_play_playoffs' ? divMatches.filter(m => m.match_stage === 'pool_play')
      : divMatches
    return computeStandings(base as unknown as StandingsMatchInput[], divRegs as unknown as StandingsRegInput[], teamName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division, divMatches, divRegs])

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
          <p className="text-xs text-brand-muted">Run mode · read-only preview</p>
        </div>

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
              {([['matches', isBracket ? 'Bracket' : 'Matches'], ['standings', 'Standings']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors ${view === v ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'}`}>
                  {label}
                </button>
              ))}
            </div>

            {view === 'standings' ? (
              <div className="overflow-hidden rounded-xl border border-brand-border">
                <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-[10px] font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border">
                  <span>#</span><span>Team</span><span className="text-center">W</span><span className="text-center">L</span><span className="text-center">PF</span><span className="text-center">+/−</span>
                </div>
                {standings.map((row, i) => {
                  const diff = row.pf - row.pa
                  return (
                    <div key={row.regId} className={`grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-xs border-b border-brand-border last:border-0 ${i === 0 ? 'bg-brand-soft' : ''}`}>
                      <span className="text-brand-muted font-medium">{i + 1}</span>
                      <span className="font-semibold text-brand-dark truncate">{teamName(row.regId)}</span>
                      <span className="text-center font-bold text-brand-dark">{row.wins}</span>
                      <span className="text-center text-brand-dark">{row.losses}</span>
                      <span className="text-center text-brand-muted">{row.pf}</span>
                      <span className={`text-center font-bold tabular-nums ${diff >= 0 ? 'text-brand-active' : 'text-red-600'}`}>{diff >= 0 ? '+' : ''}{diff}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <BracketView
                matches={divMatches as AnyRow[] as any}
                regs={divRegs.map(r => ({
                  id: r.id, user_id: r.user_id, team_name: r.team_name ?? null, status: r.status,
                  seed: r.seed ?? null,
                  user_profile: r.user_profile ?? null,
                  partner_user_id: r.partner_user_id ?? null,
                  partner_profile: r.partner_profile ?? null,
                }))}
                isOrganizer={false}
                isDoubles={isDoubles}
                tournamentId={tournamentId}
                divisionId={division.id}
                onScoreUpdate={() => {}}
                listLayout={!isBracket}
                pointsToWin={pointsToWin}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
