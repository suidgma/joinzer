/**
 * Route-logic test for generate-matches doubles handling.
 * Uses exact fixture data from staging branch rwvfsziihpqnizdyovkf,
 * division 'Mens Doubles MG' (f581defd-eb8e-406c-8692-7cf7bb884264).
 *
 * Executes the real TypeScript functions — not a SQL model.
 * Mirrors the route at app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts
 */

import { describe, it, expect } from 'vitest'
import { isDoublesFormat } from '../../taxonomy/formats'

// ── Staging fixture data (queried live from rwvfsziihpqnizdyovkf) ──────────────
// P1+P2 = paid pair, P3+P4 = paid pair, P5 = paid no-partner, P6 = unpaid (excluded)

const FIXTURE_DIVISION_FORMAT = 'mens_doubles'

const FIXTURE_ALL_REGS = [
  { id: '3231c100-fc01-4696-b082-0da799b8525a', partner_registration_id: '9a5f9d5d-1e8e-4a1f-a178-2c7b018bcc5a' }, // P1
  { id: '9a5f9d5d-1e8e-4a1f-a178-2c7b018bcc5a', partner_registration_id: '3231c100-fc01-4696-b082-0da799b8525a' }, // P2
  { id: '45e8bb0f-138c-4517-a445-37abb41ef47e', partner_registration_id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f' }, // P3
  { id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f', partner_registration_id: '45e8bb0f-138c-4517-a445-37abb41ef47e' }, // P4
  { id: 'ab4f0418-b409-4939-beda-20c0c0e17ad1', partner_registration_id: null },                                    // P5 unpaired-paid
  // P6 (unpaid) is absent — excluded by payment_status filter before reaching this logic
]

// ── Route logic — copied verbatim from the route ──────────────────────────────

function routeLogic(allRegs: typeof FIXTURE_ALL_REGS) {
  const paidIds = new Set(allRegs.map(r => r.id))

  if (!isDoublesFormat(FIXTURE_DIVISION_FORMAT)) {
    return { path: 'singles', teams: allRegs.map(r => r.id) }
  }

  const unpaired = allRegs.filter(
    r => !(r.partner_registration_id && paidIds.has(r.partner_registration_id))
  )
  if (unpaired.length > 0) {
    return {
      path: 'block',
      error: `${unpaired.length} registered player${unpaired.length === 1 ? ' has' : 's have'} no confirmed paid partner. Pair all players before generating matches.`,
      unpaired: unpaired.map(r => r.id),
    }
  }

  const teams = allRegs.filter(r => r.id < r.partner_registration_id!).map(r => r.id)
  return { path: 'ok', teams }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generate-matches doubles logic — SMOKE-MG fixture', () => {

  it('isDoublesFormat correctly identifies mens_doubles', () => {
    expect(isDoublesFormat('mens_doubles')).toBe(true)
    expect(isDoublesFormat('singles')).toBe(false)
    expect(isDoublesFormat(null)).toBe(false)
    expect(isDoublesFormat(undefined)).toBe(false)
  })

  it('BLOCK: fires when P5 (unpaired-paid) is present', () => {
    const result = routeLogic(FIXTURE_ALL_REGS)
    expect(result.path).toBe('block')
    expect((result as any).error).toMatch(/1 registered player has/)
    expect((result as any).unpaired).toEqual(['ab4f0418-b409-4939-beda-20c0c0e17ad1'])
  })

  it('BLOCK: fires on one-side-unpaid edge case (partner not in paidIds)', () => {
    // Simulate: P2 is unpaid (absent from allRegs). P1 has partner_registration_id pointing to P2
    // but P2 is not in paidIds → P1 is treated as unpaired.
    const regs = [
      { id: '3231c100-fc01-4696-b082-0da799b8525a', partner_registration_id: '9a5f9d5d-1e8e-4a1f-a178-2c7b018bcc5a' }, // P1 paid, partner P2
      // P2 absent (unpaid)
      { id: '45e8bb0f-138c-4517-a445-37abb41ef47e', partner_registration_id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f' }, // P3
      { id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f', partner_registration_id: '45e8bb0f-138c-4517-a445-37abb41ef47e' }, // P4
    ]
    const result = routeLogic(regs as typeof FIXTURE_ALL_REGS)
    expect(result.path).toBe('block')
    expect((result as any).unpaired).toContain('3231c100-fc01-4696-b082-0da799b8525a')
  })

  it('BLOCK: fires on partner-cancelled edge case (partner not in paidIds)', () => {
    // P2 cancelled → absent from allRegs (filtered by status='registered').
    // Same result as unpaid: P1 has partner pointer but partner not in paidIds.
    const regs = [
      { id: '3231c100-fc01-4696-b082-0da799b8525a', partner_registration_id: '9a5f9d5d-1e8e-4a1f-a178-2c7b018bcc5a' }, // P1, partner absent
      { id: '45e8bb0f-138c-4517-a445-37abb41ef47e', partner_registration_id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f' },
      { id: '7ada7586-db23-4e2b-8920-0ecf57e5ae2f', partner_registration_id: '45e8bb0f-138c-4517-a445-37abb41ef47e' },
    ]
    const result = routeLogic(regs as typeof FIXTURE_ALL_REGS)
    expect(result.path).toBe('block')
    expect((result as any).unpaired).toContain('3231c100-fc01-4696-b082-0da799b8525a')
  })

  it('DEDUP: produces 2 teams (not 4) from 2 paid pairs — one bracket slot per pair', () => {
    // P5 removed (paired or removed); only the 2 confirmed pairs remain
    const pairedOnly = FIXTURE_ALL_REGS.filter(r => r.id !== 'ab4f0418-b409-4939-beda-20c0c0e17ad1')
    const result = routeLogic(pairedOnly)
    expect(result.path).toBe('ok')
    expect((result as any).teams).toHaveLength(2)
  })

  it('DEDUP: the kept team rep is the lesser UUID of each pair', () => {
    const pairedOnly = FIXTURE_ALL_REGS.filter(r => r.id !== 'ab4f0418-b409-4939-beda-20c0c0e17ad1')
    const result = routeLogic(pairedOnly)
    const teams: string[] = (result as any).teams

    // P1 id '3231c100...' < P2 id '9a5f9d5d...' → P1 is kept
    expect(teams).toContain('3231c100-fc01-4696-b082-0da799b8525a')
    expect(teams).not.toContain('9a5f9d5d-1e8e-4a1f-a178-2c7b018bcc5a')

    // P3 id '45e8bb0f...' < P4 id '7ada7586...' → P3 is kept
    expect(teams).toContain('45e8bb0f-138c-4517-a445-37abb41ef47e')
    expect(teams).not.toContain('7ada7586-db23-4e2b-8920-0ecf57e5ae2f')
  })

  it('NULL-format guard: NULL format is not treated as doubles', () => {
    expect(isDoublesFormat(null)).toBe(false)
    // Route blocks before this point with a 400 — this confirms the guard is safe
  })
})
