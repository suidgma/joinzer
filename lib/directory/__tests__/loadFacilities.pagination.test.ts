/**
 * Pagination tests for the site-wide directory loaders.
 *
 * WHAT THESE EXIST TO CATCH. On 2026-08-05 the directory crossed 1000 published rows and every
 * site-wide read silently truncated at PostgREST's server-side cap: /sitemap.xml served exactly
 * 1000 facility URLs against 1084 published, and loadPublishedMetros aggregated over that truncated
 * window, so Boise and El Paso disappeared from the metro list and their pages hard-404'd. No error
 * was raised anywhere — the cap returns a short result and says nothing.
 *
 * A test that mocks a 1001-row response and asserts 1001 rows come back would have passed against
 * the BROKEN code, because the break was never in the shape of the data. It was in the number of
 * REQUESTS: the old loaders issued exactly one. So these tests assert on the requests themselves —
 * the `.range()` windows actually asked for — and the boundary case that hid the bug is the one
 * where the row count is exactly one full page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
type Served = { data: unknown; error: { message: string } | null }

/** PostgREST's cap, restated locally: the mock factory is hoisted above the module import below,
 *  so it cannot reference the imported POSTGREST_PAGE_SIZE. Asserted equal to it in the specs. */
const PAGE = 1000

/** Every [from, to] window the loader asked for, in order. The real assertion surface. */
let rangeCalls: [number, number][] = []
/** What the fake PostgREST serves for a given window. */
let serve: (from: number, to: number) => Served

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'not', 'is', 'order']) {
        builder[method] = () => builder
      }
      builder.range = (from: number, to: number) => {
        rangeCalls.push([from, to])
        return Promise.resolve(serve(from, to))
      }
      // Awaiting the builder WITHOUT .range() is the unbounded read, and PostgREST answers it by
      // silently capping at one page. Emulating the cap rather than returning everything is what
      // makes these tests a real negative control: against the pre-fix loaders they fail with a
      // truncated result, which is the actual production bug, not a mock-shape artifact.
      builder.then = (resolve: (v: Served) => unknown) =>
        Promise.resolve(serve(0, PAGE - 1)).then(resolve)
      return builder
    },
  }),
}))

// unstable_cache would memoize across tests and hide the request count. Pass through.
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const { loadPublishedSlugs, loadPublishedMetros, POSTGREST_PAGE_SIZE } = await import('../loadFacilities')

/** Serves `rows` the way PostgREST does: the requested window, clamped, never more than a page. */
function servePage(rows: Row[]) {
  return (from: number, to: number): Served => ({ data: rows.slice(from, to + 1), error: null })
}

const slugRows = (n: number, prefix = 'court') =>
  Array.from({ length: n }, (_, i) => ({ slug: `${prefix}-${String(i).padStart(5, '0')}`, updated_at: null }))

beforeEach(() => {
  rangeCalls = []
  serve = servePage([])
})

describe('fetchAllRows pagination', () => {
  it('agrees with the mock about where the cap sits', () => {
    expect(POSTGREST_PAGE_SIZE).toBe(PAGE)
  })

  it('issues a SECOND request when the first page comes back full — the 1084-row production case', async () => {
    serve = servePage(slugRows(1084))

    const rows = await loadPublishedSlugs()

    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]])
    expect(rows).toHaveLength(1084)
    // The row that the truncation dropped. Present here, absent under the old single-request read.
    expect(rows[1083].slug).toBe('court-01083')
  })

  it('still issues a second request when the total is EXACTLY one full page', async () => {
    // The boundary that hid the bug: a full page is indistinguishable from a truncated one, so the
    // only safe reading of "I got exactly a page" is "there may be more". Stopping here is the bug.
    serve = servePage(slugRows(POSTGREST_PAGE_SIZE))

    const rows = await loadPublishedSlugs()

    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]])
    expect(rows).toHaveLength(POSTGREST_PAGE_SIZE)
  })

  it('issues exactly ONE request when the first page comes back short', async () => {
    serve = servePage(slugRows(5))

    const rows = await loadPublishedSlugs()

    expect(rangeCalls).toEqual([[0, 999]])
    expect(rows).toHaveLength(5)
  })

  it('surfaces a metro whose rows lie entirely beyond the first page — the Boise/El Paso regression', async () => {
    // Reproduces the exact production failure: a metro's rows sit past row 1000, so a single-request
    // read aggregates a window that does not contain them and the metro ceases to exist.
    const rows: Row[] = [
      ...Array.from({ length: POSTGREST_PAGE_SIZE }, () => ({ metro_area: 'Phoenix', state: 'AZ' })),
      ...Array.from({ length: 11 }, () => ({ metro_area: 'Boise', state: 'ID' })),
    ]
    serve = servePage(rows)

    const metros = await loadPublishedMetros()

    const boise = metros.find((m) => m.metro_area === 'Boise')
    expect(boise).toBeDefined()
    expect(boise?.count).toBe(11)
    expect(boise?.slug).toBe('boise')
    expect(metros).toHaveLength(2)
  })
})

describe('fetchAllRows failure posture', () => {
  it('THROWS on a database error instead of returning an empty directory', async () => {
    // The old loaders destructured `{ data }` and dropped `error`, so a failed read rendered an
    // empty directory and an empty sitemap with no signal anywhere.
    serve = () => ({ data: null, error: { message: 'connection reset' } })

    await expect(loadPublishedSlugs()).rejects.toThrow(/loadPublishedSlugs.*connection reset/)
  })

  it('THROWS rather than returning the partial rows it already collected', async () => {
    const full = slugRows(POSTGREST_PAGE_SIZE)
    serve = (from) =>
      from === 0
        ? { data: full, error: null }
        : { data: null, error: { message: 'timeout on page 2' } }

    await expect(loadPublishedSlugs()).rejects.toThrow(/timeout on page 2/)
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]])
  })

  it('THROWS on a runaway cursor instead of looping forever', async () => {
    // Every page comes back full, so the termination rule never fires.
    const full = slugRows(POSTGREST_PAGE_SIZE)
    serve = () => ({ data: full, error: null })

    await expect(loadPublishedSlugs()).rejects.toThrow(/exceeded 50 pages/)
    expect(rangeCalls).toHaveLength(50)
  })
})
