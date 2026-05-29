'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import LiveTab from './LiveTab'

type Props = {
  tournamentId: string
  tournamentName: string
  initialMatches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
}

// Manages realtime match state and renders the Live operational control panel.
// Schedule / Standings / Players are now dedicated sub-routes.
export default function TournamentOrganizerView({
  tournamentId, tournamentName, initialMatches, registrations, divisions,
}: Props) {
  const [matches, setMatches] = useState<OrgMatch[]>(initialMatches)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`org-matches-${tournamentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` },
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

  return (
    <LiveTab
      tournamentId={tournamentId}
      matches={matches}
      registrations={registrations}
      divisions={divisions}
      onMatchUpdate={updated => setMatches(prev => prev.map(m => m.id === updated.id ? updated : m))}
    />
  )
}
