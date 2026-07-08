// Pure logic for Team League matchups — the two pieces the routes used to inline:
//   • validateLineup — per-line player assignment rules (count, roster, dupes, multi-line)
//   • rollUpMatchup  — line scores → parent matchup result (line wins, winner, completion)
// Extracted so both are unit-testable in isolation; the routes call these and only do I/O.
// Behavior-identical to the original inline route logic (same rules, same messages).

// ── Lineup validation ───────────────────────────────────────────────────────────
export type LineConfig = { discipline?: string }
export type LineupInput = { team1?: (string | null)[]; team2?: (string | null)[] }
export type LineupRow = {
  match_number: number
  team_1_registration_id: string
  team_1_partner_registration_id: string | null
  team_2_registration_id: string
  team_2_partner_registration_id: string | null
}
export type LineupValidation = { ok: true; rows: LineupRow[] } | { ok: false; error: string }

// side 1 = the matchup's team_1 roster, side 2 = team_2. `allowMulti` lets a player
// appear on more than one line. Returns the ordered line rows (sans I/O columns) or the
// first rule violation.
export function validateLineup(
  lineConfigs: LineConfig[],
  lineups: LineupInput[],
  roster1: Set<string>,
  roster2: Set<string>,
  allowMulti: boolean,
): LineupValidation {
  if (lineConfigs.length === 0) return { ok: false, error: 'This league has no line configuration' }
  if (lineups.length !== lineConfigs.length) return { ok: false, error: 'Lineup must cover every line' }

  const used1 = new Set<string>()
  const used2 = new Set<string>()
  const rows: LineupRow[] = []
  for (let i = 0; i < lineConfigs.length; i++) {
    const expected = lineConfigs[i].discipline === 'singles' ? 1 : 2
    const t1 = (lineups[i]?.team1 ?? []).filter(Boolean) as string[]
    const t2 = (lineups[i]?.team2 ?? []).filter(Boolean) as string[]
    if (t1.length !== expected || t2.length !== expected) return { ok: false, error: `Line ${i + 1} needs ${expected} player${expected > 1 ? 's' : ''} per side` }
    if (new Set(t1).size !== t1.length || new Set(t2).size !== t2.length) return { ok: false, error: `Line ${i + 1} has a duplicate player` }
    for (const r of t1) {
      if (!roster1.has(r)) return { ok: false, error: `Line ${i + 1}: a selected player isn't on that team's roster` }
      if (!allowMulti && used1.has(r)) return { ok: false, error: 'A player is assigned to more than one line' }
    }
    for (const r of t2) {
      if (!roster2.has(r)) return { ok: false, error: `Line ${i + 1}: a selected player isn't on that team's roster` }
      if (!allowMulti && used2.has(r)) return { ok: false, error: 'A player is assigned to more than one line' }
    }
    if (!allowMulti) { t1.forEach((r) => used1.add(r)); t2.forEach((r) => used2.add(r)) }
    rows.push({
      match_number: i + 1,
      team_1_registration_id: t1[0],
      team_1_partner_registration_id: t1[1] ?? null,
      team_2_registration_id: t2[0],
      team_2_partner_registration_id: t2[1] ?? null,
    })
  }
  return { ok: true, rows }
}

// ── Matchup roll-up ─────────────────────────────────────────────────────────────
export type LineChild = {
  id: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  status: string
}
export type ProvidedScore = { team_1_score: number; team_2_score: number }
export type ChildUpdate = { id: string; team_1_score: number; team_2_score: number; winner_registration_id: string | null; status: 'completed' }
export type MatchupRollup = {
  childUpdates: ChildUpdate[]
  team1Lines: number
  team2Lines: number
  winnerTeamId: string | null
  completed: boolean
}

// Given the current child line fixtures and the newly-provided scores (keyed by child id),
// produce the child writes plus the parent tally: line wins per team, the matchup winner
// (the team that won more lines; tie → null), and whether every line is now scored. Lines
// not in `provided` keep their stored state, so partial saves accumulate.
export function rollUpMatchup(
  children: LineChild[],
  provided: Map<string, ProvidedScore>,
  team1Id: string,
  team2Id: string,
): MatchupRollup {
  const childUpdates: ChildUpdate[] = []
  for (const child of children) {
    const s = provided.get(child.id)
    if (!s) continue
    const winner_registration_id = s.team_1_score > s.team_2_score ? child.team_1_registration_id : child.team_2_registration_id
    childUpdates.push({ id: child.id, team_1_score: s.team_1_score, team_2_score: s.team_2_score, winner_registration_id, status: 'completed' })
  }

  const merged = children.map((c) => {
    const s = provided.get(c.id)
    return s ? { ...c, team_1_score: s.team_1_score, team_2_score: s.team_2_score, status: 'completed' } : c
  })
  let team1Lines = 0
  let team2Lines = 0
  for (const c of merged) {
    if (c.status !== 'completed' || c.team_1_score == null || c.team_2_score == null) continue
    if (c.team_1_score > c.team_2_score) team1Lines++
    else team2Lines++
  }
  const completed = merged.every((c) => c.status === 'completed')
  const winnerTeamId = !completed || team1Lines === team2Lines ? null : team1Lines > team2Lines ? team1Id : team2Id
  return { childUpdates, team1Lines, team2Lines, winnerTeamId, completed }
}
