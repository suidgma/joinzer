'use client'

import { useState } from 'react'
import type { OrgMatch, OrgRegistration, OrgDivision } from '../organizer/_components/types'
import ScheduleTab from '../organizer/_components/ScheduleTab'

type Props = {
  tournamentId: string
  initialMatches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
}

export default function SchedulePageClient({ tournamentId, initialMatches, registrations, divisions }: Props) {
  const [matches, setMatches] = useState<OrgMatch[]>(initialMatches)

  function handleMatchUpdate(updated: OrgMatch) {
    setMatches(prev => prev.map(m => m.id === updated.id ? updated : m))
  }

  return (
    <ScheduleTab
      tournamentId={tournamentId}
      matches={matches}
      registrations={registrations}
      divisions={divisions}
      onMatchUpdate={handleMatchUpdate}
    />
  )
}
