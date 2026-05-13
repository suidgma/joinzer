import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

let createdTournamentId: string | null = null

test.describe('Tournament flows', () => {

  test('tournament listing page loads and shows tournaments', async ({ page }) => {
    await login(page)
    // Use client-side nav (clicking the header link) — same as real user flow
    await page.locator('header').getByRole('link', { name: 'Tournaments', exact: true }).click()
    await page.waitForURL('/tournaments', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  })

  test('organizer can create a tournament', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    await page.goto('/tournaments/create', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await page.locator('#name').fill('Playwright Test Tournament')
    await expect(page.locator('#name')).toHaveValue('Playwright Test Tournament')

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().split('T')[0]

    // Use nativeInputValueSetter to reliably update React's controlled date input state
    await page.locator('#start-date').evaluate((el: HTMLInputElement, val: string) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, dateStr)
    await expect(page.locator('#start-date')).toHaveValue(dateStr)

    // TimeSelect: first 3 selects = Start time (hour, minute, period)
    const selects = page.locator('select')
    await selects.nth(0).selectOption('9')
    await selects.nth(1).selectOption('00')
    await selects.nth(2).selectOption('AM')

    // Verify state persists through the select re-renders
    await expect(page.locator('#name')).toHaveValue('Playwright Test Tournament')
    await expect(page.locator('#start-date')).toHaveValue(dateStr)

    await page.getByRole('button', { name: /create tournament/i }).click()

    await page.waitForURL(url => !url.pathname.includes('/create'), { timeout: 30_000, waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    const finalUrl = page.url()
    const match = finalUrl.match(/\/tournaments\/([^/]+)$/)
    if (match) createdTournamentId = match[1]

    await expect(page.getByText('Playwright Test Tournament')).toBeVisible()
  })

  test('organizer sees manage view with divisions section', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Divisions' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Add Division' })).toBeVisible()
  })

  test('organizer can add a division', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: '+ Add Division' }).click()
    await expect(page.getByText('New Division')).toBeVisible()

    await page.getByPlaceholder(/auto-generated if blank/i).fill('Mixed 3.5')
    await page.getByRole('button', { name: /create division/i }).click()

    await expect(page.getByText('Mixed 3.5').first()).toBeVisible({ timeout: 8_000 })
  })

  test('organizer can navigate to edit page', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await page.getByRole('link', { name: /edit/i }).first().click()
    await page.waitForURL(/\/tournaments\/.*\/edit/)
    await expect(page.getByText(/edit tournament/i)).toBeVisible()
  })

  test('organizer can open Staff & Roles page', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await page.getByRole('link', { name: /staff & roles/i }).click()
    await page.waitForURL(/\/tournaments\/.*\/staff/)
    await expect(page.getByRole('heading', { name: /add staff member/i })).toBeVisible()
  })

  test('organizer can open Import Players page', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    await page.getByRole('link', { name: /import players/i }).click()
    await page.waitForURL(/\/tournaments\/.*\/import/)
    await expect(page.getByText(/import players/i).first()).toBeVisible()
  })

  test('organizer can delete created tournament', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    page.on('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /delete/i }).click()

    await page.waitForURL(/\/tournaments$/, { timeout: 10_000 })
  })
})
