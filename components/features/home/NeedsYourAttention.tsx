'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SubOpportunityCard from '@/components/features/subs/SubOpportunityCard'
import RequesterSubStatus from '@/components/features/leagues/RequesterSubStatus'
import type { ActionItem, AttendanceNeededItem } from '@/lib/home/actionItems'

function dateStr(d: string | null): string {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
}
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}
const todayPacific = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

// The attendance nudge is answerable in place — "Yes, I'll be there" one-taps the self check-in
// endpoint and clears the card (no bounce to the league page). "Can't make it" still routes to the
// league so the sub-request flow (decision sheet) is available. On confirm we also router.refresh()
// so the session reconciles into My Schedule with its new status.
function AttendanceQuickCard({ a, onConfirmed }: { a: AttendanceNeededItem; onConfirmed: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const when = a.date <= todayPacific() ? 'today' : dateStr(a.date)

  async function confirm() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${a.sessionId}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendance_status: 'planning_to_attend' }),
    })
    if (!res.ok) {
      setError('Could not save — try again')
      setSaving(false)
      return
    }
    onConfirmed()
  }

  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-brand-dark">Are you playing {when}?</p>
        <p className="text-xs text-brand-muted">{a.leagueName}{a.sessionNumber ? ` · Session ${a.sessionNumber}` : ''}</p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={saving}
          className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : "Yes, I'll be there"}
        </button>
        <Link
          href={`/leagues/${a.leagueId}`}
          className="flex-1 py-2 rounded-xl border border-brand-border text-brand-dark text-xs font-semibold text-center hover:bg-brand-soft transition-colors"
        >
          Can&apos;t make it
        </Link>
      </div>
    </div>
  )
}

// Home "Needs your attention" — renders the server-derived ActionItem[]. Compact; renders nothing
// when empty (no large empty card). Own requests/statuses always show; matched opportunities appear
// only when getHomeActionItems included them (gated there by open_to_subbing).
export default function NeedsYourAttention({ items }: { items: ActionItem[] }) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const visible = items.filter((i) => !dismissed.has(i.id))
  if (visible.length === 0) return null
  const drop = (id: string) => setDismissed((s) => new Set(s).add(id))
  const hasMatched = visible.some((i) => i.type === 'matched_sub_opportunity')

  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Needs your attention</h2>
      <div className="space-y-2">
        {visible.map((item) => {
          if (item.type === 'run_session_today') {
            const r = item.run
            return (
              <Link key={item.id} href={`/leagues/${r.leagueId}/sessions/${r.sessionId}/live`} className="flex items-center justify-between gap-2 rounded-2xl border border-brand-border bg-brand-soft p-4 hover:bg-brand-surface">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-dark">🎾 Run tonight&apos;s session</p>
                  <p className="text-xs text-brand-muted">{r.leagueName}{r.sessionNumber ? ` · Session ${r.sessionNumber}` : ''} — players are counting on you.</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-brand-active">Open →</span>
              </Link>
            )
          }
          if (item.type === 'draft_event') {
            const d = item.draft
            return (
              <Link key={item.id} href={`/tournaments/${d.tournamentId}`} className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:border-amber-300">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-800">Finish setting up your tournament</p>
                  <p className="text-xs text-amber-700">{d.name} — not published yet.</p>
                </div>
                <span className="shrink-0 text-amber-500 text-sm">→</span>
              </Link>
            )
          }
          if (item.type === 'incomplete_payment') {
            const p = item.payment
            return (
              <Link key={item.id} href={p.href} className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:border-amber-300">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-800">Finish your payment — {p.title}</p>
                  <p className="text-xs text-amber-700">{money(p.amountCents)} {p.kind === 'tournament_order' ? 'reserved — pay to keep your spot' : 'due for your session'}</p>
                </div>
                <span className="shrink-0 text-amber-500 text-sm">→</span>
              </Link>
            )
          }
          if (item.type === 'attendance_needed') {
            return (
              <AttendanceQuickCard
                key={item.id}
                a={item.attendance}
                onConfirmed={() => { drop(item.id); router.refresh() }}
              />
            )
          }
          if (item.type === 'score_confirmation') {
            const s = item.score
            return (
              <Link key={item.id} href={`/leagues/${s.leagueId}`} className="flex items-center justify-between gap-2 rounded-2xl border border-brand-border bg-brand-surface p-4 hover:bg-brand-soft">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-dark">Confirm a match result</p>
                  <p className="text-xs text-brand-muted">{s.leagueName} — your opponent reported a score.</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-brand-active">Review →</span>
              </Link>
            )
          }
          if (item.type === 'matched_sub_opportunity') {
            return <SubOpportunityCard key={item.id} opp={item.opportunity} compact onAccepted={() => drop(item.id)} />
          }
          if (item.type === 'own_open_sub_request') {
            const r = item.request
            return (
              <div key={item.id} className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{r.leagueName}</p>
                  <p className="text-xs text-brand-muted">{dateStr(r.date)}{r.sessionNumber ? ` · Session ${r.sessionNumber}` : ''}</p>
                </div>
                <RequesterSubStatus request={{ id: r.requestId, status: 'open', fulfillment_mode: 'open_pool', subName: null }} onCancelled={() => drop(item.id)} />
                <Link href={`/leagues/${r.leagueId}`} className="text-xs font-semibold text-brand-active">View request →</Link>
              </div>
            )
          }
          const r = item.request
          return (
            <div key={item.id} className="rounded-2xl border border-brand-border bg-brand-soft p-4">
              <p className="text-sm font-semibold text-brand-active">✓ Substitute {r.byOrganizer ? 'assigned by organizer' : 'confirmed'}{r.subName ? `: ${r.subName}` : ''}</p>
              <p className="text-xs text-brand-muted mt-0.5">{r.subName ? `${r.subName} will cover your ` : 'Your '}{r.leagueName} session{dateStr(r.date) ? ` on ${dateStr(r.date)}` : ''}.</p>
              <Link href={`/leagues/${r.leagueId}`} className="text-xs font-semibold text-brand-active mt-1 inline-block">View details →</Link>
            </div>
          )
        })}
      </div>
      {hasMatched && (
        <Link href="/subs" className="block text-center text-xs font-semibold text-brand-active hover:underline pt-1">
          See all substitute opportunities →
        </Link>
      )}
    </section>
  )
}
