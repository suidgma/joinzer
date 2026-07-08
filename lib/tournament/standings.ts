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
// The ranking math lives in the entity-agnostic core `rankEntities()` (keyed on an
// opaque entity id). `computeStandings()` wraps it for REGISTRATION entities (folding
// doubles partners into one canonical row). Team League ranks TEAM entities by calling
// `rankEntities()` directly with team ids — same rules, no fork. See
// docs/phases/team-league.md §0b.

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

// ── Entity-agnostic ranking core ────────────────────────────────────────────────
// A head-to-head result already resolved to entity ids (registrations, teams, …).
export type RankMatch = { sideAId: string; sideBId: string; winnerId: string | null; scoreA: number; scoreB: number }
export type RankRow = { entityId: string; wins: number; losses: number; pf: number; pa: number }

// Rank arbitrary entities by win% → point differential → head-to-head → PF → name.
// `seedIds` seeds 0–0 baseline rows (their order is the final insertion-order tiebreak
// for fully-equal rows); `matches` are the counted results resolved to entity ids.
export function rankEntities(
  matches: RankMatch[],
  seedIds: string[],
  nameOf?: (entityId: string) => string,
): RankRow[] {
  const make = (id: string): RankRow => ({ entityId: id, wins: 0, losses: 0, pf: 0, pa: 0 })
  const map = new Map<string, RankRow>()
  for (const id of seedIds) if (!map.has(id)) map.set(id, make(id))

  for (const m of matches) {
    if (!map.has(m.sideAId)) map.set(m.sideAId, make(m.sideAId))
    if (!map.has(m.sideBId)) map.set(m.sideBId, make(m.sideBId))
    const r1 = map.get(m.sideAId)!, r2 = map.get(m.sideBId)!
    if (m.winnerId === m.sideAId) { r1.wins++; r2.losses++ }
    else if (m.winnerId === m.sideBId) { r2.wins++; r1.losses++ }
    r1.pf += m.scoreA; r1.pa += m.scoreB
    r2.pf += m.scoreB; r2.pa += m.scoreA
  }

  // Win% over a team's own games; 0–0 (pre-play) is 0 so the name tiebreak orders it.
  const winPct = (r: RankRow) => {
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
  // record against *each other*, then head-to-head +/-, then overall PF, then name.
  const groupKey = (r: RankRow) => `${winPct(r).toFixed(6)}|${r.pf - r.pa}`
  const ordered: RankRow[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i + 1
    while (j < rows.length && groupKey(rows[j]) === groupKey(rows[i])) j++
    const group = rows.slice(i, j)
    if (group.length > 1) {
      const ids = new Set(group.map(g => g.entityId))
      const h2h = new Map(group.map(g => [g.entityId, { wins: 0, pf: 0, pa: 0 }]))
      for (const mm of matches) {
        if (!ids.has(mm.sideAId) || !ids.has(mm.sideBId)) continue
        const a = h2h.get(mm.sideAId)!, b = h2h.get(mm.sideBId)!
        if (mm.winnerId === mm.sideAId) a.wins++; else if (mm.winnerId === mm.sideBId) b.wins++
        a.pf += mm.scoreA; a.pa += mm.scoreB; b.pf += mm.scoreB; b.pa += mm.scoreA
      }
      const hWins = (id: string) => h2h.get(id)!.wins
      const hDiff = (id: string) => h2h.get(id)!.pf - h2h.get(id)!.pa
      group.sort((a, b) => {
        if (hWins(b.entityId) !== hWins(a.entityId)) return hWins(b.entityId) - hWins(a.entityId)
        if (hDiff(b.entityId) !== hDiff(a.entityId)) return hDiff(b.entityId) - hDiff(a.entityId)
        if (b.pf !== a.pf) return b.pf - a.pf
        return nameOf ? nameOf(a.entityId).localeCompare(nameOf(b.entityId)) : 0
      })
    }
    ordered.push(...group)
    i = j
  }
  return ordered
}

// Registration-entity standings: folds each doubles pair (two cross-linked
// registrations) into one canonical row, then ranks via the shared core.
export function computeStandings(
  matches: StandingsMatchInput[],
  regs: StandingsRegInput[],
  // Optional display-name resolver, used only as the final tiebreaker so equal
  // rows sort alphabetically (and the pre-play 0–0 state isn't seed/insertion order).
  nameOf?: (regId: string) => string,
): StandingsRow[] {
  const active = regs.filter(r => r.status === 'registered')

  const canonicalId = new Map<string, string>()
  const seen = new Set<string>()
  const seedIds: string[] = []
  for (const r of active) {
    if (seen.has(r.id)) continue
    seedIds.push(r.id); seen.add(r.id); canonicalId.set(r.id, r.id)
    if (r.partner_registration_id) { seen.add(r.partner_registration_id); canonicalId.set(r.partner_registration_id, r.id) }
  }
  const canon = (id: string) => canonicalId.get(id) ?? id

  const rankMatches: RankMatch[] = []
  for (const m of matches) {
    if (m.status !== 'completed' || !m.team_1_registration_id || !m.team_2_registration_id) continue
    rankMatches.push({
      sideAId: canon(m.team_1_registration_id),
      sideBId: canon(m.team_2_registration_id),
      winnerId: m.winner_registration_id ? canon(m.winner_registration_id) : null,
      scoreA: m.team_1_score ?? 0,
      scoreB: m.team_2_score ?? 0,
    })
  }

  return rankEntities(rankMatches, seedIds, nameOf).map(r => ({
    regId: r.entityId, wins: r.wins, losses: r.losses, pf: r.pf, pa: r.pa,
  }))
}
