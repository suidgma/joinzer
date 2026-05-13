import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

let createdEventId: string | null = null

test.describe('Play session (coordination) flows', () => {

  test('play listing page loads', async ({ page }) => {
    await login(page)
    await page.goto('/events', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/events/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('user can create a play session', async ({ page }) => {
    await login(page)
    await page.goto('/events/create', { waitUntil: 'commit' })
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
    // Use nativeInputValueSetter to reliably update React's controlled date input state
    await page.locator('input[type="date"]').evaluate((el: HTMLInputElement, val: string) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, todayStr)
    await expect(page.locator('input[type="date"]')).toHaveValue(todayStr)

    // TimeSelect: 3 selects (hour, minute, AM/PM) — use 11 PM so session is always future
    const selects = page.locator('select')
    await selects.nth(0).selectOption('11')
    await selects.nth(1).selectOption('00')
    await selects.nth(2).selectOption('PM')

    await page.getByRole('button', { name: /create/i }).click()

    // After creation, router.push('/events/<id>') — wait for event detail page
    await page.waitForURL(url => url.pathname.startsWith('/events/') && !url.pathname.includes('/create'), { timeout: 15_000 })
    const url = page.url()
    const match = url.match(/\/events\/([^/]+)$/)
    if (match) createdEventId = match[1]
  })

  test('created session appears in listing', async ({ page }) => {
    await login(page)
    await page.goto('/events', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    // Session created for today should appear in the listing
    await expect(page.getByText('Playwright Test Session').first()).toBeVisible({ timeout: 10_000 })
  })

  test('event detail page loads with key info', async ({ page }) => {
    await login(page)
    if (!createdEventId) test.skip()
    await page.goto(`/events/${createdEventId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Playwright Test Session')).toBeVisible()
  })
})
