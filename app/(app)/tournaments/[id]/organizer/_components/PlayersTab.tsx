'use client'
import { useMemo, useState } from 'react'
import { Download, CheckCircle, Circle, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
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

function genderShort(g: string | null): string | null {
  if (!g) return null
  const v = g.toLowerCase()
  if (v.startsWith('m')) return 'M'
  if (v.startsWith('f') || v.startsWith('w')) return 'F'
  return null
}

function ratingLabel(r: PlayerRow): string | null {
  if (r.rating == null) return null
  return `${r.rating.toFixed(2)} ${r.ratingIsDupr ? 'DUPR' : 'est'}`
}

function escapeCsv(val: string | null | undefined): string {
  const s = val ?? ''
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

type DivEntry = {
  regId: string
  divisionId: string
  divisionName: string
  needsPartner: boolean
  unpaid: boolean
}

type PlayerRow = {
  userId: string
  name: string
  gender: string | null
  rating: number | null
  ratingIsDupr: boolean
  entries: DivEntry[]
  needsPartner: boolean
  unpaid: boolean
}

type QuickFlag = 'all' | 'unpaid' | 'needs_partner' | 'not_checked_in'

type Props = {
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  tournamentName?: string
  tournamentId: string
}

export default function PlayersTab({ matches, registrations, divisions, tournamentName, tournamentId }: Props) {
  const [checkedIn, setCheckedIn] = useState<Record<string, boolean>>(
    () => Object.fromEntries(registrations.map(r => [r.id, r.checked_in]))
  )

  // Live check-in: a player self-checking-in (QR) or a co-organizer toggling flips the
  // status here in real time. tournament_registrations is published + readable, so
  // postgres_changes delivers; own toggles are idempotent (same value → no-op).
  useRealtimeChannel(
    { topic: `tournament-checkin:${tournamentId}`, postgresChanges: [{ event: 'UPDATE', table: 'tournament_registrations', filter: `tournament_id=eq.${tournamentId}` }] },
    (evt) => {
      if (evt.kind !== 'postgres_changes') return
      const row = evt.payload.new as { id?: string; checked_in?: boolean }
      if (row?.id && typeof row.checked_in === 'boolean') {
        setCheckedIn((prev) => (prev[row.id!] === row.checked_in ? prev : { ...prev, [row.id!]: row.checked_in! }))
      }
    },
  )
  const [search, setSearch] = useState('')
  const [divFilter, setDivFilter] = useState('')
  const [genderFilter, setGenderFilter] = useState('')
  const [quickFlag, setQuickFlag] = useState<QuickFlag>('all')
  const { message: toastMsg, show: showToast } = useToast()

  const divisionMap = Object.fromEntries(divisions.map(d => [d.id, d.name]))
  const registered = useMemo(() => registrations.filter(r => r.status === 'registered'), [registrations])
  const waitlisted = registrations.filter(r => r.status === 'waitlisted')

  // One row per player, aggregating every division they registered for.
  const playerRows = useMemo<PlayerRow[]>(() => {
    const divById = new Map(divisions.map(d => [d.id, d]))
    const byUser = new Map<string, PlayerRow>()
    for (const r of registered) {
      let row = byUser.get(r.user_id)
      if (!row) {
        row = {
          userId: r.user_id,
          name: r.player_name ?? r.team_name ?? '—',
          gender: r.gender,
          rating: r.dupr_rating ?? r.estimated_rating ?? null,
          ratingIsDupr: r.dupr_rating != null,
          entries: [],
          needsPartner: false,
          unpaid: false,
        }
        byUser.set(r.user_id, row)
      }
      const div = divById.get(r.division_id)
      const needsPartner = !!div && isDoublesFormat(div.format) && !r.partner_registration_id
      const unpaid = r.payment_status === 'unpaid'
      row.entries.push({
        regId: r.id,
        divisionId: r.division_id,
        divisionName: div?.name ?? '—',
        needsPartner,
        unpaid,
      })
      if (needsPartner) row.needsPartner = true
      if (unpaid) row.unpaid = true
    }
    return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [registered, divisions])

  // A player is checked in if ANY of their registrations is checked in.
  const isCheckedIn = (userId: string) =>
    registrations.filter(r => r.user_id === userId && r.status === 'registered').some(r => checkedIn[r.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return playerRows.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (divFilter && !p.entries.some(e => e.divisionId === divFilter)) return false
      if (genderFilter && genderShort(p.gender) !== genderFilter) return false
      if (quickFlag === 'unpaid' && !p.unpaid) return false
      if (quickFlag === 'needs_partner' && !p.needsPartner) return false
      if (quickFlag === 'not_checked_in' && isCheckedIn(p.userId)) return false
      return true
    })
  }, [playerRows, search, divFilter, genderFilter, quickFlag, checkedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleCheckIn(userId: string) {
    const playerRegs = registrations.filter(r => r.user_id === userId && r.status === 'registered')
    const currentlyIn = playerRegs.some(r => checkedIn[r.id])
    const newValue = !currentlyIn

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
      setCheckedIn(prev => {
        const next = { ...prev }
        for (const r of playerRegs) next[r.id] = currentlyIn
        return next
      })
      showToast('Check-in update failed')
    }
  }

  const checkedInCount = playerRows.filter(p => isCheckedIn(p.userId)).length
  const active = playerRows.filter(p => {
    const s = getPlayerStatus(p.userId, matches, registrations)
    return s === 'Playing' || s === 'On Deck'
  }).length

  function handleExportCsv() {
    const header = ['Name', 'Gender', 'Rating', 'Rating source', 'Divisions', 'Needs partner', 'Unpaid', 'Checked in', 'Status']
    const rows = [
      header.join(','),
      ...playerRows.map(p =>
        [
          escapeCsv(p.name),
          escapeCsv(genderShort(p.gender)),
          escapeCsv(p.rating != null ? p.rating.toFixed(2) : ''),
          escapeCsv(p.rating == null ? '' : p.ratingIsDupr ? 'DUPR' : 'estimated'),
          escapeCsv(p.entries.map(e => e.divisionName).join(' | ')),
          p.needsPartner ? 'Yes' : 'No',
          p.unpaid ? 'Yes' : 'No',
          isCheckedIn(p.userId) ? 'Yes' : 'No',
          escapeCsv(getPlayerStatus(p.userId, matches, registrations)),
        ].join(',')
      ),
    ]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(tournamentName ?? 'tournament').replace(/\s+/g, '_')}_players.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls = 'input text-xs py-1 px-2'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Players</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-brand-muted">
            {checkedInCount} in · {active} active · {playerRows.length} total
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search players…"
            className="w-full input text-xs py-1 pl-7"
          />
        </div>
        <select value={divFilter} onChange={e => setDivFilter(e.target.value)} className={selectCls}>
          <option value="">All divisions</option>
          {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)} className={selectCls}>
          <option value="">All genders</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
        <select value={quickFlag} onChange={e => setQuickFlag(e.target.value as QuickFlag)} className={selectCls}>
          <option value="all">Everyone</option>
          <option value="unpaid">Unpaid</option>
          <option value="needs_partner">Needs partner</option>
          <option value="not_checked_in">Not checked in</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border">
        {filtered.map(player => {
          const status = getPlayerStatus(player.userId, matches, registrations)
          const inToday = isCheckedIn(player.userId)
          const g = genderShort(player.gender)
          const rating = ratingLabel(player)
          const needsPartnerDivs = player.entries.filter(e => e.needsPartner).map(e => e.divisionName)
          const unpaidDivs = player.entries.filter(e => e.unpaid).map(e => e.divisionName)
          return (
            <div key={player.userId} className="flex items-start gap-3 px-4 py-3">
              <button
                onClick={() => toggleCheckIn(player.userId)}
                className="shrink-0 mt-0.5 text-brand-muted hover:text-brand-active transition-colors"
                title={inToday ? 'Mark absent' : 'Check in'}
              >
                {inToday
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <Circle size={18} className="text-brand-border" />}
              </button>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${inToday ? 'text-brand-dark' : 'text-brand-muted'}`}>
                    {player.name}
                  </span>
                  {g && <span className="text-[10px] font-semibold text-brand-muted bg-gray-100 px-1.5 py-0.5 rounded">{g}</span>}
                  {rating && <span className="text-[10px] font-medium text-brand-muted">{rating}</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {player.entries.map(e => (
                    <span
                      key={e.regId}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                        e.needsPartner ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : e.unpaid ? 'border-red-200 bg-red-50 text-red-600'
                        : 'border-brand-border bg-brand-soft/40 text-brand-dark'
                      }`}
                    >
                      {e.divisionName}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[45%]">
                {player.needsPartner && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
                    title={`Needs a partner in: ${needsPartnerDivs.join(', ')}`}>
                    Needs partner
                  </span>
                )}
                {player.unpaid && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600"
                    title={`Unpaid in: ${unpaidDivs.join(', ')}`}>
                    Unpaid
                  </span>
                )}
                {status !== '—' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? 'text-brand-muted bg-gray-50'}`}>
                    {status}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-sm text-brand-muted text-center">
            {playerRows.length === 0 ? 'No registered players yet.' : 'No players match these filters.'}
          </p>
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
