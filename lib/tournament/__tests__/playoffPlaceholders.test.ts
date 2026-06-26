import { describe, it, expect } from 'vitest'
import {
  roundRobinSources,
  poolSources,
  buildPlaceholderPlayoffs,
  resolvePlayoffSource,
  type PlayoffSource,
} from '../playoffPlaceholders'
import { resolveBracket } from '../resolveCompletion'

type Row = Record<string, any>
const labelOf = (s: PlayoffSource | undefined) => s?.label

describe('source labels', () => {
  it('round robin → ordinal labels in seed order', () => {
    expect(roundRobinSources(4).map(s => s.label)).toEqual(['1st', '2nd', '3rd', '4th'])
  })
  it('pool play, 1 advance → "Pool N Winner"', () => {
    expect(poolSources(2, 1).map(s => s.label)).toEqual(['Pool 1 Winner', 'Pool 2 Winner'])
  })
  it('pool play, 2 advance → interleaved "Pool N #R" in seed order', () => {
    expect(poolSources(2, 2).map(s => s.label)).toEqual(['Pool 1 #1', 'Pool 2 #1', 'Pool 1 #2', 'Pool 2 #2'])
  })
})

describe('buildPlaceholderPlayoffs — round robin', () => {
  it('top 2 → a single final, 1st vs 2nd, no teams, not completed', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(2), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, { status: 'scheduled' }, 1) as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].team_1_registration_id).toBeNull()
    expect(rows[0].team_2_registration_id).toBeNull()
    expect(labelOf(rows[0].team_1_source)).toBe('1st')
    expect(labelOf(rows[0].team_2_source)).toBe('2nd')
    expect(rows[0].status).toBe('scheduled')
  })

  it('top 4 → round 1 is 1st-vs-4th and 2nd-vs-3rd; final is a pure placeholder', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(4), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, {}, 1) as Row[]
    const r1 = rows.filter(r => r.round_number === 1)
    expect(r1).toHaveLength(2)
    const pairs = r1.map(m => [labelOf(m.team_1_source), labelOf(m.team_2_source)].sort())
    expect(pairs).toContainEqual(['1st', '4th'])
    expect(pairs).toContainEqual(['2nd', '3rd'])
    // The final has no source and no team yet.
    const final = rows.find(r => r.round_number === 2)
    expect(final?.team_1_source).toBeUndefined()
    expect(final?.team_1_registration_id).toBeNull()
    // Nothing is auto-completed.
    expect(rows.every(r => r.status !== 'completed')).toBe(true)
  })

  it('top 6 → byes for the top two seeds are placeholders, not completed', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(6), { engine: 'single' }, {}, 1) as Row[]
    expect(rows.every(r => r.status !== 'completed')).toBe(true)
    // The two bye matches: exactly one source, the other side empty.
    const byes = rows.filter(r => r.round_number === 1 && (!!r.team_1_source !== !!r.team_2_source))
    expect(byes).toHaveLength(2)
    expect(byes.map(b => labelOf(b.team_1_source ?? b.team_2_source)).sort()).toEqual(['1st', '2nd'])
  })
})

describe('buildPlaceholderPlayoffs — pool play (double elim)', () => {
  it('2 pools, top 2 → WB round 1 cross-seeds the pools', () => {
    const rows = buildPlaceholderPlayoffs(poolSources(2, 2), { engine: 'double' }, {}, 1) as Row[]
    const wb1 = rows.filter(r => r.match_stage === 'winners_bracket' && r.round_number === 1)
    expect(wb1).toHaveLength(2)
    const pairs = wb1.map(m => [labelOf(m.team_1_source), labelOf(m.team_2_source)].sort())
    // Pool winner meets the OTHER pool's runner-up.
    expect(pairs).toContainEqual(['Pool 1 #1', 'Pool 2 #2'])
    expect(pairs).toContainEqual(['Pool 1 #2', 'Pool 2 #1'])
    expect(rows.every(r => r.status !== 'completed')).toBe(true)
    // A losers bracket + championship exist as pure placeholders.
    expect(rows.some(r => r.match_stage === 'losers_bracket')).toBe(true)
    expect(rows.some(r => r.match_stage === 'championship')).toBe(true)
  })
})

