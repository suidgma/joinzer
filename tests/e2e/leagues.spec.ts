import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.describe('Leagues flows', () => {

  test('leagues listing page loads', async ({ page }) => {
    await login(page)
    await page.goto('/compete', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/compete/)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  })

  test('leagues page shows content or empty state', async ({ page }) => {
    await login(page)
    await page.goto('/compete', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    const hasContent = await page.getByRole('heading').count() > 0
    expect(hasContent).toBeTruthy()
  })
})
