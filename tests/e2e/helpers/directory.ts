import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared locators for the court directory (/courts, /courts/in/[metro], /courts/[slug]).
 *
 * THE SELECTOR HAZARD THIS FILE EXISTS TO CONTAIN
 *
 * FacetPanel renders the filter UI TWICE, always. A <details class="md:hidden"> for mobile and a
 * <div class="hidden md:block"> for desktop, sharing one FacetGroups child — a single <details>
 * that is open only at md+ isn't achievable in CSS without overriding UA behavior. Both branches
 * sit in the DOM at every viewport; only one is display:none.
 *
 * Consequences, measured against the live page at 1280px (Phoenix, 2026-07-28):
 *   page.locator('a[aria-pressed]')                    -> 80  (both branches)
 *   facetPanel(page,'desktop').locator('a[aria-pressed]') -> 40  (one branch)
 *
 * getByRole() happens to self-scope, because a display:none branch is absent from the accessibility
 * tree — page.getByRole('link', { name: 'Free 51' }) resolves to exactly 1. Do not rely on that.
 * It is an accident of the branches being toggled with `display`, and it does not hold for CSS
 * locators, getByText, or counting. Scope to facetPanel(page, form) and the hazard is gone either way.
 */

export type FormFactor = 'mobile' | 'desktop'

/** ADR-09: /courts is player-facing, so mobile is the design target and desktop the check. */
export const VIEWPORTS: { form: FormFactor; viewport: { width: number; height: number } }[] = [
  { form: 'mobile', viewport: { width: 375, height: 812 } },
  { form: 'desktop', viewport: { width: 1280, height: 800 } },
]

/** Facet group headings as they appear in the DOM (CSS uppercases them; the a11y name is not uppercased). */
export const FACET_LABELS = {
  fee: 'Cost',
  access: 'Access',
  setting: 'Setting',
  play: 'Getting on court',
  city: 'City',
} as const

/** The filter panel branch that is actually rendered at this viewport. */
export function facetPanel(page: Page, form: FormFactor): Locator {
  // Attribute-substring match, not `.md\:block` — Playwright's CSS engine rejects the escaped colon
  // ("'div.hidden.md:block' is not a valid selector").
  return form === 'mobile'
    ? page.locator('main details')
    : page.locator('main div[class*="md:block"]')
}

/** The branch that must NOT be showing at this viewport. */
export function inactiveFacetPanel(page: Page, form: FormFactor): Locator {
  return facetPanel(page, form === 'mobile' ? 'desktop' : 'mobile')
}

/**
 * Mobile ships the panel collapsed so results stay above the fold at 375px. Chips inside a closed
 * <details> are not in the accessibility tree, so every mobile chip assertion must expand first.
 * Desktop is always open — no-op.
 */
export async function openFilters(page: Page, form: FormFactor): Promise<void> {
  if (form !== 'mobile') return
  const details = page.locator('main details')
  if (await details.count() === 0) return
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!isOpen) await details.locator('> summary').click()
  await expect(details).toHaveJSProperty('open', true)
}

/**
 * One facet group. Structure from FacetPanel.tsx > FacetGroups:
 *   <div>                      <- the group
 *     <div><h3>Cost</h3><p>Confirmed for 160 of 176</p></div>
 *     <div><a/><a/><a/></div>  <- chips
 *   </div>
 * so the h3's grandparent is the group. If that structure changes, these specs should fail loudly.
 */
export function facetGroup(panel: Locator, label: string): Locator {
  return panel.getByRole('heading', { level: 3, name: label, exact: true }).locator('xpath=../..')
}

export function chips(group: Locator): Locator {
  return group.locator('a[aria-pressed]')
}

export type Chip = { label: string; count: number; href: string; selected: boolean }

