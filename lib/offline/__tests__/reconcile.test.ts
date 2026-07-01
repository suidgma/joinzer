import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reconcile } from '../reconcile'
import { writeTournament, readTournament, clearTournament, type TournamentBundle } from '../tournamentDB'
import { enqueueOp, clearOutbox, outboxCount } from '../outbox'

const match = (id: string) => ({
  id, tournament_id: 'T1', division_id: 'd1',
  round_number: 1, match_number: 1, match_stage: 'single_elimination',
  team_1_registration_id: null, team_2_registration_id: null,
  winner_registration_id: null, status: 'scheduled', team_1_score: null, team_2_score: null,
})

const bundle = (matchId: string): TournamentBundle => ({
  tournament: { id: 'T1', name: 'Test', status: 'in_progress' },
  divisions: [{ id: 'd1', tournament_id: 'T1', name: 'D1', bracket_type: 'single_elimination' }],
  registrations: [],
  courts: [],
  matches: [match(matchId)],
})

function stubOnline(online: boolean) {
  vi.stubGlobal('navigator', { onLine: online })
}

describe('reconcile', () => {
  beforeEach(async () => {
    await clearTournament('T1')
    await clearOutbox()
    await writeTournament(bundle('m-old')) // local store starts with the pre-sync copy
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('offline: no draining, no refetch, reports pending', async () => {
    await enqueueOp({ url: '/api/x', method: 'PATCH', body: '{}', dedupeKey: 'x' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    stubOnline(false)

    const r = await reconcile('T1')
    expect(r.status).toBe('offline')
    expect(r.pending).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await outboxCount()).toBe(1) // still queued
  })

  it('clean drain → bulk-refetch replaces the store with server state', async () => {
    await enqueueOp({ url: '/api/x', method: 'PATCH', body: '{}', dedupeKey: 'x' })
    const fetchMock = vi.fn((url: string) =>
      String(url).includes('offline-bundle')
        ? Promise.resolve({ ok: true, json: async () => bundle('m-new') } as unknown as Response)
        : Promise.resolve({ ok: true } as Response),
    )
    vi.stubGlobal('fetch', fetchMock)
    stubOnline(true)

    const r = await reconcile('T1')
    expect(r.status).toBe('synced')
    expect(r.pending).toBe(0)
    expect(await outboxCount()).toBe(0)
    // Store now reflects the refetched server bundle, not the pre-sync copy.
    const stored = await readTournament('T1')
    expect(stored!.matches.map(m => m.id)).toEqual(['m-new'])
    expect(r.bundle!.matches.map(m => m.id)).toEqual(['m-new'])
  })

  it('partial drain (an op fails) → does NOT refetch, keeps the local copy', async () => {
    await enqueueOp({ url: '/api/fails', method: 'PATCH', body: '{}', dedupeKey: 'x' })
    const fetchMock = vi.fn((url: string) =>
      String(url).includes('offline-bundle')
        ? Promise.resolve({ ok: true, json: async () => bundle('m-new') } as unknown as Response)
        : Promise.resolve({ ok: false } as Response), // the queued PATCH fails
    )
    vi.stubGlobal('fetch', fetchMock)
    stubOnline(true)

    const r = await reconcile('T1')
    expect(r.status).toBe('partial')
    expect(r.pending).toBe(1)
    // The bundle refetch must NOT have happened — that would clobber the un-synced write.
    expect(fetchMock.mock.calls.every(c => !String(c[0]).includes('offline-bundle'))).toBe(true)
    const stored = await readTournament('T1')
    expect(stored!.matches.map(m => m.id)).toEqual(['m-old']) // untouched
  })
})
