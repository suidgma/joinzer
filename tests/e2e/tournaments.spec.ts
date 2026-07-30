import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'
import { deleteTestRow, markDummy } from './helpers/cleanup'

let createdTournamentId: string | null = null

test.describe('Tournament flows', () => {
  // Backstop cleanup — runs regardless of whether the in-suite "delete created
  // tournament" test below actually removed the row. Deletes only the exact row
  // this run created (re-verified by id + owner + exact title), never a pattern.
  test.afterAll(async () => {
    if (!createdTournamentId) return
    await deleteTestRow({
      table: 'tournaments',
      id: createdTournamentId,
      ownerColumn: 'organizer_id',
      titleColumn: 'name',
      expectedTitle: 'Playwright Test Tournament',
    })
  })

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
    // Explicit UUID match, not [^/]+ up to end-of-string — the redirect can carry a
    // query string (e.g. ?created=1), which [^/]+$ swallowed whole, producing a
    // non-uuid id that broke both markDummy() and the afterAll delete below.
    const match = finalUrl.match(/\/tournaments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    if (match) {
      createdTournamentId = match[1]
      // Mark as test data immediately — if this run crashes before teardown runs,
      // the row is still identifiable and sweepable, not just a bare title string.
      await markDummy(createdTournamentId)
    }

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

    // Division Name has no id/htmlFor label association (same gap as the play-session
    // date field in play.spec.ts), and since commit 75e18f0 (2026-06-12, "bracket
    // inline scoring, division UX...") its placeholder is a *live* auto-generated
    // preview (buildAutoName(fCategory, fTeamType, fSkill, ageSegment, fBracketType))
    // rather than the static "auto-generated if blank" hint the old selector matched
    // — so neither getByLabel nor getByPlaceholder(/auto-generated/) can find it
    // anymore. Scope to the "New Division" form (unique — exactly one <form>
    // containing that heading); within it every other field is a
    // select/number/checkbox/radio, so its lone input[type="text"] is unambiguous
    // without being positional.
    const newDivisionForm = page.locator('form', { has: page.getByRole('heading', { name: 'New Division' }) })
    const divisionNameInput = newDivisionForm.locator('input[type="text"]')

    // Before typing, fNameDirty is false and the field mirrors the live fAutoName
    // preview (e.g. "Mixed — Doubles — Round Robin") — assert that real state exists
    // before triggering the fNameDirty transition below, not just that the input is
    // present.
    const liveAutoName = await divisionNameInput.inputValue()
    expect(liveAutoName.length).toBeGreaterThan(0)
    expect(liveAutoName).not.toBe('Mixed 3.5')

    // Typing flips fNameDirty true, swapping the field's value source from the live
    // fAutoName preview to the organizer's typed fName — a real state transition,
    // not just a fill-and-move-on.
    await divisionNameInput.fill('Mixed 3.5')
    await expect(divisionNameInput).toHaveValue('Mixed 3.5')

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

    // `getByText(/edit tournament/i)` resolves to 3 elements: the page's own
    // breadcrumb (`DesktopShell` header, "← Back / Edit Tournament"), plus
    // `WizardOutline`'s title rendered twice in the rail — once for its mobile
    // progress-bar view (`lg:hidden`), once for its desktop sticky-outline view
    // (`hidden lg:block`) — both present in the DOM at once regardless of viewport
    // (same both-branches-render pattern as the court-directory FacetPanel). Scoping
    // by an ancestor container doesn't help — `hasText` matches on any descendant
    // text, so every wrapping div up to the page root (including ones that also
    // wrap the aside) "has" both the breadcrumb text and the rail text, and a
    // container-based filter excludes nothing (verified empirically — same 3-element
    // violation even scoped to a "← Back"-containing div).
    //
    // Better signal anyway: instead of chasing ambient chrome text, assert the
    // actual edit form loaded pre-populated with this tournament's data — `#name`
    // is uniquely identified (id-based, properly `htmlFor`-associated via FormRow,
    // unlike the DivisionsSection fields above) and only exists on this page.
    await expect(page.locator('#name')).toHaveValue('Playwright Test Tournament')
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

    // getByRole('button', { name: /delete/i }) resolves to 2 elements outside the
    // modal: the tournament-level DeleteTournamentButton, plus the "Mixed 3.5"
    // division's own Delete button (DivisionsSection renders inside
    // id="tournament-divisions"). Scope out the divisions section to reach the
    // tournament-level trigger specifically.
    const tournamentDeleteButton = page.locator('button:not(#tournament-divisions button)', { hasText: /^delete$/i })
    await tournamentDeleteButton.click()

    // DeleteTournamentButton opens DialogProvider's custom confirm modal
    // (components/ui/DialogProvider.tsx) via useDialog().confirm() — not
    // window.confirm() — so a page.on('dialog', ...) handler never fires (no
    // native dialog is ever raised); one was here previously and was dead,
    // misleading code, since removed. The modal has role="dialog" +
    // aria-modal="true" and renders its confirm button with the caller's
    // confirmLabel ('Delete' here, danger-styled) — scope to the dialog and click
    // that real control instead.
    const confirmDialog = page.getByRole('dialog')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await page.waitForURL(/\/tournaments$/, { timeout: 10_000 })

    // Prove the tournament was actually deleted — not just that the modal closed
    // and the URL changed. A direct navigation to its detail page must now 404
    // (app/(app)/tournaments/[id]/page.tsx calls notFound() when the row is
    // missing — the most authoritative signal available from the UI layer, since
    // it comes straight from the server's own row lookup), and it must no longer
    // appear in the tournaments listing.
    const detailResponse = await page.goto(`/tournaments/${createdTournamentId}`, { waitUntil: 'commit' })
    expect(detailResponse?.status()).toBe(404)

    await page.goto('/tournaments', { waitUntil: 'commit' })
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Playwright Test Tournament')).not.toBeVisible()
  })
})
