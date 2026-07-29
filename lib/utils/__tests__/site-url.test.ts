import { describe, test, expect, afterEach } from 'vitest'
import { getSiteUrl } from '../site-url'

/**
 * getSiteUrl() is the single source for the public host. It feeds metadataBase (so every page's
 * canonical and og:image), app/sitemap.ts, app/robots.ts, the directory JSON-LD, Stripe redirect
 * URLs, ICS/QR links, transactional email links, and Supabase magic-link `redirectTo`.
 *
 * WHY THIS FILE EXISTS: the host was wrong in production for the entire life of the directory and
 * nothing failed. metadataBase resolved to the apex, which 307-redirects to www, so all 212 sitemap
 * URLs declared a canonical that redirected. There is no build error and no failing request for
 * that — only a silent SEO problem. These tests make the host a thing that fails a gate when it
 * moves, rather than something noticed weeks later in Search Console.
 */

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
})

describe('getSiteUrl', () => {
  test('defaults to the www host, which is the one that serves 200', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    // The apex 307-redirects here at the Vercel edge. A canonical must not redirect, so www is
    // canonical and the default must be www. NEXT_PUBLIC_SITE_URL is unset in Vercel, so this
    // default IS the production value — not merely a fallback.
    expect(getSiteUrl()).toBe('https://www.joinzer.com')
  })

  test('never returns the bare apex by default', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(getSiteUrl()).not.toBe('https://joinzer.com')
  })

  test('honors an environment override', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    expect(getSiteUrl()).toBe('http://localhost:3000')
  })

  test('strips trailing slashes so callers can always concatenate a path', () => {
    // Every consumer builds `${getSiteUrl()}/path`. A trailing slash would yield '//path', which
    // is a distinct URL to a crawler and a broken link in an email.
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.joinzer.com///'
    expect(getSiteUrl()).toBe('https://www.joinzer.com')
  })

  test('produces a valid URL for metadataBase, which constructs `new URL(...)`', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(() => new URL(getSiteUrl())).not.toThrow()
    expect(new URL(getSiteUrl()).host).toBe('www.joinzer.com')
  })
})
