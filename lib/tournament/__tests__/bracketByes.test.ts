import { describe, it, expect } from 'vitest'
import { singleEliminationBracket, doubleEliminationBracket } from '../bracketBuilder'

// Regression: a non-power-of-2 field must distribute byes across the bracket
// ("player vs BYE", auto-advanced) instead of clustering the empty slots at the
// end as phantom "BYE vs BYE" matches. 10 teams → 16-slot bracket → 6 byes.

const teams = Array.from({ length: 10 }, (_, i) => `t${i}`)

describe('single elimination — bye distribution', () => {
  const { rows } = singleEliminationBracket(teams, 'single_elimination', {}, 1, true)
  const round1 = rows.filter((r: any) => r.round_number === 1)

  it('creates a full 16-slot bracket (8 + 4 + 2 + 1 = 15 matches)', () => {
    expect(rows.length).toBe(15)
    expect(round1.length).toBe(8)
  })

  it('has NO "BYE vs BYE" matches (both slots null)', () => {
    const byeVsBye = round1.filter((r: any) => r.team_1_registration_id == null && r.team_2_registration_id == null)
    expect(byeVsBye.length).toBe(0)
  })

  it('awards exactly 6 byes, auto-completed with a winner', () => {
    const byes = round1.filter((r: any) => r.status === 'completed' && r.winner_registration_id != null)
    expect(byes.length).toBe(6)
    // The 2 remaining round-1 matches are real (both teams present).
    const real = round1.filter((r: any) => r.team_1_registration_id != null && r.team_2_registration_id != null)
    expect(real.length).toBe(2)
  })

  it('places every team somewhere in round 1', () => {
    const placed = new Set<string>()
    for (const r of round1 as any[]) {
      if (r.team_1_registration_id) placed.add(r.team_1_registration_id)
      if (r.team_2_registration_id) placed.add(r.team_2_registration_id)
    }
    expect(placed.size).toBe(10)
  })
})

describe('double elimination — bye distribution', () => {
  it('has no "BYE vs BYE" in the winners-bracket round 1', () => {
    const rows = doubleEliminationBracket(teams, {}, 1, true)
    const wbR1 = rows.filter((r: any) => r.match_stage === 'winners_bracket' && r.round_number === 1)
    const byeVsBye = wbR1.filter((r: any) => r.team_1_registration_id == null && r.team_2_registration_id == null)
    expect(byeVsBye.length).toBe(0)
  })
})
