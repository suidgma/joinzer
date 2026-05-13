import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.describe('Profile flows', () => {

  test('profile page loads with user info', async ({ page }) => {
    await login(page)
    await page.goto('/profile', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/profile/)
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible()
  })

  test('profile edit page loads', async ({ page }) => {
    await login(page)
    await page.goto('/profile/edit', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/profile\/edit/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('payment history page loads', async ({ page }) => {
    await login(page)
    await page.goto('/profile/payments', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/profile\/payments/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('payouts page loads and shows Stripe Connect status', async ({ page }) => {
    await login(page)
    await page.goto('/settings/payouts', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/settings\/payouts/)
    await expect(page.getByRole('heading', { name: /stripe connect/i })).toBeVisible()
  })
})
