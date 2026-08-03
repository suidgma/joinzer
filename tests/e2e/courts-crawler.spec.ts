import { test, expect } from '@playwright/test'

/**
 * Crawler reachability for the public court directory.
 *
 * WHY THIS SPEC EXISTS: an allowlist entry in middleware.ts gets missed for a non-page asset, every
 * anonymous request 307s to /login, and the only symptom is traffic data weeks later. That has
 * silently regressed three times. PR #469 fixed the current instance by allowlisting /sitemap.xml
 * and /robots.txt; this spec is what makes a fourth occurrence loud instead of silent.
 *
 * TWO THINGS ARE LOAD-BEARING HERE — do not "simplify" either one away:
 *
 * 1. maxRedirects: 0. With redirects followed (the default), a 307 -> /login resolves to a 200 and
 *    every assertion below passes while production is de-indexed. Measured against this build:
 *    GET /home is 307 with maxRedirects:0 and 200 without. A redirect-following version of this
 *    spec is worse than no spec, because it reads as coverage.
 *
 * 2. The protected-route control. If middleware were disabled outright, every route would return
 *    200 and the reachability assertions would pass vacuously. The control proves the redirect
 *    mechanism is live, which is what gives the 200s meaning.
 *
 * These run at the request layer, not the browser, so they are viewport-independent by nature —
 * a crawler has no viewport. Rendering of these surfaces is covered in courts-directory.spec.ts
 * at both viewports.
 */

// Anonymous by construction. These specs never call login(), and an explicit empty storageState
// keeps them anonymous even if a global storageState is later added to playwright.config.ts.
test.use({ storageState: { cookies: [], origins: [] } })

const SITEMAP_URL = 'https://www.joinzer.com/sitemap.xml'

