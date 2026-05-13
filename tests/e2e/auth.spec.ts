import { test, expect } from '@playwright/test'

const EMAIL = process.env.TEST_USER_EMAIL!
const PASSWORD = process.env.TEST_USER_PASSWORD!

test.describe('Auth flows', () => {
  test('unauthenticated user is redirected from /home to /login', async ({ page }) => {
    await page.goto('/home')
    await page.waitForURL(/\/login/, { timeout: 8_000 })
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('sign in with valid credentials lands on /home', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/home/, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/home/)
  })

  test('sign in with wrong password shows error', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill('wrongpassword_xyz')
    await page.getByRole('button', { name: /sign in/i }).click()
    // Stay on login page and show an error
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/invalid|incorrect|error/i).first()).toBeVisible({ timeout: 8_000 })
  })

  test('sign out returns to login or home page', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/home/, { timeout: 15_000 })

    await page.goto('/profile')
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.waitForURL(url => url.pathname === '/login' || url.pathname === '/', { timeout: 8_000 })
  })
})
