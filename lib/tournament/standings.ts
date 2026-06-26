// Division standings, shared by the tournament-wide Standings tab and the
// per-division view on the division page so the two never drift.
//
// One ranking rule for every format (round robin, pool play, single/double elim):
//   1. Win percentage  (wins ÷ games played) — highest first
//   2. Point differential (+/-)              — highest first
//   3. Points scored (PF)                    — highest first
//   4. Team name                             — alphabetical (final tiebreak)
// Win% (rather than raw wins) keeps an undefeated team above one with the same
// number of wins but more losses, so a double-elim winners-bracket team still
// outranks a one-loss losers-bracket team without any bracket-position math.
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

  const make = (id: string): StandingsRow => ({ regId: id, wins: 0, losses: 0, pf: 0, pa: 0 })
  const map = new Map<string, StandingsRow>()
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
  }

  // Win% over a team's own games; 0–0 (pre-play) is 0 so the name tiebreak orders it.
  const winPct = (r: StandingsRow) => {
    const games = r.wins + r.losses
    return games === 0 ? 0 : r.wins / games
  }

  return Array.from(map.values())
    .sort((a, b) => {
      const wp = winPct(b) - winPct(a)
      if (wp !== 0) return wp
      const diff = (b.pf - b.pa) - (a.pf - a.pa)
      if (diff !== 0) return diff
      if (b.pf !== a.pf) return b.pf - a.pf
      // Still tied (notably everyone at 0–0 before any match): order alphabetically
      // by display name rather than leaving it at seed/insertion order.
      return nameOf ? nameOf(a.regId).localeCompare(nameOf(b.regId)) : 0
    })
}
