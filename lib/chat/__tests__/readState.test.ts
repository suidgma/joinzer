import { describe, it, expect, vi, beforeEach } from 'vitest'

// The latch is the part of this module that has been wrong twice: once by not releasing on a
// thrown failure, once by claiming a retry guarantee it didn't provide. These tests pin the
// behaviour that matters — a repeat call is free, and EVERY failure path leaves the latch open
// so the next call actually retries.

const upsert = vi.fn()
const getUser = vi.fn()

// Path is relative to THIS file, not to the module under test.
vi.mock('../../supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => getUser() },
    from: () => ({ upsert: (...args: unknown[]) => upsert(...args) }),
  }),
}))

// Imported after the mock is registered.
const { markChatRead } = await import('../readState')

const USER = { id: 'user-1' }
const ok = () => ({ error: null })

// The module keeps its latch in module scope, so each test uses a distinct entity id rather
// than trying to reset it — closer to how it behaves in a real session anyway.
let n = 0
const nextEntity = () => `entity-${++n}`

beforeEach(() => {
  upsert.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: USER } })
  upsert.mockResolvedValue(ok())
})

describe('markChatRead', () => {
  it('writes the row with the caller-supplied timestamp', async () => {
    const entityId = nextEntity()
    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual({
      user_id: 'user-1',
      source_table: 'league_messages',
      entity_id: entityId,
      last_read_at: '2026-07-31T12:00:00+00:00',
    })
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,source_table,entity_id' })
  })

  // Idempotence, not debouncing: nothing is delayed or batched, a repeat of the SAME value is
  // simply free. markRead() re-fires with an unchanged timestamp constantly.
  it('skips the network write when the timestamp has not changed', async () => {
    const entityId = nextEntity()
    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('writes again when the timestamp advances', async () => {
    const entityId = nextEntity()
    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    await markChatRead('league_messages', entityId, '2026-07-31T12:05:00+00:00')
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a timestamp', async () => {
    await markChatRead('league_messages', nextEntity(), '')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('releases the latch when the write returns an error, so the next call retries', async () => {
    const entityId = nextEntity()
    upsert.mockResolvedValueOnce({ error: { message: 'nope' } })

    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')

    expect(upsert).toHaveBeenCalledTimes(2)
  })

  // The reachable throw: auth-js rethrows anything that isn't an AuthError, and a routine
  // multi-tab Web Locks steal produces LockAcquireTimeoutError, which extends plain Error.
  it('releases the latch when getUser throws, so the next call retries', async () => {
    const entityId = nextEntity()
    getUser.mockRejectedValueOnce(new Error('Acquiring an exclusive Navigator LockManager lock immediately failed'))

    await expect(markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')).resolves.toBeUndefined()
    expect(upsert).not.toHaveBeenCalled()

    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('releases the latch when the upsert itself throws', async () => {
    const entityId = nextEntity()
    upsert.mockRejectedValueOnce(new Error('network down'))

    await expect(markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')).resolves.toBeUndefined()

    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('does not write, and releases the latch, when there is no signed-in user', async () => {
    const entityId = nextEntity()
    getUser.mockResolvedValueOnce({ data: { user: null } })

    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    expect(upsert).not.toHaveBeenCalled()

    await markChatRead('league_messages', entityId, '2026-07-31T12:00:00+00:00')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('never rejects, so a fire-and-forget call site cannot raise an unhandled rejection', async () => {
    getUser.mockRejectedValueOnce(new Error('boom'))
    await expect(markChatRead('event_messages', nextEntity(), '2026-07-31T12:00:00+00:00')).resolves.toBeUndefined()
  })
})
