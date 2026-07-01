import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  writeTournament,
  readTournament,
  getMatchesForDivision,
  putMatches,
  clearTournament,
  type TournamentBundle,
  type StoredMatch,
} from '../tournamentDB'

function match(id: string, divisionId: string, tournamentId: string, extra: Partial<StoredMatch> = {}): StoredMatch {
  return {
    id, division_id: divisionId, tournament_id: tournamentId,
    round_number: 1, match_number: 1, match_stage: 'single_elimination',
    team_1_registration_id: null, team_2_registration_id: null,
    winner_registration_id: null, status: 'scheduled', team_1_score: null, team_2_score: null,
    ...extra,
  }
}

function bundle(tid: string): TournamentBundle {
  return {
    tournament: { id: tid, name: 'Test Cup', status: 'in_progress' },
    divisions: [{ id: 'd1', tournament_id: tid, name: 'Open' }, { id: 'd2', tournament_id: tid, name: 'Womens' }],
    registrations: [
      { id: 'r1', tournament_id: tid, division_id: 'd1' },
      { id: 'r2', tournament_id: tid, division_id: 'd1' },
      { id: 'r3', tournament_id: tid, division_id: 'd2' },
    ],
    courts: [{ id: 'c1', tournament_id: tid, court_number: 1 }],
    matches: [
      match('m1', 'd1', tid, { match_number: 1 }),
      match('m2', 'd1', tid, { match_number: 2 }),
      match('m3', 'd2', tid, { match_number: 1 }),
    ],
  }
}

describe('tournamentDB — durable local store', () => {
  beforeEach(async () => {
    await clearTournament('T1')
    await clearTournament('T2')
  })

  it('round-trips a whole tournament by write then read', async () => {
    await writeTournament(bundle('T1'))
    const out = await readTournament('T1')
    expect(out).not.toBeNull()
    expect(out!.tournament.id).toBe('T1')
    expect(out!.divisions.map(d => d.id).sort()).toEqual(['d1', 'd2'])
    expect(out!.registrations).toHaveLength(3)
    expect(out!.courts).toHaveLength(1)
    expect(out!.matches).toHaveLength(3)
    expect(out!.tournament.hydratedAt).toBeTypeOf('number') // stamped on write
  })

  it('returns null for a tournament that was never hydrated', async () => {
    expect(await readTournament('does-not-exist')).toBeNull()
  })

  it('scopes rows by tournament — two tournaments do not bleed together', async () => {
    await writeTournament(bundle('T1'))
    await writeTournament(bundle('T2'))
    const a = await readTournament('T1')
    const b = await readTournament('T2')
    expect(a!.matches.every(m => m.tournament_id === 'T1')).toBe(true)
    expect(b!.matches.every(m => m.tournament_id === 'T2')).toBe(true)
  })

  it('write REPLACES — stale rows removed, not merged', async () => {
    await writeTournament(bundle('T1'))
    const shrunk = bundle('T1')
    shrunk.matches = [match('m1', 'd1', 'T1')] // drop m2, m3
    shrunk.registrations = [{ id: 'r1', tournament_id: 'T1', division_id: 'd1' }]
    await writeTournament(shrunk)
    const out = await readTournament('T1')
    expect(out!.matches.map(m => m.id)).toEqual(['m1'])
    expect(out!.registrations.map(r => r.id)).toEqual(['r1'])
  })

  it('reads matches for a single division', async () => {
    await writeTournament(bundle('T1'))
    const d1 = await getMatchesForDivision('d1')
    expect(d1.map(m => m.id).sort()).toEqual(['m1', 'm2'])
    expect(await getMatchesForDivision('d2')).toHaveLength(1)
  })

  it('putMatches upserts changed rows (e.g. a local score)', async () => {
    await writeTournament(bundle('T1'))
    await putMatches([match('m1', 'd1', 'T1', { status: 'completed', winner_registration_id: 'r1', team_1_score: 11, team_2_score: 4 })])
    const [m1] = (await getMatchesForDivision('d1')).filter(m => m.id === 'm1')
    expect(m1).toMatchObject({ status: 'completed', winner_registration_id: 'r1', team_1_score: 11 })
    expect(await getMatchesForDivision('d1')).toHaveLength(2) // upsert, not append
  })

  it('clearTournament removes the whole local copy', async () => {
    await writeTournament(bundle('T1'))
    await clearTournament('T1')
    expect(await readTournament('T1')).toBeNull()
    expect(await getMatchesForDivision('d1')).toHaveLength(0)
  })
})
