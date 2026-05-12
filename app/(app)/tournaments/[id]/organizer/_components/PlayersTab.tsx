'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { message: toastMsg, show: showToast } = useToast()

  const divisionMap = Object.fromEntries(divisions.map(d => [d.id, d.name]))

  const registered = registrations.filter(r => r.status === 'registered')
  // Deduplicate by user_id — each player once even if in multiple divisions
  const seen = new Set<string>()
  const players = registered.filter(r => {
    if (seen.has(r.user_id)) return false
    seen.add(r.user_id)
    return true
  })

  const active = players.filter(p => {
    const s = getPlayerStatus(p.user_id, matches, registrations)
    return s === 'Playing' || s === 'On Deck'
  }).length

  function toggleSelect(userId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }

  function handleExportCsv() {
    const rows = [
      ['Name', 'Team', 'Division', 'Status'].join(','),
      ...registered.map(r =>
        [
          escapeCsv(r.player_name),
          escapeCsv(r.team_name),
          escapeCsv(divisionMap[r.division_id] ?? r.division_id),
          escapeCsv(r.status),
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
          <span className="text-xs text-brand-muted">{active} active · {players.length} total</span>
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

      {selected.size > 0 && (
        <button
          onClick={() => showToast('Player messaging not yet available')}
          className="w-full py-2.5 rounded-xl border border-brand-border text-brand-muted text-sm font-semibold cursor-not-allowed opacity-60"
          disabled
        >
          Message {selected.size} selected — coming soon
        </button>
      )}

      <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border">
        {players.map(player => {
          const status = getPlayerStatus(player.user_id, matches, registrations)
          const isSelected = selected.has(player.user_id)
          return (
            <div
              key={player.user_id}
              onClick={() => toggleSelect(player.user_id)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                isSelected ? 'bg-brand-soft' : 'hover:bg-brand-page'
              }`}
            >
              <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                isSelected ? 'bg-brand border-brand' : 'border-brand-border'
              }`}>
                {isSelected && <span className="text-[8px] text-white font-bold leading-none">✓</span>}
              </div>
              <span className="flex-1 text-sm font-medium text-brand-dark truncate">
                {player.player_name ?? player.team_name ?? '—'}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? 'text-brand-muted bg-gray-50'}`}>
                {status}
              </span>
            </div>
          )
        })}
        {players.length === 0 && (
          <p className="px-4 py-8 text-sm text-brand-muted text-center">No registered players yet.</p>
        )}
      </div>

      <Toast message={toastMsg} />
    </div>
  )
}
