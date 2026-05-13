import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

const NAV_LINKS = [
  { label: 'Play',        url: /\/events/ },
  { label: 'Leagues',     url: /\/compete/ },
  { label: 'Tournaments', url: /\/tournaments/ },
  { label: 'Players',     url: /\/players/ },
  { label: 'Profile',     url: /\/profile/ },
]

test.describe('Navigation', () => {
  test('desktop nav links navigate to correct pages', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 1280, height: 800 })

    for (const link of NAV_LINKS) {
      // Reset to /home before each click to avoid cascading navigation state issues
      await page.goto('/home', { waitUntil: 'commit' })
      await page.waitForLoadState('networkidle')
      await page.locator('header').getByRole('link', { name: link.label, exact: true }).click()
      await page.waitForURL(link.url, { timeout: 12_000 })
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('bottom nav visible on mobile', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/home', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.locator('nav').last()).toBeVisible()
  })

  test('desktop nav hidden on mobile', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/home', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    const desktopNav = page.locator('header nav')
    if (await desktopNav.count()) {
      await expect(desktopNav).not.toBeVisible()
    }
  })
})
