import { describe, it, expect } from 'vitest'
import { singleEliminationBracket } from '../bracketBuilder'
import { computeByeAdvancements } from '../advanceByes'

// Regression for the dropped-bye bug: a round-1 BYE winner must be advanced into
// its round-2 slot. Without it, the slot stays empty, the quarter auto-resolves
// as a walkover, and the player who earned the bye is silently eliminated.

function withIds(rows: any[]) {
  return rows.map((r, i) => ({ ...r, id: `m${i}` }))
}

describe('computeByeAdvancements — single elimination', () => {
  // 12 teams → 16-slot bracket → 4 byes, all in round 1.
  const teams = Array.from({ length: 12 }, (_, i) => `t${i}`)
  const rows = withIds(singleEliminationBracket(teams, 'single_elimination', {}, 1, true).rows)
  const r1 = rows.filter(r => r.round_number === 1).sort((a, b) => a.match_number - b.match_number)
  const r2 = rows.filter(r => r.round_number === 2).sort((a, b) => a.match_number - b.match_number)

  const updates = computeByeAdvancements(rows, 'single_elimination')

  it('produces one advancement per round-1 bye (4 byes)', () => {
    const byes = r1.filter(m => m.status === 'completed' && m.winner_registration_id)
    expect(byes.length).toBe(4)
    expect(updates.length).toBe(4)
  })

  it('advances each bye winner into the correct round-2 slot', () => {
    for (let i = 0; i < r1.length; i++) {
      const m = r1[i]
      if (m.status !== 'completed' || !m.winner_registration_id) continue
      const target = r2[Math.floor(i / 2)]
      const field = i % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
      const found = updates.find(u => u.matchId === target.id && u.set[field] === m.winner_registration_id)
      expect(found, `bye r1[${i}] should advance to ${target.id}.${field}`).toBeTruthy()
    }
  })

  it('leaves no bye-fed round-2 slot empty after applying updates', () => {
    const byId = new Map(rows.map(r => [r.id, { ...r } as any]))
    for (const u of updates) Object.assign(byId.get(u.matchId)!, u.set)
    for (let i = 0; i < r1.length; i++) {
      const m = r1[i]
      if (m.status !== 'completed' || !m.winner_registration_id) continue
      const target = byId.get(r2[Math.floor(i / 2)].id)!
      const field = i % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
      expect(target[field]).toBe(m.winner_registration_id)
    }
  })

  it('is a no-op for a power-of-2 field (no byes)', () => {
    const full = withIds(singleEliminationBracket(
      Array.from({ length: 8 }, (_, i) => `p${i}`), 'single_elimination', {}, 1, true,
    ).rows)
    expect(computeByeAdvancements(full, 'single_elimination')).toHaveLength(0)
  })
})
