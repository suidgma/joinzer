'use client'
import { useState } from 'react'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
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

  useRealtimeChannel(
    { topic: `org-matches-${tournamentId}`, postgresChanges: [{ event: '*', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` }] },
    (evt) => {
      if (evt.kind !== 'postgres_changes') return
      const payload = evt.payload
      if (payload.eventType === 'DELETE') {
        const deletedId = (payload.old as { id: string }).id
        setMatches(prev => prev.filter(m => m.id !== deletedId))
      } else {
        const updated = payload.new as unknown as OrgMatch
        setMatches(prev =>
          prev.some(m => m.id === updated.id)
            ? prev.map(m => (m.id === updated.id ? updated : m))
            : [...prev, updated]
        )
      }
    },
  )

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
