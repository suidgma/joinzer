import { test, expect } from '@playwright/test'
import {
  VIEWPORTS, FACET_LABELS, METROS, metroPath,
  facetPanel, inactiveFacetPanel, openFilters, facetGroup, readChips,
  readResults, resultsHeader, facilityRows, activeFilterBar, readRobots,
  expectNoHorizontalOverflow,
} from './helpers/directory'

/**
 * Metro landing pages: rendering, facet filtering, shareable filtered URLs, and the noindex rule.
 * The honesty guarantees (no 'unknown' anywhere, inclusive-only filtering, empty-state copy) are a
 * separate file — courts-honesty.spec.ts.
 *
 * Public directory pages, so no login: these run anonymously like a real visitor.
 *
 * COUNT ASSERTIONS ARE RELATIONAL, NOT HARDCODED. The directory grows; "Phoenix has 176 venues"
 * would break on every publish and teach the team to update numbers reflexively. What is asserted
 * instead is the set of invariants that can only break because of a bug:
 *   - the results header equals the number of rows actually rendered
 *   - the count advertised on a chip equals the result count after clicking it
 *   - the /courts hub's count for a metro equals that metro page's own count
 * FacetPanel's own contract is "a count is exactly what you get if you click it — never a promise
 * the page can't keep" (lib/directory/facets.ts). These assert precisely that.
 */

test.use({ storageState: { cookies: [], origins: [] } })

