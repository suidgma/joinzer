import { type Page } from '@playwright/test'

/**
 * Log in with email/password and wait for redirect to the app.
 * Call once in a beforeAll, then reuse the page/context for the rest of the suite.
 *
 * Credentials come from environment variables:
 *   TEST_USER_EMAIL
 *   TEST_USER_PASSWORD
 *
 * Set them in a .env.test file or your shell before running tests.
 */
export async function login(page: Page) {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD must be set')
  }

  await page.goto('/login')

  // Fill by id to avoid ambiguity with multiple label matches
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait until redirected away from login — covers /home, /schedule, etc.
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })
}
