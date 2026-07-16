'use client'

import { useState } from 'react'
import Link from 'next/link'
import SubOpportunityCard from '@/components/features/subs/SubOpportunityCard'
import RequesterSubStatus from '@/components/features/leagues/RequesterSubStatus'
import type { MatchedSubOpportunity } from '@/lib/subs/matching'
import type { OwnRequestSummary, MySubSummary } from '@/lib/subs/loadOpportunities'

function dateStr(d: string | null): string {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
}

type Tab = 'open' | 'mine' | 'requests'

export default function SubsBrowser({
  openOpps,
  mySubs,
  myRequests,
}: {
  openOpps: MatchedSubOpportunity[]
  mySubs: MySubSummary[]
  myRequests: OwnRequestSummary[]
}) {
  const [tab, setTab] = useState<Tab>('open')
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(10)
  const [withdrawn, setWithdrawn] = useState<Set<string>>(new Set())
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null)
  const [busyWithdraw, setBusyWithdraw] = useState<string | null>(null)
  const [withdrawErr, setWithdrawErr] = useState<Record<string, string>>({})

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  async function withdraw(id: string) {
    setBusyWithdraw(id); setWithdrawErr((e) => ({ ...e, [id]: '' }))
    try {
      const res = await fetch(`/api/league-sub-requests/${id}/withdraw`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setWithdrawErr((e) => ({ ...e, [id]: body.error ?? 'Could not withdraw.' }))
        return
      }
      setWithdrawn((s) => new Set(s).add(id))
    } catch { setWithdrawErr((e) => ({ ...e, [id]: 'Network error.' })) } finally { setBusyWithdraw(null); setConfirmWithdraw(null) }
  }

  const openList = openOpps.filter((o) => !accepted.has(o.requestId))
  const shown = openList.slice(0, visibleCount)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'open', label: 'Open' },
    { key: 'mine', label: 'My substitutions' },
    { key: 'requests', label: 'My requests' },
  ]

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Substitute views" className="flex gap-1 rounded-xl bg-brand-soft p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${tab === t.key ? 'bg-brand-page text-brand-dark shadow-sm' : 'text-brand-muted hover:text-brand-dark'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div className="space-y-2">
          {shown.length === 0 ? (
            <p className="text-sm text-brand-muted py-6 text-center">No open substitute opportunities for you right now.</p>
          ) : (
            <>
              {shown.map((o) => (
                <SubOpportunityCard key={o.requestId} opp={o} onAccepted={(id) => setAccepted((s) => new Set(s).add(id))} />
              ))}
              {openList.length > shown.length && (
                <button onClick={() => setVisibleCount((c) => c + 10)} className="w-full rounded-xl border border-brand-border bg-brand-surface px-4 py-2 text-sm font-semibold text-brand-dark hover:bg-brand-soft">
                  Load more
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="space-y-2">
          {mySubs.length === 0 ? (
            <p className="text-sm text-brand-muted py-6 text-center">You haven&apos;t subbed for anyone yet.</p>
          ) : (
            mySubs.map((s) => {
              const gone = withdrawn.has(s.id)
              const upcoming = !s.date || s.date >= today
              return (
                <div key={s.id} className="rounded-2xl border border-brand-border bg-brand-surface p-4">
                  <Link href={`/leagues/${s.leagueId}`} className="block">
                    <p className="text-sm font-semibold text-brand-dark">{s.leagueName}</p>
                    <p className="text-xs text-brand-muted">
                      {s.scopeType === 'session' && s.sessionNumber ? `Session ${s.sessionNumber} · ` : ''}{dateStr(s.date)}
                      {s.requesterName ? ` · covering ${s.requesterName}` : ''}
                    </p>
                  </Link>
                  {gone ? (
                    <p className="text-[11px] font-semibold text-brand-muted mt-1">You withdrew — the request has reopened.</p>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold text-brand-active mt-1">✓ Confirmed{s.fulfillmentMode === 'organizer_assigned' ? ' by organizer' : ''}</p>
                      {upcoming && (confirmWithdraw === s.id ? (
                        <div className="mt-1.5 space-y-1.5">
                          <p className="text-[11px] text-brand-body">If you withdraw, this opportunity reopens and the organizer and player are notified.</p>
                          <div className="flex gap-2">
                            <button onClick={() => withdraw(s.id)} disabled={busyWithdraw === s.id} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">{busyWithdraw === s.id ? 'Withdrawing…' : 'Withdraw'}</button>
                            <button onClick={() => setConfirmWithdraw(null)} className="text-xs font-medium text-brand-muted">Never mind</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmWithdraw(s.id)} className="mt-1 text-xs font-semibold text-red-600 hover:text-red-700">Withdraw</button>
                      ))}
                    </>
                  )}
                  {withdrawErr[s.id] && <p role="alert" className="text-xs text-red-600 mt-1">{withdrawErr[s.id]}</p>}
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-2">
          {myRequests.length === 0 ? (
            <p className="text-sm text-brand-muted py-6 text-center">You have no substitute requests.</p>
          ) : (
            myRequests.map((r) => (
              <div key={r.id} className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{r.leagueName}</p>
                  <p className="text-xs text-brand-muted">
                    {r.scopeType === 'session' && r.sessionNumber ? `Session ${r.sessionNumber} · ` : ''}{dateStr(r.date)}
                  </p>
                </div>
                {r.status === 'open' || r.status === 'filled' ? (
                  <RequesterSubStatus request={{ id: r.id, status: r.status, fulfillment_mode: r.fulfillmentMode as any, subName: r.subName }} />
                ) : (
                  <p className="text-xs text-brand-muted capitalize">{r.status === 'expired' ? 'No sub found' : 'Request cancelled'}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
