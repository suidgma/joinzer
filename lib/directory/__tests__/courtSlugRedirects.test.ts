import { describe, it, expect } from 'vitest'
// Imports the SHIPPED config rather than a parallel copy of the map, which could silently drift.
import nextConfig, { COURT_SLUG_REDIRECTS } from '../../../next.config.mjs'

/**
 * These redirects exist because renaming a venue changes its slug, and a published slug is a live
 * indexed URL. A missing or malformed entry here is a 404 on a real page, which is exactly the class
 * of defect that is invisible until a crawler finds it.
 */

type Redirect = { source: string; destination: string; permanent: boolean }

/** Also asserts the config defines redirects() at all — losing it entirely is the worst failure. */
async function getRedirects(): Promise<Redirect[]> {
  const fn = nextConfig.redirects
  if (typeof fn !== 'function') throw new Error('next.config.mjs defines no redirects()')
  return (await fn()) as Redirect[]
}

/** old slug → new slug, mirroring the July 30 2026 name-audit corrections. */
const EXPECTED: Record<string, string> = {
  'babe-james-center-new-smyrna-beach-fl': 'alonzo-babe-james-community-center-new-smyrna-beach-fl',
  'disney-tennis-center-earl-brown-park-deland-fl': 'david-e-disney-tennis-center-deland-fl',
  'harris-saxon-park-deltona-fl': 'harris-m-saxon-community-center-park-deltona-fl',
  'kovalenko-gym-new-smyrna-beach-fl': 'jessie-stevenson-kovalenko-memorial-gymnasium-new-smyrna-beach-fl',
  'phil-hall-courts-new-smyrna-beach-fl': 'phil-hall-park-new-smyrna-beach-fl',
  'white-place-courts-port-orange-fl': 'white-place-park-port-orange-fl',
  'bryan-family-ymca-greensboro-nc': 'kathleen-price-bryan-family-ymca-greensboro-nc',
}

describe('court slug redirects', () => {
  it('emits one permanent redirect per renamed published venue', async () => {
    const redirects = await getRedirects()
    expect(redirects).toHaveLength(Object.keys(EXPECTED).length)
    for (const r of redirects) expect(r.permanent).toBe(true)
  })

  it.each(Object.entries(EXPECTED))('maps /courts/%s to the corrected slug', async (from, to) => {
    const redirects = await getRedirects()
    const hit = redirects.find((r) => r.source === `/courts/${from}`)
    expect(hit, `no redirect for ${from}`).toBeDefined()
    expect(hit!.destination).toBe(`/courts/${to}`)
  })

  it('never redirects a slug to itself', async () => {
    for (const r of await getRedirects()) expect(r.source).not.toBe(r.destination)
  })

  it('has no duplicate sources — a second entry for one source is dead config', async () => {
    const sources = (await getRedirects()).map((r) => r.source)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('never chains — no destination is itself a redirect source', async () => {
    // A chain costs an extra round trip and dilutes the signal a 308 is meant to transfer.
    const redirects = await getRedirects()
    const sources = new Set(redirects.map((r) => r.source))
    for (const r of redirects) expect(sources.has(r.destination)).toBe(false)
  })

  it('scopes every entry to a bare slug, so sources can only ever be /courts/<slug>', () => {
    for (const [from, to] of COURT_SLUG_REDIRECTS as [string, string][]) {
      expect(from).not.toContain('/')
      expect(to).not.toContain('/')
    }
  })

  it('omits the draft bethune row — it was never published, so it has no URL history', async () => {
    const sources = (await getRedirects()).map((r) => r.source)
    expect(sources).not.toContain('/courts/bethune-beach-park-new-smyrna-beach-fl')
  })
})
