import { describe, it, expect } from 'vitest'
import {
  roundRobinSources,
  poolSources,
  buildPlaceholderPlayoffs,
  resolvePlayoffSource,
  type PlayoffSource,
} from '../playoffPlaceholders'
import { resolveBracket, resolveCompletion, phantomMatchIds } from '../resolveCompletion'

type Row = Record<string, any>
const labelOf = (s: PlayoffSource | undefined) => s?.label
const withIds = (rows: Row[]): Row[] => rows.map((r, i) => ({ id: `m${i}`, ...r }))

describe('source labels', () => {
  it('round robin → "Nth place" in seed order', () => {
    expect(roundRobinSources(4).map(s => s.label)).toEqual(['1st place', '2nd place', '3rd place', '4th place'])
  })
  it('pool play, 1 advance → "Pool N - 1st place"', () => {
    expect(poolSources(2, 1).map(s => s.label)).toEqual(['Pool 1 - 1st place', 'Pool 2 - 1st place'])
  })
  it('pool play, 2 advance → interleaved "Pool N - Rth place" in seed order', () => {
    expect(poolSources(2, 2).map(s => s.label)).toEqual(['Pool 1 - 1st place', 'Pool 2 - 1st place', 'Pool 1 - 2nd place', 'Pool 2 - 2nd place'])
  })
})

describe('buildPlaceholderPlayoffs — round robin', () => {
  it('top 2 → a single final, 1st vs 2nd, no teams, not completed', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(2), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, { status: 'scheduled' }, 1) as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].team_1_registration_id).toBeNull()
    expect(rows[0].team_2_registration_id).toBeNull()
    expect(labelOf(rows[0].team_1_source)).toBe('1st place')
    expect(labelOf(rows[0].team_2_source)).toBe('2nd place')
    expect(rows[0].status).toBe('scheduled')
  })

  it('top 4 → round 1 is 1st-vs-4th and 2nd-vs-3rd; final is a pure placeholder', () => {
    const rows = buildPlaceholderPlayoffs(roundRobinSources(4), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, {}, 1) as Row[]
    const r1 = rows.filter(r => r.round_number === 1)
    expect(r1).toHaveLength(2)
    const pairs = r1.map(m => [labelOf(m.team_1_source), labelOf(m.team_2_source)].sort())
    expect(pairs).toContainEqual(['1st place', '4th place'])
    expect(pairs).toContainEqual(['2nd place', '3rd place'])
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
    expect(byes.map(b => labelOf(b.team_1_source ?? b.team_2_source)).sort()).toEqual(['1st place', '2nd place'])
  })
})

