// Division standings, shared by the tournament-wide Standings tab and the
// per-division view on the division page so the two never drift.
//
// One ranking rule for every format (round robin, pool play, single/double elim):
//   1. Win percentage  (wins ÷ games played) — highest first
//   2. Point differential (+/-)              — highest first
//   3. Head-to-head     (record among the tied teams, then their +/-)
//   4. Points scored (PF)                    — highest first
//   5. Team name                             — alphabetical (final tiebreak)
// Win% (rather than raw wins) keeps an undefeated team above one with the same
// number of wins but more losses, so a double-elim winners-bracket team still
// outranks a one-loss losers-bracket team without any bracket-position math.
// Head-to-head only breaks a tie once record AND +/- are equal (so a better +/-
// still wins even if you lost the head-to-head, matching the point-diff test).
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

  // Primary sort: win% then point differential. Everything tied beyond that is
  // broken by head-to-head (below), then PF, then name.
  const rows = Array.from(map.values()).sort((a, b) => {
    const wp = winPct(b) - winPct(a)
    if (wp !== 0) return wp
    return (b.pf - b.pa) - (a.pf - a.pa)
  })

  // Head-to-head: within each run of teams tied on (win%, +/-), re-rank by their
  // record against *each other* (only matches between the tied teams count), then
  // their head-to-head +/-, then overall PF, then name. This also cleanly handles
  // the pre-play 0–0 case (no head-to-head games → falls straight through to name).
  const groupKey = (r: StandingsRow) => `${winPct(r).toFixed(6)}|${r.pf - r.pa}`
  const ordered: StandingsRow[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i + 1
    while (j < rows.length && groupKey(rows[j]) === groupKey(rows[i])) j++
    const group = rows.slice(i, j)
    if (group.length > 1) {
      const ids = new Set(group.map(g => g.regId))
      const h2h = new Map(group.map(g => [g.regId, { wins: 0, pf: 0, pa: 0 }]))
      for (const mm of matches) {
        if (mm.status !== 'completed' || !mm.team_1_registration_id || !mm.team_2_registration_id) continue
        const t1 = canon(mm.team_1_registration_id), t2 = canon(mm.team_2_registration_id)
        if (!ids.has(t1) || !ids.has(t2)) continue
        const s1 = mm.team_1_score ?? 0, s2 = mm.team_2_score ?? 0
        const w = mm.winner_registration_id ? canon(mm.winner_registration_id) : null
        const a = h2h.get(t1)!, b = h2h.get(t2)!
        if (w === t1) a.wins++; else if (w === t2) b.wins++
        a.pf += s1; a.pa += s2; b.pf += s2; b.pa += s1
      }
      const hWins = (id: string) => h2h.get(id)!.wins
      const hDiff = (id: string) => h2h.get(id)!.pf - h2h.get(id)!.pa
      group.sort((a, b) => {
        if (hWins(b.regId) !== hWins(a.regId)) return hWins(b.regId) - hWins(a.regId)
        if (hDiff(b.regId) !== hDiff(a.regId)) return hDiff(b.regId) - hDiff(a.regId)
        if (b.pf !== a.pf) return b.pf - a.pf
        return nameOf ? nameOf(a.regId).localeCompare(nameOf(b.regId)) : 0
      })
    }
    ordered.push(...group)
    i = j
  }
  return ordered
}
