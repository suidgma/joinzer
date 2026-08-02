import { test, expect, type Page } from '@playwright/test'
import { VIEWPORTS, METROS, metroPath, facilityRows, expectNoHorizontalOverflow } from './helpers/directory'

/**
 * THE VENUE DETAIL PAGE.
 *
 * Before this file, /courts/[slug] had no rendered coverage at all — courts-crawler.spec.ts checks
 * that it returns 200, and courts-{directory,honesty}.spec.ts never leave /courts/in/[metro]. So a
 * page serving 817 published venues was asserted only to be non-empty HTTP.
 *
 * What it now renders is facility_listings.public_notes, which is NOT a clean operator field:
 * scripts/lib/workbook-extract.mjs concatenates unmappable enum values onto the operator's prose as
 * ' | field: raw' pairs. lib/directory/publicNotes.ts strips them. The unit tests pin that function
 * against verbatim production strings; this file pins the property that actually matters — that no
 * machine artifact reaches the DOM — because the failure mode is not an exception, it is a venue
 * page quietly showing "fee type: paid reservation | reservation policy: reservation optional".
 *
 * Same class of bug as the honesty rule next door: it does not throw, it just embarrasses the site.
 */

test.use({ storageState: { cookies: [], origins: [] } })

/** The prose paragraph under the hero — public_notes, or enrichment.description as a fallback. */
function bodyProse(page: Page) {
  return page.locator('main > p.leading-relaxed')
}

/**
 * A machine-appended `field: raw` pair, as lib/directory/publicNotes.ts defines it: the label is a
 * lowercase snake_case column name with underscores swapped for spaces, so it is always lowercase
 * words then a colon. Kept in sync with MACHINE_FIELD_PAIR there.
 */
const MACHINE_FIELD_PAIR = /^[a-z][a-z ]*:/

/** Language naming our own schema or workflow. Kept in sync with INTERNAL_LANGUAGE there. */
const INTERNAL_LANGUAGE =
  /court_count|remains? (?:null|blank)|leaves? [a-z_ ]*null|for recheck|unsupported [a-z ]*fields/i

/** Deterministic spread across the list — first, middle, last — never Math.random(). */
function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const step = Math.floor(items.length / count)
  return Array.from({ length: count }, (_, i) => items[i * step])
}

/** Facility URLs only — /courts/in/<metro> has a slash in the tail and is excluded by the pattern. */
function facilitySlugs(xml: string): string[] {
  return [...xml.matchAll(/<loc>https:\/\/www\.joinzer\.com\/courts\/([a-z0-9-]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((slug) => slug !== 'in')
}

/** Asserts the rendered prose carries nothing the filter is supposed to have removed. */
async function expectNoMachineArtifacts(page: Page, label: string): Promise<void> {
  const paragraphs = await bodyProse(page).allInnerTexts()

  for (const text of paragraphs) {
    expect(text, `${label}: machine delimiter reached the page`).not.toContain(' | ')
    expect(text, `${label}: rendered text starts with a raw field pair`).not.toMatch(MACHINE_FIELD_PAIR)
    expect(text, `${label}: database internals reached the page`).not.toMatch(INTERNAL_LANGUAGE)
  }
}

for (const { form, viewport } of VIEWPORTS) {
  test.describe(`Venue detail — ${form} (${viewport.width}px)`, () => {
    test.use({ viewport })

    test('a well-covered metro renders prose on every sampled venue', async ({ page }) => {
      // Phoenix is the deterministic case: all 176 published Phoenix rows carry public_notes and
      // none of them is a machine-only value, so "every sampled venue renders prose" is a fact
      // about the data, not a probability. Derived from the page so it survives the metro growing.
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      const hrefs = (await facilityRows(page).evaluateAll((links) =>
        links.map((link) => link.getAttribute('href'))
      )).filter((href): href is string => Boolean(href))

      expect(hrefs.length, 'the Phoenix metro page listed no facilities').toBeGreaterThan(0)

      for (const href of sample(hrefs, 3)) {
        await page.goto(href, { waitUntil: 'commit' })
        await expect(page.locator('h1')).toBeVisible()

        const prose = bodyProse(page)
        await expect(prose, `${href} should render body prose`).toHaveCount(1)
        expect((await prose.innerText()).trim().length, `${href} prose is a fragment`)
          .toBeGreaterThanOrEqual(20)

        await expectNoMachineArtifacts(page, href)
      }
    })

    test('no venue page ever renders a machine-appended field pair', async ({ page, request }) => {
      // Sampled across the whole sitemap, not one metro: the machine-kv rows are concentrated in
      // Madison, Huntsville, Durham, Modesto, Melbourne and Wichita, so a Phoenix-only sample would
      // never exercise the filter's main job.
      const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()
      const slugs = facilitySlugs(xml)
      expect(slugs.length, 'sitemap listed no facility URLs').toBeGreaterThan(0)

      for (const slug of sample(slugs, 8)) {
        await page.goto(`/courts/${slug}`, { waitUntil: 'commit' })
        await expect(page.locator('h1')).toBeVisible()
        await expectNoMachineArtifacts(page, `/courts/${slug}`)
      }
    })

    test('at most one body prose paragraph renders, never public_notes and description both', async ({
      page,
      request,
    }) => {
      // The precedence rule. All 13 rows carrying enrichment.description also carry public_notes,
      // and some descriptions contradict the notes (PebbleCreek's calls a resident-only club a
      // "public facility"), so rendering both would put a false claim next to a true one.
      const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()

      for (const slug of sample(facilitySlugs(xml), 6)) {
        await page.goto(`/courts/${slug}`, { waitUntil: 'commit' })
        await expect(page.locator('h1')).toBeVisible()
        expect(await bodyProse(page).count(), `/courts/${slug} rendered two prose blocks`)
          .toBeLessThanOrEqual(1)
      }
    })

    test('prose does not push the page sideways', async ({ page }) => {
      // 375 is the design target per ADR-09 — a venue page is a player-facing surface. The longest
      // live note is 482 characters, so this is the realistic worst case for the paragraph.
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      const href = await facilityRows(page).first().getAttribute('href')
      expect(href).toBeTruthy()

      await page.goto(href!, { waitUntil: 'commit' })
      await expect(page.locator('h1')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  })
}

test.describe('Venue detail — metadata', () => {
  test('the meta description prefers public_notes and is cut on a word boundary', async ({
    page,
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml', { maxRedirects: 0 })).text()

    for (const slug of sample(facilitySlugs(xml), 5)) {
      await page.goto(`/courts/${slug}`, { waitUntil: 'commit' })
      const description = await page.locator('meta[name="description"]').getAttribute('content')

      expect(description, `/courts/${slug} has no meta description`).toBeTruthy()
      expect(description!.length, `/courts/${slug} meta description too long`).toBeLessThanOrEqual(155)
      expect(description!, `/courts/${slug} meta description carries a machine pair`).not.toContain(' | ')
      expect(description!, `/courts/${slug} meta description leaks internals`).not.toMatch(INTERNAL_LANGUAGE)
      // A word-boundary cut never leaves a space or dangling punctuation before the ellipsis.
      expect(description!, `/courts/${slug} truncated mid-punctuation`).not.toMatch(/[\s,;:—-]…$/)
    }
  })
})
