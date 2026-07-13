'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FlexMatchView } from '@/lib/leagues/flexView'

// A self-scheduled time is a wall-clock value — format it in UTC so it reads back
// exactly as entered (no timezone shift).
function fmtSchedule(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// A registered player's own Flex matches: report a score, or confirm/dispute what the
// opponent reported. Scores are shown from the viewer's perspective (you first).
export default function FlexPlayerMatches({ leagueId, matches }: { leagueId: string; matches: FlexMatchView[] }) {
  const router = useRouter()
  const mine = matches.filter((m) => m.viewerSide != null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, { you: string; opp: string }>>({})
  const [schedId, setSchedId] = useState<string | null>(null)
  const [schedTime, setSchedTime] = useState('')
  const [schedCourt, setSchedCourt] = useState('')

  if (mine.length === 0) return null

  function openSched(m: FlexMatchView) {
    setError(null)
    if (schedId === m.id) { setSchedId(null); return }
    setSchedId(m.id)
    setSchedTime(m.scheduledTime ? m.scheduledTime.slice(0, 16) : '')
    setSchedCourt(m.court != null ? String(m.court) : '')
  }

  async function saveSchedule(id: string) {
    setBusy(id + 'sched'); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/flex/fixtures/${id}/schedule`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledTime: schedTime || null, court: schedCourt || null }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Could not save the time'); return }
      setSchedId(null)
      router.refresh()
    } catch { setError('Network error') } finally { setBusy(null) }
  }

  const setScore = (id: string, k: 'you' | 'opp', v: string) =>
    setScores((p) => ({ ...p, [id]: { ...(p[id] ?? { you: '', opp: '' }), [k]: v.replace(/[^0-9]/g, '') } }))

  async function call(id: string, action: 'report' | 'confirm' | 'dispute', body?: unknown) {
    setBusy(id + action); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/flex/fixtures/${id}/${action}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Something went wrong'); return }
      setEditing(null)
      router.refresh()
    } catch { setError('Network error') } finally { setBusy(null) }
  }

  function report(m: FlexMatchView) {
    const s = scores[m.id]
    if (!s || s.you === '' || s.opp === '') { setError('Enter both scores'); return }
    const you = Number(s.you), opp = Number(s.opp)
    const team_1_score = m.viewerSide === 'team_1' ? you : opp
    const team_2_score = m.viewerSide === 'team_1' ? opp : you
    call(m.id, 'report', { team_1_score, team_2_score })
  }

  const persp = (m: FlexMatchView) => {
    const you = m.viewerSide === 'team_1' ? m.team1Score : m.team2Score
    const opp = m.viewerSide === 'team_1' ? m.team2Score : m.team1Score
    const oppName = m.viewerSide === 'team_1' ? m.side2Name : m.side1Name
    const iReported = m.reporterSide != null && m.reporterSide === m.viewerSide
    const iWon = m.winner1 == null ? null : (m.winner1 === (m.viewerSide === 'team_1'))
    return { you, opp, oppName, iReported, iWon }
  }

  return (
    <div className="space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Your matches</h2>
      <p className="text-xs text-brand-muted">Arrange each match with your opponent, then report the score. They confirm it.</p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="space-y-2">
        {mine.map((m) => {
          const { you, opp, oppName, iReported, iWon } = persp(m)
          const inputs = (
            <div className="flex items-center gap-2">
              <input inputMode="numeric" value={scores[m.id]?.you ?? ''} onChange={(e) => setScore(m.id, 'you', e.target.value)} placeholder="You" className="w-14 rounded-lg border border-brand-border px-2 py-1.5 text-sm text-center" aria-label="Your score" />
              <span className="text-xs text-brand-muted">–</span>
              <input inputMode="numeric" value={scores[m.id]?.opp ?? ''} onChange={(e) => setScore(m.id, 'opp', e.target.value)} placeholder={oppName} className="w-14 rounded-lg border border-brand-border px-2 py-1.5 text-sm text-center" aria-label="Opponent score" />
              <button onClick={() => report(m)} disabled={busy === m.id + 'report'} className="ml-auto bg-brand text-brand-dark rounded-lg text-xs font-semibold px-3 py-1.5 hover:bg-brand-hover disabled:opacity-50">Report</button>
            </div>
          )
          return (
            <div key={m.id} className="border border-brand-border rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-brand-dark truncate">vs {oppName}</span>
                {m.round != null && <span className="text-[11px] text-brand-muted shrink-0">Round {m.round}</span>}
              </div>

              {/* Self-scheduling — agree a time + court with your opponent */}
              {(m.status === 'scheduled' || m.status === 'in_progress') && (
                schedId === m.id ? (
                  <div className="flex flex-wrap items-center gap-2 bg-brand-soft/40 rounded-lg p-2">
                    <input type="datetime-local" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className="rounded-lg border border-brand-border px-2 py-1.5 text-sm" aria-label="Match time" />
                    <input inputMode="numeric" value={schedCourt} onChange={(e) => setSchedCourt(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Court" className="w-16 rounded-lg border border-brand-border px-2 py-1.5 text-sm" aria-label="Court" />
                    <button onClick={() => saveSchedule(m.id)} disabled={busy === m.id + 'sched'} className="bg-brand text-brand-dark rounded-lg text-xs font-semibold px-3 py-1.5 hover:bg-brand-hover disabled:opacity-50">Save</button>
                    <button onClick={() => setSchedId(null)} className="text-xs text-brand-muted">Cancel</button>
                  </div>
                ) : m.scheduledTime ? (
                  <button onClick={() => openSched(m)} className="text-xs text-brand-muted hover:text-brand-dark">
                    📅 {fmtSchedule(m.scheduledTime)}{m.court ? ` · Court ${m.court}` : ''} · Change
                  </button>
                ) : (
                  <button onClick={() => openSched(m)} className="text-xs text-brand-active font-medium">+ Set match time</button>
                )
              )}

              {m.status === 'scheduled' && (editing === m.id ? inputs : (
                <button onClick={() => setEditing(m.id)} className="text-sm font-semibold text-brand-active">Report score →</button>
              ))}

              {m.status === 'in_progress' && iReported && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-brand-muted">You reported <span className="font-semibold text-brand-dark tabular-nums">{you}–{opp}</span> · waiting for {oppName} to confirm</span>
                  {editing === m.id ? inputs : <button onClick={() => setEditing(m.id)} className="text-xs text-brand-active font-medium shrink-0">Edit</button>}
                </div>
              )}

              {m.status === 'in_progress' && !iReported && (
                <div className="space-y-2">
                  <span className="text-sm text-brand-dark">{oppName} reported <span className="font-semibold tabular-nums">{you}–{opp}</span> (your score first)</span>
                  <div className="flex gap-2">
                    <button onClick={() => call(m.id, 'confirm')} disabled={busy === m.id + 'confirm'} className="bg-brand text-brand-dark rounded-lg text-xs font-semibold px-3 py-1.5 hover:bg-brand-hover disabled:opacity-50">Confirm</button>
                    <button onClick={() => call(m.id, 'dispute')} disabled={busy === m.id + 'dispute'} className="border border-red-300 text-red-600 rounded-lg text-xs font-semibold px-3 py-1.5 hover:bg-red-50 disabled:opacity-50">Dispute</button>
                  </div>
                </div>
              )}

              {m.status === 'completed' && (
                <span className={`text-sm font-semibold ${iWon ? 'text-green-700' : 'text-brand-muted'}`}>{iWon ? 'Won' : 'Lost'} <span className="tabular-nums">{you}–{opp}</span></span>
              )}

              {m.status === 'disputed' && (
                <span className="text-sm text-red-600">Disputed — the organizer will resolve this.</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
