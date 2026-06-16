import { describe, it, expect } from 'vitest'
import { computeBracketReset, type MatchRow } from '../bracketBuilder'

// The first Championship has the winners-bracket champ as team_1 ('WB', 0 losses)
// and the losers-bracket champ as team_2 ('LB', 1 loss).
const champFinal = (winner: string | null): MatchRow => ({
  id: 'champ1', round_number: 1, match_number: 14, match_stage: 'championship',
  team_1_registration_id: 'WB', team_2_registration_id: 'LB',
  winner_registration_id: winner, status: 'completed',
})

describe('computeBracketReset — double-elim decider', () => {
  it('creates a reset when the LB champion (team_2) wins the first final', () => {
    const reset = computeBracketReset(champFinal('LB'), [champFinal('LB')])
    expect(reset).not.toBeNull()
    expect(reset!.match_stage).toBe('championship')
    expect(reset!.round_number).toBe(2)
    expect(reset!.team_1_registration_id).toBe('WB')   // undefeated team keeps its slot
    expect(reset!.team_2_registration_id).toBe('LB')
    expect(reset!.match_number).toBe(15)               // max(14) + 1
    expect(reset!.status).toBe('scheduled')
  })

  it('no reset when the WB champion (team_1) wins — title decided', () => {
    expect(computeBracketReset(champFinal('WB'), [champFinal('WB')])).toBeNull()
  })

  it('no reset for a non-championship match', () => {
    const wb: MatchRow = {
      id: 'x', round_number: 2, match_number: 5, match_stage: 'winners_bracket',
      team_1_registration_id: 'a', team_2_registration_id: 'b', winner_registration_id: 'a', status: 'completed',
    }
    expect(computeBracketReset(wb, [wb])).toBeNull()
  })

  it('is idempotent — no second reset when a round-2 championship already exists', () => {
    const existingReset: MatchRow = {
      id: 'champ2', round_number: 2, match_number: 15, match_stage: 'championship',
      team_1_registration_id: 'WB', team_2_registration_id: 'LB',
    }
    expect(computeBracketReset(champFinal('LB'), [champFinal('LB'), existingReset])).toBeNull()
  })

  it('no reset when the reset (round 2) final itself completes', () => {
    const resetFinal: MatchRow = {
      id: 'champ2', round_number: 2, match_number: 15, match_stage: 'championship',
      team_1_registration_id: 'WB', team_2_registration_id: 'LB', winner_registration_id: 'LB', status: 'completed',
    }
    expect(computeBracketReset(resetFinal, [champFinal('LB'), resetFinal])).toBeNull()
  })

  it('no reset without a recorded winner', () => {
    expect(computeBracketReset(champFinal(null), [champFinal(null)])).toBeNull()
  })
})
