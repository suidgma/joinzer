import { beforeEach, describe, expect, it } from 'vitest'
import { consumeQuota, __resetQuota, DAILY_REQUEST_CAP } from '../quota'

beforeEach(() => __resetQuota())

const DAY_ONE = new Date('2026-08-06T10:00:00Z')
const DAY_ONE_LATE = new Date('2026-08-06T23:59:59Z')
const DAY_TWO = new Date('2026-08-07T00:00:01Z')

describe('per-user daily cap', () => {
  it('allows requests up to the cap', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP; i++) {
      expect(consumeQuota('user-a', DAY_ONE).allowed, `request ${i + 1}`).toBe(true)
    }
  })

  it('refuses the request after the cap', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP; i++) consumeQuota('user-a', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE).allowed).toBe(false)
  })

  it('counts refused requests too, so waiting inside the day does not reset it', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP + 5; i++) consumeQuota('user-a', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE_LATE).allowed).toBe(false)
  })

  it('reports the remaining allowance', () => {
    expect(consumeQuota('user-a', DAY_ONE).remaining).toBe(DAILY_REQUEST_CAP - 1)
  })

  it('never reports a negative remaining', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP + 10; i++) consumeQuota('user-a', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE).remaining).toBe(0)
  })
})

describe('isolation', () => {
  it('meters each user separately', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP; i++) consumeQuota('user-a', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE).allowed).toBe(false)
    expect(consumeQuota('user-b', DAY_ONE).allowed).toBe(true)
  })

  it('resets on a new UTC day', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP + 1; i++) consumeQuota('user-a', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE).allowed).toBe(false)
    expect(consumeQuota('user-a', DAY_TWO).allowed).toBe(true)
  })

  it('does not let one user rolling into a new day reset another user mid-day', () => {
    for (let i = 0; i < DAILY_REQUEST_CAP; i++) consumeQuota('user-a', DAY_ONE)
    consumeQuota('user-b', DAY_TWO) // triggers the stale-day sweep
    // user-a's day-one bucket is swept, which is correct: it is stale relative to day two.
    expect(consumeQuota('user-a', DAY_TWO).allowed).toBe(true)
    // But within a single day the sweep must not fire at all.
    __resetQuota()
    for (let i = 0; i < DAILY_REQUEST_CAP; i++) consumeQuota('user-a', DAY_ONE)
    consumeQuota('user-b', DAY_ONE)
    expect(consumeQuota('user-a', DAY_ONE).allowed).toBe(false)
  })
})
