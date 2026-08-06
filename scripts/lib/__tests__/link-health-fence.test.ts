/**
 * THE SCOPE FENCE, AS A MACHINE CHECK.
 *
 * The link-health sweep was approved as read-only: it produces the evidence for a per-venue
 * retirement decision, it never makes one. "I didn't write to the database" is a claim; this turns
 * it into a passing assertion, and — the part that matters — keeps it true for the next person who
 * edits the file six months from now. Same instrument as the PROTECTED_IDS guard on the Vegas
 * parity batch: a fence that can fail is worth more than one asserted in prose.
 *
 * If a future slice genuinely needs this tool to write (say, stamping a `link_checked_at`), that is
 * a new owner decision and this test is the thing that should stop the change until it is made.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

const FILES = [
  join(repoRoot, 'scripts', 'link-health-sweep.mjs'),
  join(repoRoot, 'scripts', 'lib', 'link-health.mjs'),
]

/**
 * supabase-js mutating verbs, plus rpc (which can mutate behind a function name) and the raw
 * REST verbs. Written as a regex over the source rather than a string list so a call spread
 * across lines still matches.
 */
const MUTATING = [
  /\.\s*insert\s*\(/,
  /\.\s*upsert\s*\(/,
  /\.\s*update\s*\(/,
  /\.\s*delete\s*\(/,
  /\.\s*rpc\s*\(/,
  /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i,
]

/** Comments are documentation, not behaviour — strip them before asserting on code. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

describe('link-health is read-only, mechanically', () => {
  it.each(FILES)('%s contains no mutating database call', (file) => {
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const pattern of MUTATING) {
      expect(pattern.test(code), `${file} matched ${pattern}`).toBe(false)
    }
  })

  it('makes no Google Places call — that is spend and needs its own approval', () => {
    const code = stripComments(readFileSync(FILES[0], 'utf8'))
    expect(/places\.googleapis\.com|maps\.googleapis\.com|GOOGLE_MAPS_API_KEY/i.test(code)).toBe(false)
  })

  it('makes no Nominatim call — five geocode sessions share that budget', () => {
    // Assert on the ENDPOINT and the module import, not the bare word: the script's own banner
    // line prints "no Nominatim", and a test that forbids saying so would forbid documenting it.
    const code = stripComments(readFileSync(FILES[0], 'utf8'))
    expect(/nominatim\.openstreetmap\.org/i.test(code)).toBe(false)
    expect(/from\s+['"`][^'"`]*geocode-nominatim\.mjs['"`]/.test(code)).toBe(false)
  })

  it('never sets facility_listings.status — retiring a row is an owner decision per venue', () => {
    const code = stripComments(readFileSync(FILES[0], 'utf8'))
    expect(/status\s*:\s*['"`](draft|retired|closed)['"`]/.test(code)).toBe(false)
  })

  it('skips aggregator hosts (ADR-14: never a bulk-scrape source)', () => {
    const code = readFileSync(FILES[0], 'utf8')
    expect(code).toMatch(/AGGREGATOR_HOST/)
  })

  it('paginates with a short-page terminator and a unique sort key (PostgREST 1000-row cap)', () => {
    // Published crossed 1000 on 2026-08-05 and silently truncated the sitemap and two metro pages.
    // A cap returns a SHORT result and no error, so the only safe terminator is a short page.
    const code = readFileSync(FILES[0], 'utf8')
    expect(code).toMatch(/\.range\(/)
    expect(code).toMatch(/\.order\('slug'/)
    expect(code).toMatch(/data\.length\s*<\s*PAGE/)
  })

  it('propagates read errors instead of degrading to an empty array', () => {
    const code = readFileSync(FILES[0], 'utf8')
    expect(code).toMatch(/if\s*\(error\)\s*throw/)
  })
})
