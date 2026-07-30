import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'
import { deleteTestRow } from './helpers/cleanup'

let createdEventId: string | null = null

test.describe('Play session (coordination) flows', () => {
  // Backstop cleanup — deletes only the exact row this run created (re-verified by
  // id + owner + exact title). `events` has no delete UI/route, so this direct,
  // RLS-scoped delete is the only cleanup mechanism available for this table.
  test.afterAll(async () => {
    if (!createdEventId) return
    await deleteTestRow({
      table: 'events',
      id: createdEventId,
      ownerColumn: 'captain_user_id',
      titleColumn: 'title',
      expectedTitle: 'Playwright Test Session',
    })
  })

  test('play listing page loads', async ({ page }) => {
    await login(page)
    await page.goto('/play', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/play/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('user can create a play session', async ({ page }) => {
    await login(page)
    await page.goto('/play/create', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    // Title input has id="title" based on CreateEventForm
    const titleInput = page.getByPlaceholder('Saturday Morning Open Play')
    await titleInput.fill('Playwright Test Session')
    await expect(titleInput).toHaveValue('Playwright Test Session')

    // Select a location (required by form)
    await page.getByPlaceholder('Search locations…').click()
    await page.getByPlaceholder('Search locations…').fill('Sunset Park')
    await page.getByText('Sunset Park Pickleball Complex').click()

    // Use today's date so session appears in today's listing
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
      .format(new Date())
    // Use nativeInputValueSetter to reliably update React's controlled date input state.
    // Scoped to [required] — CreateEventForm renders a second, optional date input
    // ("No-refund date", added 2026-07-14) with no id/label association to key off,
    // so `input[type="date"]` alone now resolves to 2 elements (strict-mode violation).
    // `required` is the one attribute that uniquely — and meaningfully — identifies the
    // mandatory session Date field vs. the optional one.
    const sessionDateInput = page.locator('input[type="date"][required]')
    await sessionDateInput.evaluate((el: HTMLInputElement, val: string) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, todayStr)
    await expect(sessionDateInput).toHaveValue(todayStr)

    // TimeSelect: 3 selects (hour, minute, AM/PM) — use 11 PM so session is always future
    const selects = page.locator('select')
    await selects.nth(0).selectOption('11')
    await selects.nth(1).selectOption('00')
    await selects.nth(2).selectOption('PM')

    await page.getByRole('button', { name: /create/i }).click()

    // After creation, router.push('/play/<id>') — wait for event detail page
    await page.waitForURL(url => url.pathname.startsWith('/play/') && !url.pathname.includes('/create'), { timeout: 15_000 })
    const url = page.url()
    // Was matching /\/events\/.../ against a /play/<id> URL — never matched, so
    // createdEventId was always null and the test below always silently skipped.
    // Explicit UUID match, not [^/]+ up to end-of-string — same class of bug as
    // tournaments.spec.ts: [^/]+$ would swallow a trailing query string whole.
    const match = url.match(/\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    if (match) createdEventId = match[1]
  })

  test('created session appears in listing', async ({ page }) => {
    await login(page)
    await page.goto('/play', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    // Session created for today should appear in the listing
    await expect(page.getByText('Playwright Test Session').first()).toBeVisible({ timeout: 10_000 })
  })

  test('event detail page loads with key info', async ({ page }) => {
    await login(page)
    if (!createdEventId) test.skip()
    await page.goto(`/play/${createdEventId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Playwright Test Session')).toBeVisible()
  })
})
