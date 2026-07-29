import { test, expect, type Page } from '@playwright/test'
import {
  VIEWPORTS, FACET_LABELS, METROS, metroPath,
  facetPanel, openFilters, facetGroup, readChips, readCoverage, presentFacetLabels,
  readResults, facilityRows, rowSummaries, chipParam, activeFilterBar, readRobots,
} from './helpers/directory'

/**
 * THE HONESTY RULE.
 *
 * lib/directory/facets.ts states the contract this file enforces: filters are INCLUSIVE-ONLY, and
 * absence is never a negative. Two distinct kinds of absence both sit outside every bucket —
 *   NULL      = not yet researched
 *   'unknown' = researched but undetermined (a STORED value, migration 20260724000002)
 * 'unknown' is the trap, because count(non-null) makes it look like coverage.
 *
 * A leak here does not throw or 500. It quietly asserts something false about a real venue — tells
 * a player a court is free when nobody ever confirmed it. That is a reputational bug, not a
 * rendering bug, which is exactly why it needs a test rather than a code review.
 *
 * Everything below is derived from the page, never hardcoded, so it holds as the directory grows.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const METRO_LIST = [METROS.phoenix, METROS.reno]

/** Facets whose value is echoed in a row's summary chip, so a leak is visible in the DOM. */
const OBSERVABLE = [
  { param: 'fee=free', token: 'Free' },
  { param: 'access=public', token: 'Public' },
  { param: 'setting=indoor', token: 'Indoor' },
  { param: 'setting=outdoor', token: 'Outdoor' },
]

