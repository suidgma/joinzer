import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

// ─── shared state across this suite ─────────────────────────────────────────
let createdTournamentId: string | null = null

test.describe('Tournament flows', () => {
  test.beforeAll(async ({ browser }) => {
    // Login once; reuse the page context within beforeAll only for auth setup.
    // Individual tests get a fresh page via `page` fixture but share browser storage.
  })

  // ── 1. Create tournament ─────────────────────────────────────────────────
  test('organizer can create a tournament', async ({ page }) => {
    await login(page)
    await page.goto('/tournaments/create')

    // Fill Basics
    await page.getByLabel(/tournament name/i).fill('Playwright Test Tournament')

    // Fill Schedule — date must be today or future, start_time is required (NOT NULL)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().split('T')[0]
    await page.getByLabel(/date/i).fill(dateStr)
    // Fill start time via the unlabelled time input inside the "Times" row
    await page.locator('input[type="time"]').first().fill('09:00')

    // Submit
    await page.getByRole('button', { name: /create tournament/i }).click()

    // Should redirect to the tournament manage page
    await page.waitForURL(/\/tournaments\/[a-f0-9-]{36}$/, { timeout: 10_000 })
    createdTournamentId = page.url().split('/tournaments/')[1]

    await expect(page.getByText('Playwright Test Tournament')).toBeVisible()
  })

  // ── 2. Manage page loads for organizer ──────────────────────────────────
  test('organizer sees manage view with divisions section', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`)

    await expect(page.getByRole('heading', { name: 'Divisions' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Add Division' })).toBeVisible()
  })

  // ── 3. Add a division ───────────────────────────────────────────────────
  test('organizer can add a division', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`)

    await page.getByText('+ Add Division').click()
    await expect(page.getByText('New Division')).toBeVisible()

    // Category defaults to mixed — just submit with defaults
    await page.getByRole('button', { name: /create division/i }).click()

    // Division card should appear
    await expect(page.getByText(/mixed/i).first()).toBeVisible()
  })

  // ── 4. Edit tournament ──────────────────────────────────────────────────
  test('organizer can navigate to edit page', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`)

    await page.getByRole('link', { name: /edit tournament/i }).click()
    await page.waitForURL(/\/tournaments\/.*\/edit/)
    await expect(page.getByText(/edit tournament/i)).toBeVisible()
  })

  // ── 5. Tournament listing page ──────────────────────────────────────────
  test('tournament listing shows created tournament', async ({ page }) => {
    await login(page)
    await page.goto('/tournaments')

    // Use first() to handle any leftover duplicates from previous test runs
    await expect(page.getByText('Playwright Test Tournament').first()).toBeVisible()
  })

  // ── 6. Player view (unauthenticated simulate via different session) ──────
  test('tournament detail page is accessible and shows key info', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`)

    // Tournament name visible
    await expect(page.getByText('Playwright Test Tournament')).toBeVisible()
    // Status badge visible
    await expect(page.getByText(/draft|published/i).first()).toBeVisible()
  })

  // ── 7. Delete tournament (cleanup — runs last) ───────────────────────────
  test('organizer can delete tournament', async ({ page }) => {
    await login(page)
    if (!createdTournamentId) test.skip()
    await page.goto(`/tournaments/${createdTournamentId}`)

    // Intercept the confirm dialog
    page.on('dialog', dialog => dialog.accept())

    await page.getByRole('button', { name: /delete/i }).click()

    // Should redirect away from the tournament
    await page.waitForURL(/\/tournaments$/, { timeout: 10_000 })
    await expect(page.getByText('Playwright Test Tournament')).not.toBeVisible()
  })
})
