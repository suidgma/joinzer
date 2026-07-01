'use client'

import { useEffect } from 'react'
import { Printer } from 'lucide-react'
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
  matches: Match[]
  regs: Reg[]
}

type Props = {
  tournamentId: string
  tournamentName: string
  startDate: string
  divisions: Division[]
}

// Scoped to this page while it's mounted: hide the app chrome, force a white
// background and landscape orientation, and let the wide bracket columns expand
// past their scroll container so nothing is clipped on paper.
const PRINT_CSS = `
@media print {
  @page { size: landscape; margin: 0.4in; }
  header, nav { display: none !important; }
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .overflow-x-auto { overflow: visible !important; }
  /* Reinforce Tailwind's break-inside-avoid with the legacy alias. Chrome's print engine
     honors page-break-inside more reliably (esp. around wrapped/flex content), so a round,
     a match card, or a whole bracket stays on one page when it fits. */
  .break-inside-avoid { break-inside: avoid !important; page-break-inside: avoid !important; }
}
`

export default function PrintBrackets({ tournamentId, tournamentName, startDate, divisions }: Props) {
  // Open the print dialog automatically once the brackets have rendered.
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600)
    return () => clearTimeout(t)
  }, [])

  const dateLabel = new Date(startDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="mx-auto max-w-none bg-white px-6 py-6">
      <style>{PRINT_CSS}</style>

      {/* Controls — hidden on paper */}
      <div className="no-print mb-6 flex items-center justify-between">
        <button
          onClick={() => {
            // This page opens in its own tab (organizer Export → window.open),
            // so there's no history to go back to. Close the print tab to return
            // to the Live view; if it wasn't script-opened (direct navigation),
            // window.close() no-ops, so fall back to the tournament page.
            window.close()
            setTimeout(() => { if (!window.closed) window.location.href = `/tournaments/${tournamentId}` }, 50)
          }}
          className="text-sm text-brand-muted hover:text-brand-dark"
        >
          ← Back
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-dark hover:bg-brand-hover transition-colors"
        >
          <Printer size={15} /> Print / Save as PDF
        </button>
      </div>

      {/* Title block */}
      <div className="mb-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-muted">Match Brackets</p>
        <h1 className="font-heading text-2xl font-bold text-brand-dark">{tournamentName}</h1>
        <p className="text-sm text-brand-muted">{dateLabel}</p>
      </div>

      {divisions.length === 0 ? (
        <p className="no-print py-12 text-center text-sm text-brand-muted">
          No matches have been generated yet. Set up the schedule first, then export.
        </p>
      ) : (
        divisions.map((d, i) => (
          // Start each division on a fresh page when printing.
          <section key={d.id} style={{ breakBefore: i === 0 ? 'auto' : 'page' }} className="mb-12">
            <h2 className="mb-4 border-b border-brand-border pb-2 font-heading text-base font-bold text-brand-dark">
              {d.name}
            </h2>
            <BracketView
              matches={d.matches}
              regs={d.regs}
              isOrganizer={false}
              isDoubles={d.isDoubles}
              tournamentId={tournamentId}
              divisionId={d.id}
              onScoreUpdate={() => {}}
              listLayout={!d.isBracket}
              pointsToWin={d.pointsToWin}
              showSeeds
            />
          </section>
        ))
      )}
    </div>
  )
}