for (const { form, viewport } of VIEWPORTS) {
  test.describe(`Court directory — ${form} (${viewport.width}px)`, () => {
    test.use({ viewport })

    test('metro page renders with a consistent venue count', async ({ page }) => {
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('heading', { level: 1, name: /Pickleball courts in Phoenix/ })).toBeVisible()

      const { matched, total } = await readResults(page)
      expect(matched, 'unfiltered page shows every facility').toBe(total)
      expect(total).toBeGreaterThan(0)
      await expect(
        facilityRows(page),
        'the header count must equal the rows actually rendered — a mismatch means rows were dropped'
      ).toHaveCount(total)

      await expectNoHorizontalOverflow(page)
    })

    test('facilities are grouped by city and every facility lands in a group', async ({ page }) => {
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const jumpLinks = page.getByRole('navigation', { name: 'Jump to city' }).getByRole('link')
      const cityCount = await jumpLinks.count()
      expect(cityCount, 'Phoenix spans multiple cities').toBeGreaterThan(1)

      // Each jump link reads "Mesa (28)". The per-city numbers must account for every facility —
      // if they don't, a city section is silently missing rows.
      const perCity = (await jumpLinks.allInnerTexts())
        .map((text) => Number(text.match(/\((\d+)\)\s*$/)![1]))
      const { total } = await readResults(page)
      expect(perCity.reduce((sum, n) => sum + n, 0), 'city groups must cover every facility').toBe(total)

      await expect(page.locator('main section > h2')).toHaveCount(cityCount)
    })

    test('OpenStreetMap attribution is present (ODbL, brief §6)', async ({ page }) => {
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const attribution = page.getByRole('link', { name: /OpenStreetMap contributors/ })
      await expect(attribution).toBeVisible()
      await expect(attribution).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    })

    test('the correct filter panel branch renders for this viewport', async ({ page }) => {
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      // Both branches are always in the DOM; exactly one may be shown.
      await expect(facetPanel(page, form)).toBeVisible()
      await expect(inactiveFacetPanel(page, form)).toBeHidden()
    })

    test('selecting a facet chip narrows the results to its advertised count', async ({ page }) => {
      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      await openFilters(page, form)

      const cost = facetGroup(facetPanel(page, form), FACET_LABELS.fee)
      const free = (await readChips(cost)).find((chip) => chip.label === 'Free')!
      expect(free, 'Phoenix has a Free chip in the Cost facet').toBeTruthy()
      expect(free.selected).toBe(false)

      const { total: before } = await readResults(page)
      expect(free.count).toBeLessThan(before)

      await facetPanel(page, form).getByRole('link', { name: `Free ${free.count}` }).click()
      await page.waitForURL(/[?&]fee=free/)

      const after = await readResults(page)
      expect(after.matched, 'clicking a chip must yield exactly the count it advertised').toBe(free.count)
      expect(after.total).toBe(before)
      await expect(facilityRows(page)).toHaveCount(free.count)

      await expect(activeFilterBar(page).label).toBeVisible()
      await expect(activeFilterBar(page).chips).toHaveCount(1)
    })

    test('facets AND-narrow across each other', async ({ page }) => {
      // Verified example (Phoenix, 2026-07-28): free = 51, free+indoor = 1, free+outdoor = 50.
      // Asserted as relationships so the spec survives the dataset growing.
      await page.goto(`${metroPath(METROS.phoenix.slug)}?fee=free`, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      await openFilters(page, form)

      const free = (await readResults(page)).matched
      const setting = facetGroup(facetPanel(page, form), FACET_LABELS.setting)
      const settingChips = await readChips(setting)
      const indoor = settingChips.find((chip) => chip.label === 'Indoor')!
      const outdoor = settingChips.find((chip) => chip.label === 'Outdoor')!

      // Counts shown while a filter is active are computed against the already-filtered set.
      expect(indoor.count).toBeLessThan(free)
      expect(outdoor.count).toBeLessThan(free)
      expect(
        indoor.count + outdoor.count,
        'indoor and outdoor are disjoint subsets of the free rows — they can never exceed it'
      ).toBeLessThanOrEqual(free)

      await facetPanel(page, form).getByRole('link', { name: `Indoor ${indoor.count}` }).click()
      await page.waitForURL(/setting=indoor/)
      await expect(page).toHaveURL(/fee=free/)

      const narrowed = await readResults(page)
      expect(narrowed.matched, 'AND across facets, not OR').toBe(indoor.count)
      expect(narrowed.matched).toBeLessThan(free)
      await expect(facilityRows(page)).toHaveCount(narrowed.matched)
      await expect(activeFilterBar(page).chips).toHaveCount(2)
    })

    test('"Clear all" restores the full unfiltered set', async ({ page }) => {
      const base = metroPath(METROS.phoenix.slug)
      await page.goto(`${base}?fee=free&access=public`, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const filtered = await readResults(page)
      expect(filtered.matched).toBeLessThan(filtered.total)
      await expect(activeFilterBar(page).chips).toHaveCount(2)

      await activeFilterBar(page).clearAll.click()
      await page.waitForURL((url) => url.pathname === base && url.search === '')

      const cleared = await readResults(page)
      expect(cleared.matched, 'clearing must restore every facility').toBe(filtered.total)
      await expect(facilityRows(page)).toHaveCount(filtered.total)
      await expect(activeFilterBar(page).label).toHaveCount(0)
    })

    test('a shared filtered URL restores chip state and narrowed results', async ({ page }) => {
      // Straight navigation, no clicking — this is what a pasted link does.
      await page.goto(`${metroPath(METROS.phoenix.slug)}?fee=free&access=public`, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      await openFilters(page, form)

      const panel = facetPanel(page, form)
      const free = (await readChips(facetGroup(panel, FACET_LABELS.fee))).find((c) => c.label === 'Free')!
      const publicChip = (await readChips(facetGroup(panel, FACET_LABELS.access))).find((c) => c.label === 'Public')!

      expect(free.selected, 'fee=free must render the Free chip as pressed').toBe(true)
      expect(publicChip.selected, 'access=public must render the Public chip as pressed').toBe(true)

      const { matched, total } = await readResults(page)
      expect(matched).toBeLessThan(total)
      await expect(facilityRows(page)).toHaveCount(matched)

      const activeLabels = await activeFilterBar(page).chips.allInnerTexts()
      expect(activeLabels.join(' ')).toContain('Free')
      expect(activeLabels.join(' ')).toContain('Public')
    })

    test('facility links from a metro page resolve', async ({ page }) => {
      await page.goto(metroPath(METROS.reno.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const first = facilityRows(page).first()
      const href = await first.getAttribute('href')
      expect(href).toMatch(/^\/courts\/[a-z0-9-]+$/)

      await first.click()
      await page.waitForURL(new RegExp(`${href}$`))
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // The breadcrumb links back to the metro page.
      await expect(page.getByRole('link', { name: /Reno-Sparks/ }).first()).toBeVisible()
    })

    test('the /courts hub agrees with each metro page on its count', async ({ page }) => {
      await page.goto('/courts', { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const card = page.getByRole('link', { name: /Pickleball courts in Phoenix/ })
      await expect(card).toBeVisible()
      const hubCount = Number((await card.innerText()).match(/(\d+)\s+facilit/)![1])

      await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      expect(
        (await readResults(page)).total,
        'hub and metro page must not disagree about how many venues exist'
      ).toBe(hubCount)
    })

    test('noindex is applied to filtered URLs only', async ({ page }) => {
      const base = metroPath(METROS.phoenix.slug)

      // The clean metro URL is the indexable one.
      await page.goto(base, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      expect(await readRobots(page), 'the canonical metro URL must stay indexable').toBeNull()

      // Every filtered permutation is a crawl trap; expensive to undo once indexed.
      for (const query of ['?fee=free', '?fee=free&access=public', '?city=mesa', '?sort=courts']) {
        await page.goto(`${base}${query}`, { waitUntil: 'commit' })
        await page.waitForLoadState('networkidle')
        expect(await readRobots(page), `${query} must be noindex,follow`).toBe('noindex, follow')
      }
    })

    test('the /courts hub is indexable', async ({ page }) => {
      await page.goto('/courts', { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      expect(await readRobots(page)).toBeNull()
    })
  })
}

test.describe('Court directory — mobile-first essentials (375px)', () => {
  test.use({ viewport: VIEWPORTS[0].viewport, storageState: { cookies: [], origins: [] } })

  test('filters ship collapsed so results stay above the fold', async ({ page }) => {
    await page.goto(metroPath(METROS.phoenix.slug), { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    const details = page.locator('main details')
    await expect(details).toHaveJSProperty('open', false)

    const header = await resultsHeader(page).boundingBox()
    expect(header, 'results header must render').not.toBeNull()
    expect(
      header!.y,
      'the results count must be visible without scrolling past the filter panel at 375px'
    ).toBeLessThan(VIEWPORTS[0].viewport.height)
  })

  test('the filter summary reports how many filters are active', async ({ page }) => {
    await page.goto(`${metroPath(METROS.phoenix.slug)}?fee=free&access=public`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await expect(page.locator('main details > summary')).toContainText('Filters (2)')
  })

  test('expanding and collapsing the panel does not lose the active filters', async ({ page }) => {
    await page.goto(`${metroPath(METROS.phoenix.slug)}?fee=free`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    const before = await readResults(page)
    await openFilters(page, 'mobile')
    await expect(facetPanel(page, 'mobile').getByRole('link', { name: /^Free/ })).toHaveAttribute('aria-pressed', 'true')

    await page.locator('main details > summary').click()
    await expect(page.locator('main details')).toHaveJSProperty('open', false)
    expect((await readResults(page)).matched).toBe(before.matched)
  })
})
