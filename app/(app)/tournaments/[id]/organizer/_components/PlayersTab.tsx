'use client'
import { useState } from 'react'
import { Download, CheckCircle, Circle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import { Toast, useToast } from './Toast'

function getPlayerStatus(userId: string, matches: OrgMatch[], registrations: OrgRegistration[]): string {
  const regIds = registrations.filter(r => r.user_id === userId).map(r => r.id)
  const inMatch = (m: OrgMatch) =>
    regIds.includes(m.team_1_registration_id ?? '') ||
    regIds.includes(m.team_2_registration_id ?? '')

  if (matches.some(m => m.status === 'in_progress' && inMatch(m))) return 'Playing'
  if (matches.some(m => (m.status === 'pending' || m.status === 'ready') && inMatch(m))) return 'On Deck'
  const playerMatches = matches.filter(inMatch)
  if (playerMatches.length > 0 && playerMatches.every(m => m.status === 'completed')) return 'Done'
  return '—'
}

const STATUS_COLOR: Record<string, string> = {
  Playing: 'text-brand-active bg-brand-soft',
  'On Deck': 'text-yellow-700 bg-yellow-50',
  Done: 'text-brand-muted bg-gray-100',
}

function escapeCsv(val: string | null | undefined): string {
  const s = val ?? ''
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

type Props = {
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  tournamentName?: string
}

export default function PlayersTab({ matches, registrations, divisions, tournamentName }: Props) {
  const [checkedIn, setCheckedIn] = useState<Record<string, boolean>>(
    () => Object.fromEntries(registrations.map(r => [r.id, r.checked_in]))
  )
  const { message: toastMsg, show: showToast } = useToast()

  const divisionMap = Object.fromEntries(divisions.map(d => [d.id, d.name]))

  const registered = registrations.filter(r => r.status === 'registered')
  const waitlisted = registrations.filter(r => r.status === 'waitlisted')
  const seen = new Set<string>()
  const players = registered.filter(r => {
    if (seen.has(r.user_id)) return false
    seen.add(r.user_id)
    return true
  })

  // A player is checked in if ANY of their registrations is checked in
  function isCheckedIn(userId: string): boolean {
    return registrations
      .filter(r => r.user_id === userId && r.status === 'registered')
      .some(r => checkedIn[r.id])
  }

  async function toggleCheckIn(userId: string) {
    const playerRegs = registrations.filter(r => r.user_id === userId && r.status === 'registered')
    const currentlyIn = playerRegs.some(r => checkedIn[r.id])
    const newValue = !currentlyIn

    // Optimistic update
    setCheckedIn(prev => {
      const next = { ...prev }
      for (const r of playerRegs) next[r.id] = newValue
      return next
    })

    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ checked_in: newValue })
      .in('id', playerRegs.map(r => r.id))

    if (error) {
      // Revert on failure
      setCheckedIn(prev => {
        const next = { ...prev }
        for (const r of playerRegs) next[r.id] = currentlyIn
        return next
      })
      showToast('Check-in update failed')
    }
  }

  const checkedInCount = players.filter(p => isCheckedIn(p.user_id)).length
  const active = players.filter(p => {
    const s = getPlayerStatus(p.user_id, matches, registrations)
    return s === 'Playing' || s === 'On Deck'
  }).length

  function handleExportCsv() {
    const rows = [
      ['Name', 'Team', 'Division', 'Status', 'Checked In'].join(','),
      ...registered.map(r =>
        [
          escapeCsv(r.player_name),
          escapeCsv(r.team_name),
          escapeCsv(divisionMap[r.division_id] ?? r.division_id),
          escapeCsv(r.status),
          checkedIn[r.id] ? 'Yes' : 'No',
        ].join(',')
      ),
    ]
    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(tournamentName ?? 'tournament').replace(/\s+/g, '_')}_players.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Players</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-brand-muted">
            {checkedInCount} in · {active} active · {players.length} total
          </span>
          {registered.length > 0 && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1 text-xs font-semibold text-brand-active hover:text-brand-active/80 transition-colors"
            >
              <Download size={13} />
              CSV
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border">
        {players.map(player => {
          const status = getPlayerStatus(player.user_id, matches, registrations)
          const inToday = isCheckedIn(player.user_id)
          return (
            <div
              key={player.user_id}
              className="flex items-center gap-3 px-4 py-3"
            >
              {/* Check-in toggle */}
              <button
                onClick={() => toggleCheckIn(player.user_id)}
                className="shrink-0 text-brand-muted hover:text-brand-active transition-colors"
                title={inToday ? 'Mark absent' : 'Check in'}
              >
                {inToday
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <Circle size={18} className="text-brand-border" />
                }
              </button>

              <span className={`flex-1 text-sm font-medium truncate ${inToday ? 'text-brand-dark' : 'text-brand-muted'}`}>
                {player.player_name ?? player.team_name ?? '—'}
              </span>

              {status !== '—' && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? 'text-brand-muted bg-gray-50'}`}>
                  {status}
                </span>
              )}
            </div>
          )
        })}
        {players.length === 0 && (
          <p className="px-4 py-8 text-sm text-brand-muted text-center">No registered players yet.</p>
        )}
      </div>

      <p className="text-xs text-brand-muted text-center">Tap the circle to check a player in or out.</p>

      {/* Waitlist section */}
      {waitlisted.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            Waitlist ({waitlisted.length})
          </h3>
          <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border">
            {waitlisted.map((reg, i) => (
              <div key={reg.id} className="flex items-center gap-3 px-4 py-3">
                <span className="shrink-0 w-5 text-[10px] font-bold text-brand-muted text-center">{i + 1}</span>
                <span className="flex-1 text-sm text-brand-muted truncate">
                  {reg.player_name ?? reg.team_name ?? '—'}
                </span>
                <span className="text-[10px] font-semibold bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
                  {divisionMap[reg.division_id] ?? 'Waitlisted'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Toast message={toastMsg} />
    </div>
  )
}
