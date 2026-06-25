// Division standings, shared by the tournament-wide Standings tab and the
// per-division view on the division page so the two never drift.
//
// Elimination divisions (single/double elim) are ordered by bracket finish — the
// winner of the deepest match (championship > losers bracket > winners bracket,
// then round) is the champion; raw win count is wrong there (a double-elim
// champion can have fewer wins than a team that ran the losers bracket). Round
// robin / pool play order by win-loss, then point differential.
//
// Returns one canonical row per team (doubles partners folded together); the
// caller supplies the display name from regId.

export type StandingsMatchInput = {
  match_stage: string
  round_number: number | null
  status: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
}

export type StandingsRegInput = {
  id: string
  status: string
  partner_registration_id: string | null
}

export type StandingsRow = { regId: string; wins: number; losses: number; pf: number; pa: number }

const STAGE_RANK: Record<string, number> = {
  round_robin: 0, pool_play: 0,
  single_elimination: 1, winners_bracket: 1,
  losers_bracket: 2, playoffs: 3, consolation: 3, championship: 4,
}
const ELIM_STAGES = new Set(['single_elimination', 'winners_bracket', 'losers_bracket', 'championship'])
const phaseOf = (m: StandingsMatchInput) => (STAGE_RANK[m.match_stage] ?? 1) * 100 + (m.round_number ?? 1)

export function computeStandings(
  matches: StandingsMatchInput[],
  regs: StandingsRegInput[],
  // Optional display-name resolver, used only as the final tiebreaker so equal
  // rows sort alphabetically (and the pre-play 0–0 state isn't seed/insertion order).
  nameOf?: (regId: string) => string,
): StandingsRow[] {
  const active = regs.filter(r => r.status === 'registered')

  // Fold each doubles pair (two cross-linked registrations) into one canonical
  // row so a team never appears twice with a 0-stat phantom twin.
  const canonicalId = new Map<string, string>()
  const seen = new Set<string>()
  const rowRegs: StandingsRegInput[] = []
  for (const r of active) {
    if (seen.has(r.id)) continue
    rowRegs.push(r); seen.add(r.id); canonicalId.set(r.id, r.id)
    if (r.partner_registration_id) { seen.add(r.partner_registration_id); canonicalId.set(r.partner_registration_id, r.id) }
  }
  const canon = (id: string) => canonicalId.get(id) ?? id

  type Row = StandingsRow & { exitPhase: number; exitWon: boolean }
  const make = (id: string): Row => ({ regId: id, wins: 0, losses: 0, pf: 0, pa: 0, exitPhase: -1, exitWon: false })
  const map = new Map<string, Row>()
  for (const r of rowRegs) map.set(r.id, make(r.id))

  for (const m of matches) {
    if (m.status !== 'completed' || !m.team_1_registration_id || !m.team_2_registration_id) continue
    const t1 = canon(m.team_1_registration_id), t2 = canon(m.team_2_registration_id)
    const s1 = m.team_1_score ?? 0, s2 = m.team_2_score ?? 0
    if (!map.has(t1)) map.set(t1, make(t1))
    if (!map.has(t2)) map.set(t2, make(t2))
    const r1 = map.get(t1)!, r2 = map.get(t2)!
    const winner = m.winner_registration_id ? canon(m.winner_registration_id) : null
    if (winner === t1) { r1.wins++; r2.losses++ }
    else if (winner === t2) { r2.wins++; r1.losses++ }
    r1.pf += s1; r1.pa += s2
    r2.pf += s2; r2.pa += s1
    const ph = phaseOf(m)
    if (ph > r1.exitPhase) { r1.exitPhase = ph; r1.exitWon = winner === t1 }
    if (ph > r2.exitPhase) { r2.exitPhase = ph; r2.exitWon = winner === t2 }
  }

  const isElim = matches.some(m => ELIM_STAGES.has(m.match_stage))
  return Array.from(map.values())
    .sort((a, b) => {
      if (isElim) {
        // Fewest losses ranks highest. This is the spine of elimination standings:
        // an undefeated winners-bracket team must outrank a one-loss losers-bracket
        // team, and at completion the champion (0 losses, or 1 via a bracket reset)
        // outranks everyone eliminated at 2. Stage rank alone got this backwards —
        // losers_bracket outranks winners_bracket, so deeper-in-the-LB looked
        // "better" than still-undefeated.
        if (a.losses !== b.losses) return a.losses - b.losses
        // Within the same loss count, deeper finish is better — for eliminated teams
        // that's where they took their final loss (later round = higher placement);
        // for live teams it's how far they've advanced.
        if (b.exitPhase !== a.exitPhase) return b.exitPhase - a.exitPhase
        if (a.exitWon !== b.exitWon) return a.exitWon ? -1 : 1
      }
      const wd = b.wins - a.wins
      if (wd !== 0) return wd
      const dd = (b.pf - b.pa) - (a.pf - a.pa)
      if (dd !== 0) return dd
      // Still tied (notably everyone at 0–0 before any match): order alphabetically
      // by display name rather than leaving it at seed/insertion order.
      return nameOf ? nameOf(a.regId).localeCompare(nameOf(b.regId)) : 0
    })
    .map(({ regId, wins, losses, pf, pa }) => ({ regId, wins, losses, pf, pa }))
}
