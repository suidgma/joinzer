'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Player = { id: string; name: string }

// Attendance statuses (from PlayerCheckIn) → player-facing label, chip style, and
// sort order for the live list.
const STATUS_META: Record<string, { label: string; chip: string; order: number }> = {
  checked_in_present: { label: 'Here',          chip: 'bg-brand-dark text-white',       order: 0 },
  planning_to_attend: { label: 'Coming',        chip: 'bg-brand text-brand-dark',       order: 1 },
  running_late:       { label: 'Late',          chip: 'bg-yellow-100 text-yellow-800',  order: 2 },
  not_responded:      { label: 'No response',   chip: 'bg-brand-soft text-brand-muted', order: 3 },
  cannot_attend:      { label: "Can't make it", chip: 'bg-red-50 text-red-700',         order: 4 },
}

// Live "who's coming" for the next session — every registered player + their
// current attendance, updated in real time as people mark their status.
export default function WhoIsComing({
  sessionId,
  sessionLabel,
  players,
  initialAttendance,
  currentUserId,
}: {
  sessionId: string
  sessionLabel: string
  players: Player[]
  initialAttendance: Record<string, string>
  currentUserId: string | null
}) {
  const [attendance, setAttendance] = useState<Record<string, string>>(initialAttendance)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`lsa-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'league_session_attendance', filter: `league_session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as { user_id?: string; attendance_status?: string; league_session_id?: string }
          if (!row?.user_id || !row.attendance_status) return
          if (row.league_session_id && row.league_session_id !== sessionId) return
          setAttendance((prev) => ({ ...prev, [row.user_id!]: row.attendance_status! }))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  if (players.length === 0) return null

  const rows = players
    .map((p) => ({ ...p, status: attendance[p.id] ?? 'not_responded' }))
    .sort((a, b) => {
      const oa = STATUS_META[a.status]?.order ?? 3
      const ob = STATUS_META[b.status]?.order ?? 3
      return oa - ob || a.name.localeCompare(b.name)
    })

  const here = rows.filter((r) => r.status === 'checked_in_present').length
  const onTheWay = rows.filter((r) => r.status === 'planning_to_attend' || r.status === 'running_late').length

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-brand-dark">Who&apos;s coming</h2>
        <span className="text-xs text-brand-muted">{here} here · {onTheWay} on the way</span>
      </div>
      <p className="text-[11px] text-brand-muted">{sessionLabel} · updates live</p>
      <div className="bg-brand-surface border border-brand-border rounded-2xl divide-y divide-brand-border/60 overflow-hidden">
        {rows.map((p) => {
          const meta = STATUS_META[p.status] ?? STATUS_META.not_responded
          return (
            <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className={`text-sm truncate ${p.id === currentUserId ? 'font-semibold text-brand-dark' : 'text-brand-body'}`}>
                {p.name}{p.id === currentUserId ? ' (you)' : ''}
              </span>
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
