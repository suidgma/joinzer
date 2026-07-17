'use client'

import BracketView from '@/components/features/tournaments/BracketView'

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
  sequence_number?: number | null
  team_1_source?: { label?: string } | null
  team_2_source?: { label?: string } | null
}

type Reg = {
  id: string
  user_id: string
  team_name: string | null
  status: string
  seed?: number | null
  user_profile: { name: string } | null
  partner_user_id?: string | null
  partner_profile?: { name: string } | null
}

type Division = {
  id: string
  name: string
  isDoubles: boolean
  isBracket: boolean
  pointsToWin: number
  showSeeds: boolean
  matches: Match[]
  regs: Reg[]
}

// Read-only, spectator-facing bracket display. Reuses the same BracketView the organizer sees,
// with isOrganizer=false and a no-op score handler (scoring routes are auth-gated anyway). Player
// names arrive already masked to first-name-only from the server loader.
export default function PublicTournamentBrackets({
  tournamentId,
  divisions,
  isRolling,
}: {
  tournamentId: string
  divisions: Division[]
  isRolling?: boolean
}) {
  return (
    <div className="space-y-8">
      {divisions.map((d) => (
        <section key={d.id} className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark border-b border-brand-border pb-2">
            {d.name}
          </h2>
          <div className="overflow-x-auto">
            <BracketView
              matches={d.matches}
              regs={d.regs}
              isOrganizer={false}
              isDoubles={d.isDoubles}
              tournamentId={tournamentId}
              divisionId={d.id}
              onScoreUpdate={() => {}}
              isRolling={isRolling}
              listLayout={!d.isBracket}
              pointsToWin={d.pointsToWin}
              showSeeds={d.showSeeds}
            />
          </div>
        </section>
      ))}
    </div>
  )
}