describe('buildPlaceholderPlayoffs — pool play (double elim)', () => {
  it('2 pools, top 2 → WB round 1 cross-seeds the pools', () => {
    const rows = buildPlaceholderPlayoffs(poolSources(2, 2), { engine: 'double' }, {}, 1) as Row[]
    const wb1 = rows.filter(r => r.match_stage === 'winners_bracket' && r.round_number === 1)
    expect(wb1).toHaveLength(2)
    const pairs = wb1.map(m => [labelOf(m.team_1_source), labelOf(m.team_2_source)].sort())
    // Pool winner meets the OTHER pool's runner-up.
    expect(pairs).toContainEqual(['Pool 1 - 1st place', 'Pool 2 - 2nd place'])
    expect(pairs).toContainEqual(['Pool 1 - 2nd place', 'Pool 2 - 1st place'])
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

// Full play-out of a DOUBLE-elim placeholder bracket: build it, seed round 1 from
// the standings, settle the byes (resolveBracket), then play every match exactly as
// the score route does (resolveCompletion). team_1 wins every match — deterministic.
function playPlaceholderDouble(n: number, pick: (m: Row) => string = m => m.team_1_registration_id!): {
  hung: boolean; incomplete: Row[]; overTwo: number; survivors: number; eliminated: number
} {
  const built = buildPlaceholderPlayoffs(roundRobinSources(n), { engine: 'double' }, { status: 'scheduled' }, 1) as Row[]
  const rows: Row[] = built.map((r, i) => ({
    id: `m${i}`,
    round_number: r.round_number ?? null,
    match_number: r.match_number,
    match_stage: r.match_stage,
    team_1_registration_id: r.team_1_registration_id ?? null,
    team_2_registration_id: r.team_2_registration_id ?? null,
    team_1_source: r.team_1_source ?? null,
    team_2_source: r.team_2_source ?? null,
    winner_registration_id: r.winner_registration_id ?? null,
    status: r.status ?? 'scheduled',
  }))
  const overall = Array.from({ length: n }, (_, i) => ({ regId: `t${i}` }))
  for (const m of rows) {
    if (m.team_1_source) { m.team_1_registration_id = resolvePlayoffSource(m.team_1_source, overall, new Map()); m.team_1_source = null }
    if (m.team_2_source) { m.team_2_registration_id = resolvePlayoffSource(m.team_2_source, overall, new Map()); m.team_2_source = null }
  }
  const byId = new Map(rows.map(m => [m.id, m]))
  const losses: Record<string, number> = {}
  const apply = (mu: any) => {
    if (mu.kind === 'set') { const m = byId.get(mu.matchId); if (m && m[mu.field] == null) m[mu.field] = mu.value }
    else if (mu.kind === 'complete') { const m = byId.get(mu.matchId); if (m && m.status !== 'completed') { m.winner_registration_id = mu.winner; m.status = 'completed' } }
    else { rows.push(mu.match); byId.set(mu.match.id, mu.match) }
  }
  for (const mu of resolveBracket(rows as any)) apply(mu) // settle byes
  let guard = 0
  while (guard++ < 5000) {
    const ready = rows.find(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
    if (!ready) break
    const winner = pick(ready)
    const loser = winner === ready.team_1_registration_id ? ready.team_2_registration_id! : ready.team_1_registration_id!
    ready.winner_registration_id = winner
    ready.status = 'completed'
    losses[loser] = (losses[loser] ?? 0) + 1
    for (const mu of resolveCompletion(ready as any, rows as any)) apply(mu)
  }
  const teams = Array.from({ length: n }, (_, i) => `t${i}`)
  return {
    hung: guard >= 5000,
    incomplete: rows.filter(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id),
    overTwo: teams.filter(t => (losses[t] ?? 0) > 2).length,
    survivors: teams.filter(t => (losses[t] ?? 0) < 2).length,
    eliminated: teams.filter(t => (losses[t] ?? 0) >= 2).length,
  }
}

describe('placeholder DOUBLE elim — non-power-of-2 sizes resolve cleanly', () => {
  for (const n of [5, 6, 7, 9, 10, 11, 12]) {
    it(`N=${n}: single champion, everyone else out at two losses, nothing hung`, () => {
      const r = playPlaceholderDouble(n)
      expect(r.hung).toBe(false)
      expect(r.incomplete.map(m => `${m.match_stage} r${m.round_number} #${m.match_number}`)).toEqual([])
      expect(r.overTwo).toBe(0)
      expect(r.survivors).toBe(1)
      expect(r.eliminated).toBe(n - 1)
    })
  }

  // If-necessary final: force the losers-bracket champ to win the first championship,
  // so the reset (round 2) must be created and played — even with byes in the field.
  for (const n of [6, 9, 12]) {
    it(`N=${n}: bracket reset fires and still yields a single champion`, () => {
      let firstChampSeen = false
      const r = playPlaceholderDouble(n, m => {
        if (m.match_stage === 'championship' && (m.round_number ?? 1) === 1 && !firstChampSeen) {
          firstChampSeen = true
          return m.team_2_registration_id! // LB champ wins → reset
        }
        return m.team_1_registration_id!
      })
      expect(r.hung).toBe(false)
      expect(r.incomplete).toEqual([])
      expect(r.overTwo).toBe(0)
      expect(r.survivors).toBe(1)
      expect(r.eliminated).toBe(n - 1)
    })
  }
})

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

  it('top 6 (DOUBLE elim): byes auto-advance and the bracket plays to one champion', () => {
    // The risky combo from the up-front feature: a pool-play DOUBLE-elim placeholder
    // bracket whose byes are settled at RESOLUTION (not generation). Build, seed from
    // standings, settle byes, then play it to completion (team_1 wins every match).
    const r = playPlaceholderDouble(6)
    expect(r.hung).toBe(false)
    expect(r.incomplete).toEqual([])
    expect(r.overTwo).toBe(0)        // nobody plays on past two losses
    expect(r.survivors).toBe(1)      // exactly one champion
    expect(r.eliminated).toBe(5)
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

describe('phantomMatchIds — up-front placeholder playoffs stay visible', () => {
  it('does not hide the FINAL of a pool-play single-elim bracket while its semis are unseeded', () => {
    const rows = withIds(
      buildPlaceholderPlayoffs(poolSources(2, 2), { engine: 'single' }, { status: 'scheduled' }, 1) as Row[],
    )
    const semis = rows.filter(r => r.round_number === 1)
    const final = rows.find(r => r.round_number === 2)!
    expect(semis).toHaveLength(2)
    expect(final).toBeTruthy()
    // Regression: the sourced semis were resolving to BYE-vs-BYE, cascading a BYE into the
    // final so it was stripped as a phantom (and the semis mislabeled "FINAL").
    const phantoms = phantomMatchIds(rows as any)
    expect(phantoms.has(final.id)).toBe(false)
    expect(rows.every(r => !phantoms.has(r.id))).toBe(true)
  })

  it('does not hide a 4-team round-robin playoff FINAL while its semis are unseeded', () => {
    const rows = withIds(
      buildPlaceholderPlayoffs(
        roundRobinSources(4), { engine: 'rr_playoff', finalFormat: 'single_elimination' }, { status: 'scheduled' }, 1,
      ) as Row[],
    )
    const final = rows.find(r => r.round_number === 2)!
    expect(phantomMatchIds(rows as any).has(final.id)).toBe(false)
  })
})
