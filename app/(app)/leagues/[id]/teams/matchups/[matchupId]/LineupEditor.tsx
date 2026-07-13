'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Player = { registrationId: string; name: string }
type TeamSide = { name: string; roster: Player[] }
type LineConfig = { label: string; discipline: 'singles' | 'doubles' }
type LineSlots = { team1: string[]; team2: string[] }

// Per-line player assignment for a team matchup. The organizer edits BOTH sides (Save
// replaces the child line fixtures). A captain (side = 1 | 2) edits only their own team's
// half; Save fills just that side's columns and the opponent's captain sets theirs.
export default function LineupEditor({
  leagueId,
  matchupId,
  lines,
  team1,
  team2,
  initialLineup,
  readOnly,
  side,
}: {
  leagueId: string
  matchupId: string
  lines: LineConfig[]
  team1: TeamSide
  team2: TeamSide
  initialLineup: LineSlots[]
  readOnly: boolean
  side?: 1 | 2
}) {
  const router = useRouter()
  const [lineup, setLineup] = useState<LineSlots[]>(initialLineup)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const mySideKey: 'team1' | 'team2' | null = side ? (side === 1 ? 'team1' : 'team2') : null

  function setSlot(lineIdx: number, sideKey: 'team1' | 'team2', slot: number, value: string) {
    setSaved(false)
    setLineup((prev) =>
      prev.map((l, i) => {
        if (i !== lineIdx) return l
        const next = [...l[sideKey]]
        if (value) next[slot] = value
        else next.splice(slot, 1)
        return { ...l, [sideKey]: next.filter(Boolean) }
      }),
    )
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = mySideKey ? { side, lines: lineup.map((l) => ({ players: l[mySideKey] })) } : { lines: lineup }
      const res = await fetch(`/api/leagues/${leagueId}/teams/matchups/${matchupId}/lineup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Failed to save lineup')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  if (lines.length === 0) {
    return <p className="text-sm text-brand-muted">This league has no line configuration. Set it on the league Edit page.</p>
  }

  const slotSelect = (lineIdx: number, sideKey: 'team1' | 'team2', slot: number, roster: Player[]) => {
    const value = lineup[lineIdx]?.[sideKey]?.[slot] ?? ''
    return (
      <select
        key={slot}
        value={value}
        disabled={readOnly}
        onChange={(e) => setSlot(lineIdx, sideKey, slot, e.target.value)}
        className="w-full rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-dark disabled:opacity-60"
      >
        <option value="">— pick player —</option>
        {roster.map((p) => (
          <option key={p.registrationId} value={p.registrationId}>{p.name}</option>
        ))}
      </select>
    )
  }

  // ── Captain view: edit only my side, show the opponent's picks read-only. ──
  if (mySideKey && side) {
    const myTeamName = side === 1 ? team1.name : team2.name
    const oppTeamName = side === 1 ? team2.name : team1.name
    const myRoster = side === 1 ? team1.roster : team2.roster
    const oppKey: 'team1' | 'team2' = side === 1 ? 'team2' : 'team1'
    const oppRoster = side === 1 ? team2.roster : team1.roster
    const nameOfReg = (regId: string) => oppRoster.find((p) => p.registrationId === regId)?.name ?? 'TBD'

    return (
      <div className="space-y-4">
        <p className="text-xs text-brand-muted">Set your team&apos;s lineup ({myTeamName}). {oppTeamName}&apos;s captain sets theirs.</p>
        <div className="space-y-3">
          {lines.map((line, i) => {
            const slots = line.discipline === 'singles' ? 1 : 2
            const oppPicks = initialLineup[i]?.[oppKey] ?? []
            return (
              <div key={i} className="border border-brand-border rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-dark">{line.label}</span>
                  <span className="text-[11px] text-brand-muted capitalize">{line.discipline}</span>
                </div>
                <div className="space-y-2">{Array.from({ length: slots }).map((_, s) => slotSelect(i, mySideKey, s, myRoster))}</div>
                <p className="text-[11px] text-brand-muted">
                  vs {oppTeamName}: {oppPicks.length ? oppPicks.map(nameOfReg).join(' / ') : 'not set yet'}
                </p>
              </div>
            )
          })}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {saved && !error && <p className="text-sm text-green-600">Lineup saved.</p>}
        {readOnly ? (
          <p className="text-xs text-brand-muted">This matchup is scored — clear the results to change the lineup.</p>
        ) : (
          <button onClick={save} disabled={busy} className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-4 py-2 hover:bg-brand-hover disabled:opacity-50">
            {busy ? 'Saving…' : 'Save my lineup'}
          </button>
        )}
      </div>
    )
  }

  // ── Organizer view: edit both sides. ──
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-wide text-brand-muted px-1">
        <span>Line</span>
        <span className="truncate">{team1.name}</span>
        <span className="text-center">vs</span>
        <span className="truncate">{team2.name}</span>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => {
          const slots = line.discipline === 'singles' ? 1 : 2
          return (
            <div key={i} className="border border-brand-border rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-brand-dark">{line.label}</span>
                <span className="text-[11px] text-brand-muted capitalize">{line.discipline}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
                <div className="space-y-2">{Array.from({ length: slots }).map((_, s) => slotSelect(i, 'team1', s, team1.roster))}</div>
                <span className="text-xs text-brand-muted pt-2">vs</span>
                <div className="space-y-2">{Array.from({ length: slots }).map((_, s) => slotSelect(i, 'team2', s, team2.roster))}</div>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Lineup saved.</p>}

      {readOnly ? (
        <p className="text-xs text-brand-muted">This matchup is scored — clear the results to change the lineup.</p>
      ) : (
        <button onClick={save} disabled={busy} className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-4 py-2 hover:bg-brand-hover disabled:opacity-50">
          {busy ? 'Saving…' : 'Save lineup'}
        </button>
      )}
    </div>
  )
}
