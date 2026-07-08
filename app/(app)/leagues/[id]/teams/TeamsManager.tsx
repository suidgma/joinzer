'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Member = { id: string; registrationId: string; name: string; isCaptain: boolean }
type TeamView = { id: string; name: string; status: string; captainRegistrationId: string | null; members: Member[] }
type AvailablePlayer = { registrationId: string; name: string }

const btn = 'bg-brand text-brand-dark rounded-lg text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap'

export default function TeamsManager({
  leagueId,
  initialTeams,
  availablePlayers,
}: {
  leagueId: string
  initialTeams: TeamView[]
  availablePlayers: AvailablePlayer[]
}) {
  const router = useRouter()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Something went wrong')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Network error')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createTeam() {
    const name = newName.trim()
    if (!name) return
    if (await call(`/api/leagues/${leagueId}/teams`, 'POST', { name })) setNewName('')
  }
  const addMember = (teamId: string, registrationId: string) =>
    call(`/api/leagues/${leagueId}/teams/${teamId}/members`, 'POST', { registration_id: registrationId })
  const removeMember = (teamId: string, memberId: string) =>
    call(`/api/leagues/${leagueId}/teams/${teamId}/members/${memberId}`, 'DELETE')
  const setCaptain = (teamId: string, registrationId: string) =>
    call(`/api/leagues/${leagueId}/teams/${teamId}`, 'PATCH', { captain_registration_id: registrationId })
  const removeTeam = (teamId: string) => call(`/api/leagues/${leagueId}/teams/${teamId}`, 'DELETE')
  const confirmDeleteTeam = (teamId: string, name: string) => {
    if (confirm(`Delete team "${name}"? This removes its roster.`)) removeTeam(teamId)
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createTeam() }}
          placeholder="New team name"
          className="flex-1 input-sm"
        />
        <button onClick={createTeam} disabled={busy || !newName.trim()} className={`${btn} px-4 py-2`}>Add team</button>
      </div>

      {initialTeams.length === 0 ? (
        <p className="text-sm text-brand-muted text-center py-8">No teams yet. Create your first team above.</p>
      ) : (
        initialTeams.map((team) => (
          <div key={team.id} className="border border-brand-border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-brand-soft border-b border-brand-border">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-brand-dark truncate">{team.name}</span>
                {team.status === 'withdrawn' && <span className="text-[10px] text-red-500 font-semibold uppercase">Withdrawn</span>}
                <span className="text-xs text-brand-muted">{team.members.length} player{team.members.length !== 1 ? 's' : ''}</span>
              </div>
              <button onClick={() => confirmDeleteTeam(team.id, team.name)} disabled={busy} className="text-xs text-red-500 hover:underline shrink-0">Delete</button>
            </div>

            <div className="divide-y divide-brand-border">
              {team.members.length === 0 ? (
                <p className="px-4 py-2 text-xs text-brand-muted">No players yet.</p>
              ) : (
                team.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="flex-1 text-brand-dark truncate">
                      {m.name}
                      {m.isCaptain && <span className="ml-2 text-[10px] font-bold text-brand-active uppercase">Captain</span>}
                    </span>
                    {!m.isCaptain && (
                      <button onClick={() => setCaptain(team.id, m.registrationId)} disabled={busy} className="text-xs text-brand-active hover:underline">Make captain</button>
                    )}
                    <button onClick={() => removeMember(team.id, m.id)} disabled={busy} className="text-xs text-brand-muted hover:text-red-500">Remove</button>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-brand-border bg-white">
              <AddPlayer teamId={team.id} availablePlayers={availablePlayers} onAdd={addMember} busy={busy} />
            </div>
          </div>
        ))
      )}

      {availablePlayers.length > 0 && (
        <p className="text-[11px] text-brand-muted">
          {availablePlayers.length} registered player{availablePlayers.length !== 1 ? 's' : ''} not yet on a team.
        </p>
      )}
    </div>
  )
}

function AddPlayer({
  teamId,
  availablePlayers,
  onAdd,
  busy,
}: {
  teamId: string
  availablePlayers: AvailablePlayer[]
  onAdd: (teamId: string, registrationId: string) => void
  busy: boolean
}) {
  const [sel, setSel] = useState('')
  if (availablePlayers.length === 0) return <p className="text-[11px] text-brand-muted">All registered players are assigned.</p>
  return (
    <div className="flex gap-2">
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="flex-1 input-sm">
        <option value="">Add a player…</option>
        {availablePlayers.map((p) => (
          <option key={p.registrationId} value={p.registrationId}>{p.name}</option>
        ))}
      </select>
      <button onClick={() => { if (sel) { onAdd(teamId, sel); setSel('') } }} disabled={busy || !sel} className={`${btn} px-3 py-2`}>Add</button>
    </div>
  )
}
