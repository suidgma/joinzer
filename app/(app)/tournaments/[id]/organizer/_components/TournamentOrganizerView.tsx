'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import LiveTab from './LiveTab'
import ScheduleTab from './ScheduleTab'
import StandingsTab from './StandingsTab'
import PlayersTab from './PlayersTab'

const TABS = ['Live', 'Schedule', 'Standings', 'Players'] as const
type Tab = (typeof TABS)[number]

type Props = {
  tournamentId: string
  tournamentName: string
  initialMatches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
}

export default function TournamentOrganizerView({
  tournamentId, tournamentName, initialMatches, registrations, divisions,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Live')
  const [matches, setMatches] = useState<OrgMatch[]>(initialMatches)
  const updatedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // Realtime: keep match state live across all tabs
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`org-matches-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        payload => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setMatches(prev => prev.filter(m => m.id !== deletedId))
          } else if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const updated = payload.new as OrgMatch
            setMatches(prev =>
              prev.some(m => m.id === updated.id)
                ? prev.map(m => (m.id === updated.id ? updated : m))
                : [...prev, updated]
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tournamentId])

  function handleMatchUpdate(updated: OrgMatch) {
    setMatches(prev => prev.map(m => (m.id === updated.id ? updated : m)))
  }

  return (
    <div>
      {/* Sticky tab bar — top-14 accounts for the Joinzer app header (h-14) */}
      <div className="sticky top-14 z-10 bg-brand-surface border-b border-brand-border -mx-4 px-4">
        <div className="flex overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-brand-active text-brand-active'
                  : 'border-transparent text-brand-muted hover:text-brand-dark'
              }`}
            >
              {tab}
              {tab === 'Live' && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-5">
        {activeTab === 'Live' && (
          <LiveTab
            tournamentId={tournamentId}
            matches={matches}
            registrations={registrations}
            onMatchUpdate={handleMatchUpdate}
          />
        )}
        {activeTab === 'Schedule' && (
          <ScheduleTab
            matches={matches}
            registrations={registrations}
            divisions={divisions}
          />
        )}
        {activeTab === 'Standings' && (
          <StandingsTab
            matches={matches}
            registrations={registrations}
            divisions={divisions}
            updatedAt={updatedAt}
          />
        )}
        {activeTab === 'Players' && (
          <PlayersTab
            matches={matches}
            registrations={registrations}
            divisions={divisions}
            tournamentName={tournamentName}
          />
        )}
      </div>
    </div>
  )
}