for (const { form, viewport } of VIEWPORTS) {
  test.describe(`Honesty rule — ${form} (${viewport.width}px)`, () => {
    test.use({ viewport })

    for (const metro of METRO_LIST) {
      test(`${metro.slug}: 'unknown' is never selectable, linked, or in a query param`, async ({ page }) => {
        await page.goto(metroPath(metro.slug), { waitUntil: 'commit' })
        await page.waitForLoadState('networkidle')
        await openFilters(page, form)

        const panel = facetPanel(page, form)
        for (const label of await presentFacetLabels(panel)) {
          for (const chip of await readChips(facetGroup(panel, label))) {
            expect(chip.label.toLowerCase(), `${label} facet offers an "unknown" chip`).not.toContain('unknown')
            expect(chip.href.toLowerCase(), `${label} chip links to an unknown value: ${chip.href}`)
              .not.toContain('unknown')
          }
        }

        // Nothing anywhere on the page may link to an unknown value.
        const hrefs = await page.locator('a[href]').evaluateAll((links) =>
          links.map((link) => link.getAttribute('href') ?? '')
        )
        const offenders = hrefs.filter((href) => /unknown/i.test(href))
        expect(offenders, `hrefs containing "unknown": ${offenders.join(', ')}`).toHaveLength(0)

        // And the filter UI must not say the word at all.
        await expect(panel).not.toContainText(/unknown/i)
      })

      test(`${metro.slug}: chip counts sum to the confirmed rows, never to the total`, async ({ page }) => {
        // THE CORE ASSERTION OF THIS FILE. A facet's options are mutually exclusive, so their counts
        // sum to exactly the rows holding an affirmative value. If a NULL or 'unknown' row leaked
        // into any bucket, the sum would exceed the "Confirmed for N of M" figure.
        // Measured 2026-07-28 — Phoenix: Cost 51+26+83 = 160 of 176; Access 74+7+28+49+2 = 160 of 176;
        // Setting 34+125 = 159 of 176; Getting on court 73+24+17 = 114 of 176.
        await page.goto(metroPath(metro.slug), { waitUntil: 'commit' })
        await page.waitForLoadState('networkidle')
        await openFilters(page, form)

        const panel = facetPanel(page, form)
        const { total } = await readResults(page)
        const labels = await presentFacetLabels(panel)
        expect(labels.length, 'the metro renders facet groups').toBeGreaterThan(0)

        for (const label of labels) {
          const group = facetGroup(panel, label)
          const sum = (await readChips(group)).reduce((running, chip) => running + chip.count, 0)
          const coverage = await readCoverage(group)

          if (coverage) {
            // A shortfall is expected and honest; an overshoot means unknowns are being counted.
            // Equality also catches the reverse failure: a stored value with no matching option
            // would be counted as "confirmed" while being invisible to every filter.
            expect(sum, `${label}: chip counts must equal the confirmed count`).toBe(coverage.known)
            expect(coverage.known, `${label}: confirmed cannot exceed total`).toBeLessThanOrEqual(coverage.total)
            expect(coverage.total, `${label}: coverage total is the metro total`).toBe(total)
          } else {
            // No coverage line means the facet is fully researched, so every row is in some bucket.
            expect(sum, `${label}: fully-researched facet must account for every facility`).toBe(total)
          }
        }
      })
    }

    for (const { param, token } of OBSERVABLE) {
      test(`?${param} returns only rows affirmatively marked "${token}"`, async ({ page }) => {
        // Row summaries render affirmative facts only — an absent or 'unknown' value produces no
        // text at all (FacilityRows.tsx). So a row missing the token is a row that leaked in.
        await page.goto(`${metroPath(METROS.phoenix.slug)}?${param}`, { waitUntil: 'commit' })
        await page.waitForLoadState('networkidle')

        const { matched } = await readResults(page)
        expect(matched, `?${param} must match at least one row`).toBeGreaterThan(0)
        await expect(facilityRows(page)).toHaveCount(matched)

        const summaries = await rowSummaries(page).allInnerTexts()
        expect(summaries).toHaveLength(matched)

        const leaked = summaries.filter((summary) => !summary.includes(token))
        expect(
          leaked,
          `${leaked.length} of ${matched} rows matched ?${param} without an affirmative "${token}" value: ` +
            `${leaked.slice(0, 5).join(' | ')}`
        ).toHaveLength(0)
      })
    }

    test('an unselected facet never advertises more rows than currently match', async ({ page }) => {
      await page.goto(`${metroPath(METROS.phoenix.slug)}?fee=free`, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      await openFilters(page, form)

      const panel = facetPanel(page, form)
      const { matched } = await readResults(page)

      for (const label of await presentFacetLabels(panel)) {
        const group = facetGroup(panel, label)
        const chips = await readChips(group)
        // The facet holding the active selection is counted against the set filtered by all OTHER
        // facets (facets.ts: `except`), so its totals legitimately exceed the matched count.
        if (chips.some((chip) => chip.selected)) continue
        const sum = chips.reduce((running, chip) => running + chip.count, 0)
        expect(sum, `${label}: counts exceed the ${matched} rows that match`).toBeLessThanOrEqual(matched)
      }
    })

    test('an unrecognized facet value is dropped, not honored', async ({ page }) => {
      // 'unknown' is a real stored value, so this is the shape of the mistake that would expose it:
      // parseSelection() validates against the facet definitions and drops anything unrecognized.
      const base = metroPath(METROS.phoenix.slug)
      await page.goto(base, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      const clean = await readResults(page)

      await page.goto(`${base}?fee=unknown&access=unknown`, { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')

      const bogus = await readResults(page)
      expect(bogus.matched, '?fee=unknown must not filter to the unknown rows').toBe(clean.total)
      await expect(facilityRows(page)).toHaveCount(clean.total)
      await expect(activeFilterBar(page).label, 'a dropped value must not register as an active filter')
        .toHaveCount(0)
      // Dropped params leave the canonical page, so it must stay indexable.
      expect(await readRobots(page)).toBeNull()
    })
  })
}

test.describe('Honesty rule — empty state (375px, the design target)', () => {
  test.use({ viewport: VIEWPORTS[0].viewport, storageState: { cookies: [], origins: [] } })

  test('empty-state copy is about the filters, never a claim about the world', async ({ page }) => {
    const base = metroPath(METROS.phoenix.slug)
    const { citySlug, cityLabel } = await findCityWithNoFreeCourts(page, base)

    await page.goto(`${base}?fee=free&city=${citySlug}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    expect((await readResults(page)).matched, `${cityLabel} has no free courts on record`).toBe(0)
    await expect(facilityRows(page)).toHaveCount(0)

    const main = page.locator('main')
    await expect(main).toContainText('No courts match these filters.')

    // The distinction that matters: we may simply not have researched the excluded rows, so the
    // page may not state that free courts do not exist here.
    for (const negative of [
      /there (are|is) no/i,
      /no free courts/i,
      /none of/i,
      /we don'?t have/i,
      /has no courts/i,
      /doesn'?t have/i,
    ]) {
      await expect(main, `empty state implies a negative: ${negative}`).not.toContainText(negative)
    }

    // The escape hatch works and restores everything.
    await page.getByRole('link', { name: 'Clear filters' }).click()
    await page.waitForURL((url) => url.pathname === base && url.search === '')
    const restored = await readResults(page)
    expect(restored.matched).toBe(restored.total)
    await expect(facilityRows(page)).toHaveCount(restored.total)
  })
})

/**
 * A city with zero free courts, derived rather than hardcoded: the set of cities offered on the
 * unfiltered page minus the set still offered under ?fee=free. Counts never lie on this surface —
 * a zero-count chip is dropped — so an empty result is not reachable by clicking, only by URL.
 */
async function findCityWithNoFreeCourts(page: Page, base: string) {
  const cityChips = async (url: string) => {
    await page.goto(url, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await openFilters(page, 'mobile')
    return readChips(facetGroup(facetPanel(page, 'mobile'), FACET_LABELS.city))
  }

  const all = await cityChips(base)
  const withFree = new Set((await cityChips(`${base}?fee=free`)).map((chip) => chip.label))
  const target = all.find((chip) => !withFree.has(chip.label))

  expect(target, 'expected at least one city with no free courts on record').toBeTruthy()
  const citySlug = chipParam(target!.href, 'city')
  expect(citySlug, `city chip "${target!.label}" has no city param: ${target!.href}`).toBeTruthy()
  return { citySlug: citySlug!, cityLabel: target!.label }
}
