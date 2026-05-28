/**
 * Unit tests for logAudit().
 *
 * Two things matter most about this function:
 *   1. It maps AuditEntry → the right DB row shape.
 *   2. It NEVER throws, even when the DB insert fails. Audit failure
 *      must not break the caller's primary operation.
 *
 * We stub the Supabase client by overriding the module import, then
 * inspect what got passed to .insert() and how errors propagate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the rows passed to insert() across calls.
const insertCalls: Array<Record<string, unknown>> = []
let nextInsertError: { message: string } | null = null
let nextInsertThrows: Error | null = null

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (nextInsertThrows) throw nextInsertThrows
        insertCalls.push(row)
        return { error: nextInsertError }
      },
    }),
  }),
}))

// Stub the env vars the helper reads at module-load time.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

// Import after the mock + env are in place.
const { logAudit } = await import('../log')

beforeEach(() => {
  insertCalls.length = 0
  nextInsertError = null
  nextInsertThrows = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('logAudit', () => {
  it('maps AuditEntry fields to the correct DB row shape', async () => {
    await logAudit({
      actorId:    'user-1',
      entityType: 'tournament_match',
      entityId:   'match-1',
      action:     'score_updated',
      before:     { status: 'in_progress' },
      after:      { status: 'completed' },
    })

    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]).toEqual({
      actor_id:    'user-1',
      entity_type: 'tournament_match',
      entity_id:   'match-1',
      action:      'score_updated',
      before:      { status: 'in_progress' },
      after:       { status: 'completed' },
    })
  })

  it('coerces undefined before/after to null', async () => {
    await logAudit({
      actorId:    'user-1',
      entityType: 'tournament_match',
      entityId:   'match-1',
      action:     'match_marked_ready',
    })

    expect(insertCalls[0]).toMatchObject({
      before: null,
      after:  null,
    })
  })

  it('allows actorId to be null for system actions', async () => {
    await logAudit({
      actorId:    null,
      entityType: 'tournament_registration',
      entityId:   'reg-1',
      action:     'waitlist_auto_promoted',
    })

    expect(insertCalls[0]).toMatchObject({ actor_id: null })
  })

  it('does NOT throw when the DB insert returns an error', async () => {
    nextInsertError = { message: 'simulated db error' }

    // Should resolve, not reject.
    await expect(
      logAudit({
        actorId:    'user-1',
        entityType: 'tournament_match',
        entityId:   'match-1',
        action:     'score_updated',
      })
    ).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(
      '[audit] write failed:',
      expect.objectContaining({ error: 'simulated db error' })
    )
  })

  it('does NOT throw when the DB call throws synchronously', async () => {
    nextInsertThrows = new Error('connection refused')

    await expect(
      logAudit({
        actorId:    'user-1',
        entityType: 'tournament_match',
        entityId:   'match-1',
        action:     'score_updated',
      })
    ).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(
      '[audit] write threw:',
      expect.objectContaining({ err: expect.any(Error) })
    )
  })
})
