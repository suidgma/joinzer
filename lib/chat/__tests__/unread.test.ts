import { describe, it, expect } from 'vitest'
import { computeInitialUnread, chatReadKey } from '../unread'

// The bug this logic exists to fix: read state used to live only in localStorage, and a
// missing key counted as unread — so clearing the browser cache lit up every chat at once.
// Seeding now starts from the server, with localStorage able only to move last-read forward.

const source = (over: Partial<Parameters<typeof computeInitialUnread>[0][0]> = {}) => ({
  table: 'league_messages',
  entityId: 'league-1',
  latest: '2026-07-31T12:00:00+00:00',
  lastReadAt: null as string | null,
  ...over,
})

const key = chatReadKey('league_messages', 'league-1')

describe('computeInitialUnread', () => {
  it('marks a chat unread when there is no server row and no local key', () => {
    const { unreadKeys, toPromote } = computeInitialUnread([source()], {})
    expect(unreadKeys).toEqual(['league_messages:league-1'])
    expect(toPromote).toEqual([])
  })

  it('marks a chat read when the server last-read is newer than the latest message', () => {
    const { unreadKeys } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T13:00:00+00:00' })],
      {},
    )
    expect(unreadKeys).toEqual([])
  })

  it('marks a chat unread when the latest message is newer than the server last-read', () => {
    const { unreadKeys } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T11:00:00+00:00' })],
      {},
    )
    expect(unreadKeys).toEqual(['league_messages:league-1'])
  })

  // The empty-cache case that produced the bug report. With no local key the server alone
  // decides, so a freshly cleared browser gets the right answer.
  it('ignores a missing local key when the server says the chat was read', () => {
    const { unreadKeys, toPromote } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T13:00:00+00:00' })],
      {},
    )
    expect(unreadKeys).toEqual([])
    expect(toPromote).toEqual([])
  })

  it('lets a local key ahead of the server clear the badge, and promotes it', () => {
    const { unreadKeys, toPromote } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T11:00:00+00:00' })],
      { [key]: '2026-07-31T13:00:00+00:00' },
    )
    expect(unreadKeys).toEqual([])
    expect(toPromote).toEqual([
      { table: 'league_messages', entityId: 'league-1', lastReadAt: '2026-07-31T13:00:00+00:00' },
    ])
  })

  it('promotes a local key when the server has no row at all', () => {
    const { toPromote } = computeInitialUnread([source()], { [key]: '2026-07-31T13:00:00+00:00' })
    expect(toPromote).toHaveLength(1)
    expect(toPromote[0].lastReadAt).toBe('2026-07-31T13:00:00+00:00')
  })

  // localStorage is an overlay, not a source of truth: a stale device must not be able to
  // drag last-read backwards and resurrect a badge the user already cleared elsewhere.
  it('does not promote or regress when the local key is older than the server', () => {
    const { unreadKeys, toPromote } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T13:00:00+00:00' })],
      { [key]: '2026-07-31T10:00:00+00:00' },
    )
    expect(unreadKeys).toEqual([])
    expect(toPromote).toEqual([])
  })

  // PostgREST serializes timestamptz with `+00:00`; ChatPanel's optimistic send writes
  // toISOString(), which ends in `Z`. Comparing those as raw strings gets it wrong, so the
  // same instant in the two shapes must read as equal (not unread, not promoted).
  it('compares instants, not strings, across +00:00 and Z formats', () => {
    const { unreadKeys, toPromote } = computeInitialUnread(
      [source({ latest: '2026-07-31T12:00:00+00:00', lastReadAt: '2026-07-31T12:00:00+00:00' })],
      { [key]: '2026-07-31T12:00:00.000Z' },
    )
    expect(unreadKeys).toEqual([])
    expect(toPromote).toEqual([])
  })

  it('handles both surfaces independently in one pass', () => {
    const { unreadKeys } = computeInitialUnread(
      [
        source(),
        source({ table: 'tournament_messages', entityId: 'tour-1', lastReadAt: '2026-07-31T13:00:00+00:00' }),
      ],
      {},
    )
    expect(unreadKeys).toEqual(['league_messages:league-1'])
  })
})