describe('resolvePlayoffSource', () => {
  const overall = [{ regId: 'A' }, { regId: 'B' }, { regId: 'C' }, { regId: 'D' }]
  const pools = new Map([[1, [{ regId: 'X' }, { regId: 'Y' }]], [2, [{ regId: 'Z' }, { regId: 'W' }]]])

  it('maps a rank source to the overall standings position', () => {
    expect(resolvePlayoffSource({ kind: 'rank', rank: 1, label: '1st' }, overall, pools)).toBe('A')
    expect(resolvePlayoffSource({ kind: 'rank', rank: 4, label: '4th' }, overall, pools)).toBe('D')
  })
  it('maps a pool_rank source to that pool\'s standings position', () => {
    expect(resolvePlayoffSource({ kind: 'pool_rank', pool: 1, rank: 1, label: '' }, overall, pools)).toBe('X')
    expect(resolvePlayoffSource({ kind: 'pool_rank', pool: 2, rank: 2, label: '' }, overall, pools)).toBe('W')
  })
  it('returns null when the position does not exist', () => {
    expect(resolvePlayoffSource({ kind: 'rank', rank: 9, label: '9th' }, overall, pools)).toBeNull()
  })
})

// Mirrors the resolve route: fill each round-1 placeholder slot from the standings,
// then run resolveBracket to cascade byes/advancement.
function seedAndCascade(rows: Row[], overall: { regId: string }[]): Row[] {
  const matches: Row[] = rows.map((r, i) => ({ ...r, id: `m${i}` }))
  for (const m of matches) {
    if (m.team_1_source) { m.team_1_registration_id = resolvePlayoffSource(m.team_1_source, overall, new Map()); m.team_1_source = null }
    if (m.team_2_source) { m.team_2_registration_id = resolvePlayoffSource(m.team_2_source, overall, new Map()); m.team_2_source = null }
  }
  const byId = new Map(matches.map(m => [m.id, m]))
  for (const mut of resolveBracket(matches as any)) {
    if (mut.kind === 'set') { const t = byId.get(mut.matchId); if (t && t[mut.field] == null) t[mut.field] = mut.value }
    else if (mut.kind === 'complete') { const t = byId.get(mut.matchId); if (t) { t.status = 'completed'; t.winner_registration_id = mut.winner } }
  }
  return matches
}

describe('placeholder resolution — seed from standings then cascade', () => {
  it('top 4: round 1 fills 1st-vs-4th and 2nd-vs-3rd, final stays open', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(4), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, { status: 'scheduled' }, 1) as Row[]
    const overall = ['A', 'B', 'C', 'D'].map(regId => ({ regId }))
    const matches = seedAndCascade(rows, overall)
    const r1 = matches.filter(m => m.round_number === 1)
    const pairs = r1.map(m => [m.team_1_registration_id, m.team_2_registration_id].sort())
    expect(pairs).toContainEqual(['A', 'D'])
    expect(pairs).toContainEqual(['B', 'C'])
    // No byes → nothing auto-completes; the final is still waiting on the semis.
    expect(r1.every(m => m.status !== 'completed')).toBe(true)
    const final = matches.find(m => m.round_number === 2)
    expect(final?.team_1_registration_id ?? null).toBeNull()
  })

  it('top 6: the two byes auto-advance the 1st and 2nd seeds into round 2', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(6), { engine: 'single' }, { status: 'scheduled' }, 1) as Row[]
    const overall = ['A', 'B', 'C', 'D', 'E', 'F'].map(regId => ({ regId }))
    const matches = seedAndCascade(rows, overall)
    // The two bye matches completed, won by the top two seeds.
    const completed = matches.filter(m => m.status === 'completed')
    expect(completed).toHaveLength(2)
    expect(completed.map(m => m.winner_registration_id).sort()).toEqual(['A', 'B'])
    // Round 2 already holds A and B (advanced from their byes).
    const r2Teams = matches.filter(m => m.round_number === 2).flatMap(m => [m.team_1_registration_id, m.team_2_registration_id])
    expect(r2Teams).toContain('A')
    expect(r2Teams).toContain('B')
  })
})
