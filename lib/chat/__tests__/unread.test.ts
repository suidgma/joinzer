import { describe, it, expect } from 'vitest'
import { computeInitialUnread, chatReadKey, selectDurableLastRead } from '../unread'

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

// An optimistic row carries this device's clock. It may live in React state; it must never be
// written anywhere that outlives the render — not chat_reads (read by every other device) and
// not localStorage (promoted to the server on the next load by computeInitialUnread). A fast
// client clock persisted through EITHER route suppresses genuinely newer messages as read.
describe('selectDurableLastRead', () => {
  const msg = (id: string, created_at: string) => ({ id, created_at })
  const SERVER_A = '2026-07-31T12:00:00+00:00'
  const SERVER_B = '2026-07-31T12:05:00+00:00'
  // What a device running an hour fast produces for a message sent "now".
  const SKEWED = '2026-07-31T13:00:00.000Z'

  it('returns nothing when there are no messages', () => {
    expect(selectDurableLastRead([], new Set())).toBe('')
  })

  it('returns the newest message when none are in flight', () => {
    expect(selectDurableLastRead([msg('a', SERVER_A), msg('b', SERVER_B)], new Set())).toBe(SERVER_B)
  })

  it('skips a trailing optimistic row and returns the last server timestamp', () => {
    const messages = [msg('a', SERVER_A), msg('b', SERVER_B), msg('mine', SKEWED)]
    expect(selectDurableLastRead(messages, new Set(['mine']))).toBe(SERVER_B)
  })

  it('skips several consecutive optimistic rows', () => {
    const messages = [msg('a', SERVER_A), msg('m1', SKEWED), msg('m2', SKEWED)]
    expect(selectDurableLastRead(messages, new Set(['m1', 'm2']))).toBe(SERVER_A)
  })

  it('returns nothing when every message is still in flight, rather than a client clock', () => {
    expect(selectDurableLastRead([msg('m1', SKEWED)], new Set(['m1']))).toBe('')
  })

  // The regression this exists to prevent: the skewed value reaching localStorage, where the
  // promotion path would later carry it into chat_reads and suppress a real 12:30 message.
  it('never returns a value that would suppress a genuinely newer message', () => {
    const messages = [msg('a', SERVER_A), msg('mine', SKEWED)]
    const durable = selectDurableLastRead(messages, new Set(['mine']))
    const { unreadKeys } = computeInitialUnread(
      [{ table: 'league_messages', entityId: 'league-1', latest: '2026-07-31T12:30:00+00:00', lastReadAt: null }],
      { [chatReadKey('league_messages', 'league-1')]: durable },
    )
    expect(unreadKeys).toEqual(['league_messages:league-1'])
  })

  it('would suppress that message if the optimistic value were persisted (negative control)', () => {
    const { unreadKeys } = computeInitialUnread(
      [{ table: 'league_messages', entityId: 'league-1', latest: '2026-07-31T12:30:00+00:00', lastReadAt: null }],
      { [chatReadKey('league_messages', 'league-1')]: SKEWED },
    )
    expect(unreadKeys).toEqual([])
  })
})

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

  // Local is caught up to the newest message and the server is behind — the ordinary "read on
  // this device before read state was durable" case. (A local value ahead of the newest message
  // is the legacy-skew case, covered by the clamping block below.)
  it('lets a local key ahead of the server clear the badge, and promotes it', () => {
    const { unreadKeys, toPromote } = computeInitialUnread(
      [source({ lastReadAt: '2026-07-31T11:00:00+00:00' })],
      { [key]: '2026-07-31T12:00:00+00:00' },
    )
    expect(unreadKeys).toEqual([])
    expect(toPromote).toEqual([
      { table: 'league_messages', entityId: 'league-1', lastReadAt: '2026-07-31T12:00:00+00:00' },
    ])
  })

  it('promotes a local key when the server has no row at all', () => {
    const { toPromote } = computeInitialUnread([source()], { [key]: '2026-07-31T12:00:00+00:00' })
    expect(toPromote).toHaveLength(1)
    expect(toPromote[0].lastReadAt).toBe('2026-07-31T12:00:00+00:00')
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

  // Legacy skew: every browser already holds keys written by the pre-fix code, which persisted
  // the sending device's own clock. The promotion path is the backfill, so without a clamp the
  // first load after deploy would carry that skew straight into chat_reads.
  describe('clamping a local key to the newest message', () => {
    const SKEWED = '2026-07-31T13:00:00.000Z' // an hour-fast device
    const LATEST = '2026-07-31T12:00:00+00:00'

    it('promotes the latest message rather than a local value ahead of it', () => {
      const { toPromote } = computeInitialUnread(
        [source({ latest: LATEST })],
        { [key]: SKEWED },
      )
      expect(toPromote).toEqual([
        { table: 'league_messages', entityId: 'league-1', lastReadAt: LATEST },
      ])
    })

    it('promotes a local value at or below the newest message unchanged', () => {
      const local = '2026-07-31T11:30:00+00:00'
      const { toPromote } = computeInitialUnread([source({ latest: LATEST })], { [key]: local })
      expect(toPromote[0].lastReadAt).toBe(local)
    })

    // The clamped value must not itself resurrect the badge for a chat the user has read.
    it('still treats the chat as read after clamping', () => {
      const { unreadKeys } = computeInitialUnread([source({ latest: LATEST })], { [key]: SKEWED })
      expect(unreadKeys).toEqual([])
    })

    // The whole point: what lands in chat_reads must not suppress a message sent later.
    it('produces a promoted value that cannot suppress a later message', () => {
      const { toPromote } = computeInitialUnread([source({ latest: LATEST })], { [key]: SKEWED })
      const promoted = toPromote[0].lastReadAt
      const { unreadKeys } = computeInitialUnread(
        [source({ latest: '2026-07-31T12:30:00+00:00', lastReadAt: promoted })],
        {},
      )
      expect(unreadKeys).toEqual(['league_messages:league-1'])
    })

    it('does not promote when the server is already at or past the clamped value', () => {
      const { toPromote } = computeInitialUnread(
        [source({ latest: LATEST, lastReadAt: LATEST })],
        { [key]: SKEWED },
      )
      expect(toPromote).toEqual([])
    })
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
