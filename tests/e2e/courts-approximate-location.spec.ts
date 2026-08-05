import { test, expect, type Page } from '@playwright/test'
import { VIEWPORTS, METROS, metroPath } from './helpers/directory'

/**
 * THE APPROXIMATE-LOCATION LABEL (ADR-16).
 *
 * The owner's ruling releases 91 low-precision rows to publish. The condition attached to it is that
 * the reader is told the pin is a street band rather than the building. This file is what stops the
 * gate change and the label from drifting apart later — a future edit that relaxes the gate further,
 * or quietly drops the label from a surface, has to come and delete an assertion to do it.
 *
 * WHAT IS AND IS NOT EXERCISED TODAY. At the time of writing, `--stage=publish` has NOT been run, so
 * there are ZERO published low-precision rows. That makes the NEGATIVE control real right now — no
 * currently-published venue is high/medium and yet wearing the caveat — while the POSITIVE case has
 * nothing to match and reports itself as unexercised rather than passing silently. A spec that goes
 * green because it found nothing to check is worse than one that says so out loud, which is why the
 * positive test annotates and skips rather than vacuously passing.
 */

test.use({ storageState: { cookies: [], origins: [] } })

/** Kept in sync with lib/directory/locationPrecision.ts. Duplicated deliberately: a spec that
 *  imported the constant would still pass if the constant itself were emptied. */
const SHORT_LABEL = 'Approximate location'
const DETAIL_MARKER = /Approximate location — we have this venue’s street but not its exact building/

/** Every row on a metro page that carries the short marker. */
function approximateRows(page: Page) {
  return page.locator('main li', { hasText: SHORT_LABEL })
}

for (const { form, viewport } of VIEWPORTS) {
  test.describe(`approximate-location label · ${form} ${viewport.width}px`, () => {
    test.use({ viewport })

    /**
     * THE NEGATIVE CONTROL, and the one that is meaningful today. Asserting only the positive case
     * cannot distinguish "the label renders on approximate rows" from "the label renders on
     * everything" — and the second would put a false caveat on ~900 rows whose pins are rooftops.
     */
    test('a confident venue page never shows the caveat', async ({ page }) => {
      await page.goto(metroPath(Object.values(METROS)[0].slug), { waitUntil: 'domcontentloaded' })

      const rows = page.locator('main li a[href^="/courts/"]')
      await expect(rows.first()).toBeVisible()

      // Walk the first few venues that are NOT marked approximate on the list.
      const hrefs: string[] = []
      const count = Math.min(await rows.count(), 8)
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i)
        if ((await row.innerText()).includes(SHORT_LABEL)) continue
        const href = await row.getAttribute('href')
        if (href) hrefs.push(href)
      }
      expect(hrefs.length, 'expected at least one non-approximate venue to check').toBeGreaterThan(0)

      for (const href of hrefs.slice(0, 3)) {
        await page.goto(href, { waitUntil: 'domcontentloaded' })
        await expect(page.locator('h1')).toBeVisible()
        await expect(page.getByText(DETAIL_MARKER)).toHaveCount(0)
        await expect(page.getByText(SHORT_LABEL, { exact: true })).toHaveCount(0)
      }
    })

    /**
     * THE POSITIVE CASE. Arms itself the moment --stage=publish promotes the 91 rows; until then it
     * says why it could not run instead of passing on an empty set.
     */
    test('an approximate venue is labelled on both the list and the venue page', async ({ page }) => {
      let target: string | null = null

      for (const metro of Object.values(METROS)) {
        await page.goto(metroPath(metro.slug), { waitUntil: 'domcontentloaded' })
        const marked = approximateRows(page)
        if (await marked.count()) {
          target = await marked.first().locator('a[href^="/courts/"]').getAttribute('href')
          if (target) break
        }
      }

      test.skip(
        target === null,
        'No published low-precision rows yet — ADR-16 has shipped but --stage=publish has not been run, ' +
        'so the positive case has nothing to match. This is UNEXERCISED, not passing.',
      )

      // The list marker was the thing that found this row, so it is already asserted. Now the
      // detail page must carry the full sentence — the two surfaces must agree, because a row
      // labelled on one and bare on the other is how a reader concludes the caveat was a mistake.
      await page.goto(target!, { waitUntil: 'domcontentloaded' })
      const caveat = page.getByText(DETAIL_MARKER)
      await expect(caveat).toBeVisible()

      // It must precede the map button: a caveat placed after the call to action can be missed
      // entirely by someone who clicks straight through to Google Maps.
      const mapsLink = page.getByRole('link', { name: /View on Google Maps/i })
      if (await mapsLink.count()) {
        const caveatBox = await caveat.first().boundingBox()
        const mapsBox = await mapsLink.first().boundingBox()
        expect(caveatBox!.y).toBeLessThan(mapsBox!.y)
      }
    })
  })
}
