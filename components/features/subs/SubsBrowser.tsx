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
            mySubs.map((s) => (
              <Link key={s.id} href={`/leagues/${s.leagueId}`} className="block rounded-2xl border border-brand-border bg-brand-surface p-4 hover:bg-brand-soft">
                <p className="text-sm font-semibold text-brand-dark">{s.leagueName}</p>
                <p className="text-xs text-brand-muted">
                  {s.scopeType === 'session' && s.sessionNumber ? `Session ${s.sessionNumber} · ` : ''}{dateStr(s.date)}
                  {s.requesterName ? ` · covering ${s.requesterName}` : ''}
                </p>
                <p className="text-[11px] font-semibold text-brand-active mt-1">✓ Confirmed{s.fulfillmentMode === 'organizer_assigned' ? ' by organizer' : ''}</p>
              </Link>
            ))
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