/** Every chip in a facet group, with its advertised count. */
export async function readChips(group: Locator): Promise<Chip[]> {
  const all = chips(group)
  const total = await all.count()
  const out: Chip[] = []
  for (let i = 0; i < total; i++) {
    const chip = all.nth(i)
    // innerText is "Free\n51"; a wrapped label can add lines, so the LAST line is the count.
    const lines = (await chip.innerText()).split('\n').map((s) => s.trim()).filter(Boolean)
    out.push({
      label: lines.slice(0, -1).join(' '),
      count: Number(lines[lines.length - 1]),
      href: (await chip.getAttribute('href')) ?? '',
      selected: (await chip.getAttribute('aria-pressed')) === 'true',
    })
  }
  return out
}

/** Facet group labels present on this page. Groups are dropped when they can only return one bucket. */
export async function presentFacetLabels(panel: Locator): Promise<string[]> {
  return (await panel.getByRole('heading', { level: 3 }).allTextContents()).map((s) => s.trim())
}

/** "Confirmed for N of M" — rendered only when a facet is not fully researched. */
export function coverageLine(group: Locator): Locator {
  return group.getByText(/^Confirmed for \d+ of \d+$/)
}

export async function readCoverage(group: Locator): Promise<{ known: number; total: number } | null> {
  const line = coverageLine(group)
  if (await line.count() === 0) return null
  const match = (await line.innerText()).match(/Confirmed for (\d+) of (\d+)/)!
  return { known: Number(match[1]), total: Number(match[2]) }
}

/** The results header: "176 facilities" unfiltered, "51 of 176 facilities match" when filtering. */
export function resultsHeader(page: Page): Locator {
  return page.getByText(/^\d+(?: of \d+)? facilit(?:y|ies)(?: match)?$/)
}

export async function readResults(page: Page): Promise<{ matched: number; total: number }> {
  const text = (await resultsHeader(page).innerText()).trim()
  const filtered = text.match(/^(\d+) of (\d+) facilit/)
  if (filtered) return { matched: Number(filtered[1]), total: Number(filtered[2]) }
  const count = Number(text.match(/^(\d+)/)![1])
  return { matched: count, total: count }
}

/** Facility row links in the results list. Excludes breadcrumbs and the "All metros" link. */
export function facilityRows(page: Page): Locator {
  return page.locator('main ul li a[href^="/courts/"]')
}

/**
 * The right-hand summary of one row ("Outdoor · Public · Free").
 *
 * Scoped to the second direct <span> on purpose: matching the whole row would let a venue NAMED
 * "Freedom Park" satisfy an assertion about the FEE being free.
 */
export function rowSummary(row: Locator): Locator {
  return row.locator('> span').last()
}

/** One summary per rendered row, in order. Used to detect a NULL/'unknown' row leaking into a bucket. */
export function rowSummaries(page: Page): Locator {
  return page.locator('main ul li a[href^="/courts/"] > span:nth-child(2)')
}

/** The `city` value a city chip links to, e.g. 'anthem'. */
export function chipParam(href: string, key: string): string | null {
  return new URL(href, 'http://localhost').searchParams.get(key)
}

/** Active-filter bar above the results. Rendered once, so no branch scoping needed. */
export function activeFilterBar(page: Page) {
  return {
    label: page.getByText('Filtered by'),
    clearAll: page.getByRole('link', { name: 'Clear all' }),
    chips: page.getByRole('link', { name: /Remove filter/ }),
  }
}

export function robotsMeta(page: Page): Locator {
  return page.locator('meta[name="robots"]')
}

/** null when no robots meta is emitted — which is what an indexable page must look like. */
export async function readRobots(page: Page): Promise<string | null> {
  if (await robotsMeta(page).count() === 0) return null
  return await robotsMeta(page).getAttribute('content')
}

/** Viewport essential: the page must never scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    overflow.scrollWidth,
    `page scrolls horizontally (scrollWidth ${overflow.scrollWidth} > viewport ${overflow.innerWidth})`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1)
}

/** Metros published today. Kept in one place so a new metro is a one-line change. */
export const METROS = {
  phoenix: { slug: 'phoenix', area: 'Phoenix' },
  reno: { slug: 'reno-sparks', area: 'Reno-Sparks' },
} as const

export const metroPath = (slug: string) => `/courts/in/${slug}`
