import { describe, it, expect } from 'vitest'
import { checkInLocally, rescheduleLocally, resolvePlayoffsLocally, type LocalReg } from '../localOps'
import { buildPlaceholderPlayoffs, roundRobinSources, poolSources } from '../../tournament/playoffPlaceholders'
import type { LocalMatch } from '../applyMutations'
import type { StandingsRegInput } from '../../tournament/standings'

type Row = Record<string, any>
const withIds = (rows: Record<string, unknown>[], offset = 0): Row[] =>
  rows.map((r, i) => ({ id: `m${offset + i}`, team_1_score: null, team_2_score: null, ...r }))

// A completed base-play match (round robin / pool).
const bm = (stage: string, t1: string, t2: string, s1: number, s2: number, pool?: number): Row => ({
  match_stage: stage, round_number: 1, match_number: 1, pool_number: pool ?? null,
  team_1_registration_id: t1, team_2_registration_id: t2,
  team_1_score: s1, team_2_score: s2, winner_registration_id: s1 > s2 ? t1 : t2, status: 'completed',
})

const fingerprint = (rs: Row[]) =>
  rs.map(r => `${r.id}:${r.team_1_registration_id}|${r.team_2_registration_id}|${r.winner_registration_id}|${r.status}`).sort()

describe('checkInLocally', () => {
  const regs: LocalReg[] = [{ id: 'r1', checked_in: false }, { id: 'r2', checked_in: false }]
  it('sets the flag on the target reg only', () => {
    const out = checkInLocally(regs, 'r1', true)
    expect(out.find(r => r.id === 'r1')!.checked_in).toBe(true)
    expect(out.find(r => r.id === 'r2')!.checked_in).toBe(false)
  })
  it('is idempotent (re-checking-in changes nothing)', () => {
    const once = checkInLocally(regs, 'r1', true)
    expect(checkInLocally(once, 'r1', true)).toEqual(once)
  })
  it('can undo a check-in', () => {
    expect(checkInLocally(checkInLocally(regs, 'r1', true), 'r1', false).find(r => r.id === 'r1')!.checked_in).toBe(false)
  })
})

describe('rescheduleLocally', () => {
  const matches = [
    { id: 'a', round_number: 1, match_number: 1, match_stage: 'single_elimination', team_1_registration_id: 'x', team_2_registration_id: 'y', status: 'scheduled', court_number: 1, scheduled_time: '2026-06-30T08:00:00-07:00' },
    { id: 'b', round_number: 1, match_number: 2, match_stage: 'single_elimination', team_1_registration_id: 'p', team_2_registration_id: 'q', status: 'scheduled', court_number: 2, scheduled_time: '2026-06-30T08:00:00-07:00' },
  ] as any[]
  it('moves one match, leaves the rest', () => {
    const out = rescheduleLocally(matches, 'a', 5, '2026-06-30T09:40:00-07:00')
    expect(out.find(m => m.id === 'a')).toMatchObject({ court_number: 5, scheduled_time: '2026-06-30T09:40:00-07:00' })
    expect(out.find(m => m.id === 'b')).toMatchObject({ court_number: 2 })
  })
  it('is idempotent (last-write-wins)', () => {
    const once = rescheduleLocally(matches, 'a', 5, '2026-06-30T09:40:00-07:00')
    expect(rescheduleLocally(once, 'a', 5, '2026-06-30T09:40:00-07:00')).toEqual(once)
  })
})

describe('resolvePlayoffsLocally — round robin', () => {
  // A 4-player round robin: A 3-0, B 2-1, C 1-2, D 0-3, plus a top-2 placeholder final.
  const regs: StandingsRegInput[] = ['A', 'B', 'C', 'D'].map(id => ({ id, status: 'registered', partner_registration_id: null }))
  const rr = withIds([
    bm('round_robin', 'A', 'B', 11, 7), bm('round_robin', 'A', 'C', 11, 4), bm('round_robin', 'A', 'D', 11, 2),
    bm('round_robin', 'B', 'C', 11, 8), bm('round_robin', 'B', 'D', 11, 5), bm('round_robin', 'C', 'D', 11, 9),
  ])
  const placeholder = withIds(
    buildPlaceholderPlayoffs(roundRobinSources(2), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, { status: 'scheduled' }, rr.length + 1),
    rr.length,
  )
  const matches = [...rr, ...placeholder]

  it('seeds the final with 1st vs 2nd from the standings and clears the sources', () => {
    const out = resolvePlayoffsLocally(matches as LocalMatch[], regs, 'round_robin')
    const final = out.find(m => m.match_stage === 'playoffs')!
    expect([final.team_1_registration_id, final.team_2_registration_id].sort()).toEqual(['A', 'B'])
    expect(final.team_1_source).toBeNull()
    expect(final.team_2_source).toBeNull()
  })

  it('is idempotent — re-running after seeding changes nothing', () => {
    const once = resolvePlayoffsLocally(matches as LocalMatch[], regs, 'round_robin')
    const twice = resolvePlayoffsLocally(once, regs, 'round_robin')
    expect(fingerprint(twice as Row[])).toEqual(fingerprint(once as Row[]))
  })
})

describe('resolvePlayoffsLocally — pool play (double elim)', () => {
  // 2 pools of 2, top 2 advance (all 4). Pool 1: A>B, Pool 2: C>D.
  const regs: StandingsRegInput[] = ['A', 'B', 'C', 'D'].map(id => ({ id, status: 'registered', partner_registration_id: null }))
  const pools = withIds([bm('pool_play', 'A', 'B', 11, 5, 1), bm('pool_play', 'C', 'D', 11, 6, 2)])
  const placeholder = withIds(buildPlaceholderPlayoffs(poolSources(2, 2), { engine: 'double' }, { status: 'scheduled' }, pools.length + 1), pools.length)
  const matches = [...pools, ...placeholder]

  it('cross-seeds WB round 1 from the pool standings (pool winner vs other pool runner-up)', () => {
    const out = resolvePlayoffsLocally(matches as LocalMatch[], regs, 'pool_play_playoffs')
    const wb1 = out.filter(m => m.match_stage === 'winners_bracket' && m.round_number === 1)
    const pairs = wb1.map(m => [m.team_1_registration_id, m.team_2_registration_id].sort())
    // Pool 1 #1 (A) vs Pool 2 #2 (D); Pool 2 #1 (C) vs Pool 1 #2 (B).
    expect(pairs).toContainEqual(['A', 'D'])
    expect(pairs).toContainEqual(['B', 'C'])
    expect(out.every(m => m.team_1_source == null && m.team_2_source == null)).toBe(true)
  })

  it('is idempotent', () => {
    const once = resolvePlayoffsLocally(matches as LocalMatch[], regs, 'pool_play_playoffs')
    const twice = resolvePlayoffsLocally(once, regs, 'pool_play_playoffs')
    expect(fingerprint(twice as Row[])).toEqual(fingerprint(once as Row[]))
  })
})
