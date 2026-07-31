import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from '../unsubscribe'

const USER = '11111111-2222-3333-4444-555555555555'
const SECRET = 'test-unsubscribe-secret'
const DAY_MS = 24 * 60 * 60 * 1000

let originalSecret: string | undefined

beforeAll(() => {
  originalSecret = process.env.UNSUBSCRIBE_SECRET
  process.env.UNSUBSCRIBE_SECRET = SECRET
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.UNSUBSCRIBE_SECRET
  else process.env.UNSUBSCRIBE_SECRET = originalSecret
})

describe('signUnsubscribeToken / verifyUnsubscribeToken', () => {
  it('round-trips a freshly signed token', () => {
    const result = verifyUnsubscribeToken(signUnsubscribeToken(USER))
    expect(result).toEqual({ ok: true, userId: USER })
  })

  it('carries the user id in the clear but makes it unforgeable', () => {
    const token = signUnsubscribeToken(USER)
    expect(token.startsWith(`${USER}.`)).toBe(true)

    // Swapping in another id without re-signing must fail — this is the enumeration attack
    // the old ?uid= route was wide open to.
    const other = '99999999-8888-7777-6666-555555555555'
    const forged = token.replace(USER, other)
    expect(verifyUnsubscribeToken(forged)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a tampered signature', () => {
    const [uid, exp, sig] = signUnsubscribeToken(USER).split('.')
    const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`
    expect(verifyUnsubscribeToken(`${uid}.${exp}.${flipped}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects an extended expiry', () => {
    const [uid, exp, sig] = signUnsubscribeToken(USER).split('.')
    const later = String(Number(exp) + 60 * 60 * 24 * 365)
    expect(verifyUnsubscribeToken(`${uid}.${later}.${sig}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to run first.
    const [uid, exp] = signUnsubscribeToken(USER).split('.')
    expect(() => verifyUnsubscribeToken(`${uid}.${exp}.short`)).not.toThrow()
    expect(verifyUnsubscribeToken(`${uid}.${exp}.short`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken(USER)
    process.env.UNSUBSCRIBE_SECRET = 'a-different-secret'
    try {
      expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: 'invalid' })
    } finally {
      process.env.UNSUBSCRIBE_SECRET = SECRET
    }
  })

  it('reports expiry only for a validly signed, out-of-date token', () => {
    const signedLongAgo = signUnsubscribeToken(USER, Date.now() - 400 * DAY_MS)
    expect(verifyUnsubscribeToken(signedLongAgo)).toEqual({ ok: false, reason: 'expired' })
  })

  it('checks the signature before the expiry', () => {
    // An attacker guessing at tokens must not be able to tell a well-formed-but-old token
    // from a garbage one.
    const [uid, exp] = signUnsubscribeToken(USER, Date.now() - 400 * DAY_MS).split('.')
    const result = verifyUnsubscribeToken(`${uid}.${exp}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('still accepts a token one day short of expiry', () => {
    const almostExpired = signUnsubscribeToken(USER, Date.now() - 364 * DAY_MS)
    expect(verifyUnsubscribeToken(almostExpired)).toEqual({ ok: true, userId: USER })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['no separators', 'notatoken'],
    ['too few parts', `${USER}.123`],
    ['too many parts', `${USER}.123.sig.extra`],
    ['non-numeric expiry', `${USER}.notanumber.sig`],
    ['empty user id', `.123.sig`],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('buildUnsubscribeUrl', () => {
  it('points at the canonical host with a verifiable token', () => {
    const url = new URL(buildUnsubscribeUrl(USER))
    expect(url.origin).toBe('https://www.joinzer.com')
    expect(url.pathname).toBe('/api/unsubscribe')

    const token = url.searchParams.get('token')
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, userId: USER })
  })

  it('falls back to profile settings rather than throwing when the secret is missing', () => {
    delete process.env.UNSUBSCRIBE_SECRET
    try {
      // A send must never fail because of a missing secret — the recipient just gets the
      // in-app route to the same setting.
      expect(buildUnsubscribeUrl(USER)).toBe('https://www.joinzer.com/profile/edit')
    } finally {
      process.env.UNSUBSCRIBE_SECRET = SECRET
    }
  })
})
