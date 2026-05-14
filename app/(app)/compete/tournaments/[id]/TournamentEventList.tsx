'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { formatSessionDate } from '@/lib/utils/date'
import ConfirmModal from '@/components/ui/ConfirmModal'

type EventItem = {
  id: string
  name: string
  category: string
  skill_level: string | null
  age_division: string | null
  max_teams: number | null
  event_date: string | null
  bracket_type: string | null
  reg_count: number
  myStatus: string | null
}

type Props = {
  tournamentId: string
  tournamentStatus: string
  events: EventItem[]
  isLoggedIn: boolean
  userRating: number | null
  categoryLabels: Record<string, string>
  bracketLabels: Record<string, string>
}

function skillMismatchWarning(skillLevel: string | null, userRating: number | null): string | null {
  if (!skillLevel || userRating == null) return null
  const eventRating = parseFloat(skillLevel)
  if (isNaN(eventRating)) return null
  const diff = userRating - eventRating
  if (diff < -0.75) return `This event is rated ${eventRating.toFixed(1)}. Your rating (${userRating.toFixed(2)}) may be below this level.`
  if (diff > 0.75) return `This event is rated ${eventRating.toFixed(1)}. Your rating (${userRating.toFixed(2)}) may be above this level.`
  return null
}

export default function TournamentEventList({ tournamentStatus, events, isLoggedIn, userRating, categoryLabels, bracketLabels }: Props) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [partnerNames, setPartnerNames] = useState<Record<string, string>>({})
  const [localStatuses, setLocalStatuses] = useState<Record<string, string | null>>(
    Object.fromEntries(events.map((e) => [e.id, e.myStatus]))
  )
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const canRegister = tournamentStatus === 'registration_open'
  const isDoubles = (cat: string) => cat.includes('doubles')

  async function handleRegister(eventId: string, category: string) {
    setLoadingId(eventId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingId(null); return }

    const event = events.find((e) => e.id === eventId)
    const isFull = event?.max_teams != null && event.reg_count >= event.max_teams

    await supabase.from('tournament_registrations').insert({
      tournament_event_id: eventId,
      user_id: user.id,
      partner_name: isDoubles(category) ? (partnerNames[eventId] ?? null) : null,
      status: isFull ? 'waitlist' : 'registered',
    })

    setLocalStatuses((prev) => ({ ...prev, [eventId]: isFull ? 'waitlist' : 'registered' }))
    router.refresh()
    setLoadingId(null)
  }

  async function handleWithdraw(eventId: string) {
    setLoadingId(eventId)
    setWithdrawError(null)

    const res = await fetch('/api/tournament-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentEventId: eventId }),
    })

    if (res.ok) {
      setConfirmWithdrawId(null)
      setLocalStatuses((prev) => ({ ...prev, [eventId]: 'cancelled' }))
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setWithdrawError(data.error === 'Already cancelled' ? 'Already cancelled — refreshing…' : (data.error ?? "Couldn't cancel — please try again"))
      if (data.error === 'Already cancelled') router.refresh()
    }
    setLoadingId(null)
  }

  return (
    <div className="space-y-3">
      {events.map((evt) => {
        const myStatus = localStatuses[evt.id]
        const isFull = evt.max_teams != null && evt.reg_count >= evt.max_teams
        const loading = loadingId === evt.id
        const warning = skillMismatchWarning(evt.skill_level, userRating)

        return (
          <div key={evt.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-brand-dark">{evt.name}</p>
                <p className="text-xs text-brand-muted">
                  {categoryLabels[evt.category] ?? evt.category}
                  {evt.skill_level ? ` · ${evt.skill_level}` : ''}
                  {evt.age_division ? ` · ${evt.age_division}` : ''}
                </p>
                {evt.bracket_type && (
                  <p className="text-xs text-brand-muted">{bracketLabels[evt.bracket_type] ?? evt.bracket_type}</p>
                )}
                {evt.event_date && (
                  <p className="text-xs text-brand-muted">
                    {formatSessionDate(evt.event_date)}
                  </p>
                )}
                {evt.max_teams != null && (
                  <p className="text-xs text-brand-muted">{evt.reg_count} / {evt.max_teams} registered</p>
                )}
              </div>
              {myStatus === 'registered' && (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-brand text-brand-dark flex-shrink-0">Registered</span>
              )}
              {myStatus === 'waitlist' && (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 flex-shrink-0">Waitlisted</span>
              )}
            </div>

            {/* Partner name field for doubles */}
            {isLoggedIn && canRegister && (!myStatus || myStatus === 'cancelled') && isDoubles(evt.category) && (
              <input
                type="text"
                placeholder="Partner name (optional)"
                value={partnerNames[evt.id] ?? ''}
                onChange={(e) => setPartnerNames((prev) => ({ ...prev, [evt.id]: e.target.value }))}
                className="w-full input text-sm"
              />
            )}

            {/* Skill mismatch warning */}
            {warning && isLoggedIn && (!myStatus || myStatus === 'cancelled') && (
              <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                ⚠️ {warning}
              </p>
            )}

            {/* CTA */}
            {isLoggedIn && canRegister && (!myStatus || myStatus === 'cancelled') && (
              <button
                onClick={() => handleRegister(evt.id, evt.category)}
                disabled={loading}
                className="w-full py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : isFull ? 'Join Waitlist' : 'Register'}
              </button>
            )}

            {isLoggedIn && (myStatus === 'registered' || myStatus === 'waitlist') && (
              <button
                onClick={() => setConfirmWithdrawId(evt.id)}
                disabled={loading}
                className="text-xs text-red-500 font-medium underline"
              >
                Withdraw
              </button>
            )}
          </div>
        )
      })}

      <ConfirmModal
        open={confirmWithdrawId !== null}
        title="Withdraw from event?"
        body={(() => {
          const evt = events.find(e => e.id === confirmWithdrawId)
          return evt
            ? `Withdraw from ${evt.name}? This can't be undone, and your spot may be given to someone on the waitlist.`
            : "Withdraw from this event? This can't be undone."
        })()}
        confirmLabel="Withdraw"
        loading={loadingId === confirmWithdrawId}
        error={withdrawError}
        onConfirm={() => confirmWithdrawId && handleWithdraw(confirmWithdrawId)}
        onClose={() => { setConfirmWithdrawId(null); setWithdrawError(null) }}
      />
    </div>
  )
}
