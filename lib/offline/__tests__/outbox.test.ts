import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { enqueueOp, listOps, outboxCount, deleteOp, clearOutbox, drainOutbox } from '../outbox'

const op = (url: string, dedupeKey?: string) =>
  ({ url, method: 'PATCH' as const, body: JSON.stringify({ x: 1 }), dedupeKey })

describe('outbox', () => {
  beforeEach(async () => {
    await clearOutbox()
    vi.restoreAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it('enqueues in FIFO order and counts', async () => {
    await enqueueOp(op('/a'))
    await enqueueOp(op('/b'))
    await enqueueOp(op('/c'))
    expect(await outboxCount()).toBe(3)
    expect((await listOps()).map(o => o.url)).toEqual(['/a', '/b', '/c'])
  })

  it('dedupes by key — last write wins, order follows the newest enqueue', async () => {
    await enqueueOp(op('/checkin/r1', 'checkin:r1'))
    await enqueueOp(op('/other', 'other'))
    await enqueueOp(op('/checkin/r1-again', 'checkin:r1'))
    const ops = await listOps()
    expect(ops).toHaveLength(2)
    expect(ops.map(o => o.url)).toEqual(['/other', '/checkin/r1-again'])
  })

  it('deletes a single op by seq', async () => {
    await enqueueOp(op('/a'))
    await enqueueOp(op('/b'))
    const [first] = await listOps()
    await deleteOp(first.seq!)
    expect((await listOps()).map(o => o.url)).toEqual(['/b'])
  })

  it('drains FIFO on success and empties the queue', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await enqueueOp(op('/a'))
    await enqueueOp(op('/b'))
    const res = await drainOutbox()
    expect(res).toEqual({ synced: 2, failed: 0, remaining: 0 })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/a', '/b'])
    expect(await outboxCount()).toBe(0)
  })

  it('stops at the first failure to preserve causal order', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await enqueueOp(op('/a'))
    await enqueueOp(op('/b'))
    await enqueueOp(op('/c'))
    const res = await drainOutbox()
    expect(res.synced).toBe(1)
    expect(res.failed).toBe(1)
    // /a drained; /b failed and blocks /c — both remain, still in order.
    expect((await listOps()).map(o => o.url)).toEqual(['/b', '/c'])
  })
})
