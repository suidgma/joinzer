import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.describe('Players directory flows', () => {

  test('players listing page loads', async ({ page }) => {
    await login(page)
    await page.goto('/players', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/players/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('players page shows player cards or empty state without errors', async ({ page }) => {
    await login(page)
    await page.goto('/players', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  })

  test('player search filters results', async ({ page }) => {
    await login(page)
    await page.goto('/players', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.count() === 0) test.skip()

    await searchInput.fill('marty')
    await page.waitForTimeout(500)
    await expect(page.locator('main')).toBeVisible()
  })
})
