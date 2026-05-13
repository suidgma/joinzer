'use strict'
import { type Page, type BrowserContext } from '@playwright/test'

export async function login(page: Page, role: 'primary' | 'secondary' = 'primary') {
  const email = role === 'secondary'
    ? process.env.TEST_USER2_EMAIL
    : process.env.TEST_USER_EMAIL
  const password = role === 'secondary'
    ? process.env.TEST_USER2_PASSWORD
    : process.env.TEST_USER_PASSWORD

  if (!email || !password) {
    throw new Error(`Credentials for role "${role}" not set in .env.test`)
  }

  // commit = wait for first byte; avoids ERR_ABORTED on Next.js streaming pages
  await page.goto('/login', { waitUntil: 'commit' })
  await page.waitForLoadState('networkidle')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  // Force a full reload to flush stale HMR chunks — without this, ChunkLoadError
  // blocks the layout from loading on the first client-side navigation after login.
  await page.reload({ waitUntil: 'networkidle' })
}

/** Fill the TimeSelect component (Hour / Minute / AM-PM selects) inside a container. */
export async function fillTimeSelect(
  page: Page,
  containerSelector: string,
  hour: string,   // e.g. "9"
  minute: string, // e.g. "00"
  period: 'AM' | 'PM'
) {
  const container = page.locator(containerSelector)
  const selects = container.locator('select')
  await selects.nth(0).selectOption(hour)
  await selects.nth(1).selectOption(minute)
  await selects.nth(2).selectOption(period)
}