test.describe('Crawler reachability (anonymous requests)', () => {
  test('sitemap.xml, robots.txt and /courts return 200, never a redirect', async ({ request }) => {
    for (const route of ['/sitemap.xml', '/robots.txt', '/courts']) {
      const response = await request.get(route, { maxRedirects: 0 })
      expect(
        response.status(),
        `${route} must be reachable by anonymous crawlers — a 307 here silently de-indexes the directory`
      ).toBe(200)
      expect(response.headers()['location'], `${route} must not redirect`).toBeUndefined()
    }
  })

  test('control: a protected route still redirects anonymously', async ({ request }) => {
    // Without this, the assertions above would pass just as happily with middleware turned off.
    const response = await request.get('/home', { maxRedirects: 0 })
    expect(response.status(), '/home must stay behind auth').toBe(307)
    expect(response.headers()['location']).toContain('/login')
  })

  test('sitemap.xml is served as XML and lists the directory surfaces', async ({ request }) => {
    const response = await request.get('/sitemap.xml', { maxRedirects: 0 })
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('xml')

    const xml = await response.text()
    expect(xml).toContain('https://www.joinzer.com/courts')

    const metroUrls = [...xml.matchAll(/<loc>https:\/\/www\.joinzer\.com\/courts\/in\/[a-z0-9-]+<\/loc>/g)]
    expect(metroUrls.length, 'sitemap must list metro landing pages').toBeGreaterThan(0)

    expect(facilitySlugs(xml).length, 'sitemap must list published facility pages').toBeGreaterThan(0)

    // Filtered views are noindex and deliberately absent — a faceted crawl trap in the sitemap is
    // exactly the thing app/sitemap.ts documents itself as avoiding.
    expect(xml, 'sitemap must not advertise filtered facet URLs').not.toContain('?fee=')
    expect(xml).not.toContain('?access=')
    expect(xml).not.toContain('sort=courts')
  })

  test('robots.txt keeps canonical courts pages crawlable and blocks only the facet/sort permutations', async ({ request }) => {
    // Updated 2026-07-30: this used to assert NO Disallow rule could start with "/courts" at all,
    // which was correct when written (PR #469 was recovering from an accidental blanket block) but
    // became wrong once /courts/in/[metro]'s facet+sort combinations turned into a crawl trap that
    // paused production on Hobby limits (1.8M invocations against zero users). The real intent was
    // always two-sided — canonical courts pages stay crawlable, filtered permutations don't — and
    // that is what this now checks directly, in both directions, instead of via a blanket ban on the
    // string "/courts" that a legitimate scoped rule would also trip.
    const response = await request.get('/robots.txt', { maxRedirects: 0 })
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/plain')

    const body = await response.text()
    expect(body).toContain('Allow: /')
    expect(body).toContain(`Sitemap: ${SITEMAP_URL}`)
    // /api/ is an intended disallow; a blanket Disallow on the directory would be the same outage
    // as a 307, just self-inflicted.
    expect(body).toContain('Disallow: /api/')

    const disallowed = disallowedPaths(body)

    // (1) No rule blanket-blocks a canonical courts surface. This is the property PR #469 restored
    //     and the property that must never regress again: /courts, every /courts/in/<metro>, and
    //     every /courts/[slug] facility page must stay reachable by a crawler.
    for (const blanket of ['/courts', '/courts/', '/courts/in', '/courts/in/']) {
      expect(disallowed, `must not blanket-disallow ${blanket}`).not.toContain(blanket)
    }
    // (2) The facet/sort permutation space under /courts/in/<metro> IS disallowed — scoped by a
    //     literal "?" in the rule, so it cannot match a clean, unfiltered URL (which never carries one).
    const filteredRule = disallowed.find((p) => p.includes('/courts/in/') && p.includes('?'))
    expect(filteredRule, 'must disallow query-string permutations under /courts/in/<metro>').toBeTruthy()

    expect(body).not.toMatch(/Disallow:\s*\/\s*$/m)
  })

  test('a published facility page is reachable anonymously', async ({ request }) => {
    // Sampled from the sitemap rather than hardcoded: this asserts the exact URLs we advertise to
    // crawlers actually serve, which is the property that matters.
    const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()
    const slugs = facilitySlugs(xml)
    expect(slugs.length).toBeGreaterThan(0)

    for (const slug of sample(slugs, 3)) {
      const response = await request.get(`/courts/${slug}`, { maxRedirects: 0 })
      expect(response.status(), `/courts/${slug} (listed in sitemap.xml)`).toBe(200)
    }
  })

  test('metro landing pages listed in the sitemap are reachable anonymously', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()
    const metros = [...xml.matchAll(/<loc>https:\/\/www\.joinzer\.com(\/courts\/in\/[a-z0-9-]+)<\/loc>/g)]
      .map((match) => match[1])
    expect(metros.length).toBeGreaterThan(0)

    for (const path of metros) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status(), `${path} (listed in sitemap.xml)`).toBe(200)
    }
  })

  test('a metro not in the sitemap 404s rather than redirecting', async ({ request }) => {
    // The property under test: a metro URL we do NOT advertise must answer "not found", never "log
    // in" — a 307 tells a crawler the URL exists behind auth, which is the same de-indexing failure
    // the rest of this file guards, inverted.
    //
    // Updated 2026-08-02: this used to hardcode /courts/in/las-vegas on the premise that its rows
    // were all `draft`. That premise expired — Las Vegas is now 50 published / 24 draft, so the URL
    // renders 200 and the test failed on main. Verified against the joinzer project the same day:
    // EVERY non-null metro_area in facility_listings currently has at least one published row, so
    // there is no all-draft metro to swap in, and any metro picked today can be published tomorrow.
    // A synthetic slug is the only formulation that cannot go stale.
    //
    // It still covers the same ground: loadPublishedMetros() only ever selects status='published'
    // (lib/directory/loadFacilities.ts), so "metro whose rows are all draft" and "metro that does
    // not exist" both make findMetro() return null and the page call notFound()
    // (app/courts/in/[metro]/page.tsx:65). Identical path, identical crawler-facing answer.
    //
    // Guarded against the sitemap so the fixture slug cannot silently become a real metro.
    // The `toContain` guard below is a negative assertion, so it would pass vacuously on an empty
    // or error body — assert the sitemap actually listed metros before trusting it.
    const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()
    expect(xml, 'sitemap must list metros for the guard below to mean anything').toContain('/courts/in/')

    const slug = 'not-a-published-metro'
    expect(xml, 'fixture slug must not be a real metro').not.toContain(`/courts/in/${slug}`)

    const response = await request.get(`/courts/in/${slug}`, { maxRedirects: 0 })
    expect(response.status(), `/courts/in/${slug} is unpublished and must 404`).toBe(404)
    expect(
      response.headers()['location'],
      'a 307 would tell a crawler the URL exists behind auth'
    ).toBeUndefined()
  })
})

/** Every `Disallow:` value in a robots.txt body, exactly as written (no interpretation). */
function disallowedPaths(body: string): string[] {
  return [...body.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1])
}

/** Facility URLs only — /courts/in/<metro> has a slash in the tail and is excluded by the pattern. */
function facilitySlugs(xml: string): string[] {
  return [...xml.matchAll(/<loc>https:\/\/www\.joinzer\.com\/courts\/([a-z0-9-]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((slug) => slug !== 'in')
}

/** Deterministic spread across the list — first, middle, last — never Math.random(). */
function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const step = Math.floor(items.length / count)
  return Array.from({ length: count }, (_, i) => items[i * step])
}
