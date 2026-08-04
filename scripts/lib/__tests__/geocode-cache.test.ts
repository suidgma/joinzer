/**
 * Per-metro geocode cache, and the read-only migration off the shared file.
 *
 * WHY THIS EXISTS: `.geocode-cache/nominatim.json` was ONE file shared by every metro, so two
 * concurrent extracts were a lost-update race — last writer wins and silently discards the other's
 * entries. By 2026-08-04 that had already happened: three divergent legacy files existed on disk
 * (551 + 316 + 146 entries, pairwise overlap ZERO), because sessions were splitting the file by hand.
 *
 * The migration is a READ-ONLY SEED rather than a copy: legacy files are consulted on a miss and a
 * hit is promoted into the metro's own cache. Nothing moves, so nothing can be lost. The assertion
 * that makes that a machine check rather than a claim is `md5 of every legacy file is unchanged`.
 *
 * No network is touched: every query these tests issue is pre-seeded, so `geocodeVenue` resolves
 * entirely from disk. A venue with a name but NO address emits exactly one query rung
 * (`name+city`) and cannot fire the township rung, which is what keeps the fixture to one key.
 *
 * `geocode-nominatim.mjs` is plain ESM with no types, so tsc widens its exports to `object`. Typed
 * wrappers at the boundary keep `tsc --noEmit` green without loosening the gate.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cacheStats, flushCache, geocodeCachePath, geocodeVenue, legacyCachePaths, liveRequestCount } from '../geocode-nominatim.mjs'

type Row = Record<string, any>

const cachePathFor = geocodeCachePath as (metro: unknown, configured?: string) => string
const legacyPaths = legacyCachePaths as (dir: string, active?: string | null) => string[]
const geocode = geocodeVenue as (venue: Row, opts: Row) => Promise<Row | null>
const stats = cacheStats as () => Row
const flush = flushCache as () => void
const liveRequests = liveRequestCount as () => number

const roots: string[] = []
const newCacheDir = () => {
  const root = mkdtempSync(join(tmpdir(), 'joinzer-geocode-'))
  roots.push(root)
  const dir = join(root, '.geocode-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const md5 = (path: string) => createHash('md5').update(readFileSync(path)).digest('hex')
const readJson = (path: string): Row => JSON.parse(readFileSync(path, 'utf8'))

/** A Nominatim hit shaped like the real thing: a named `leisure/park` that classifies `high`. */
const parkHit = (name: string, lat: number, lon: number) => ([{
  lat: String(lat), lon: String(lon), class: 'leisure', type: 'park',
  osm_type: 'way', osm_id: 42, name, namedetails: { name }, address: {},
}])

/** A venue with a name but no address emits exactly ONE rung: `{"q":"<name>, <city>, <state>"}`. */
const venue = (name: string, city: string, state: string) => ({ name, address: null, city, state, zip: null })
const soleQueryKey = (name: string, city: string, state: string) =>
  JSON.stringify({ q: [name, city, state].filter(Boolean).join(', ') })

describe('geocodeCachePath', () => {
  it('puts each metro in its own file inside the configured cache directory', () => {
    expect(cachePathFor('toledo', 'metro-research/.geocode-cache/nominatim.json'))
      .toBe(join('metro-research/.geocode-cache', 'toledo.json'))
    expect(cachePathFor('port-st-lucie', 'metro-research/.geocode-cache/nominatim.json'))
      .toBe(join('metro-research/.geocode-cache', 'port-st-lucie.json'))
  })

  /**
   * The fallback used to resolve to `.geocode-cache/` in the REPO ROOT, which is untracked and was
   * NOT gitignored — so a plain `git clean -fd` reached it, not merely `-fdx`. It now resolves inside
   * `metro-research/`, a junction to a repo outside every working tree. `little-rock.json` declares
   * the field as of 2026-08-04, so nothing reaches this path today; it stays safe for whatever does.
   */
  it('falls back to a directory a git clean cannot reach when a config omits geocode_cache', () => {
    const safe = join('metro-research/.geocode-cache', 'little-rock.json')
    expect(cachePathFor('little-rock', undefined)).toBe(safe)
    expect(cachePathFor('little-rock', '')).toBe(safe)
    // The guard that matters, stated as a property rather than as a literal: the fallback is never
    // the repo root. A future edit to DEFAULT_CACHE that moved it back would fail here.
    expect(cachePathFor('anything', undefined).startsWith('.geocode-cache')).toBe(false)
  })

  /**
   * The fallback is safe, but a config that states where its cache lives is better than one that
   * implies it — and the per-metro split is what made a silent fallback permanent rather than
   * incidental, because every config copied from an omitting one inherits the omission.
   */
  it('every metro config in the repo declares geocode_cache', () => {
    const dir = join(process.cwd(), 'scripts', 'metros')
    const missing = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .filter((f) => !JSON.parse(readFileSync(join(dir, f), 'utf8')).geocode_cache)
    expect(missing).toEqual([])
  })

  it('gives two metros two different files — the whole point of the split', () => {
    const conf = 'metro-research/.geocode-cache/nominatim.json'
    expect(cachePathFor('albany', conf)).not.toBe(cachePathFor('bakersfield', conf))
  })

  it('refuses a key that would escape the cache directory or collide blankly', () => {
    for (const bad of ['', '   ', '../evil', 'a/b', 'a\\b', '.hidden', 'a..b', null, undefined]) {
      expect(() => cachePathFor(bad, 'x/nominatim.json')).toThrow(/refusing to derive a cache path/)
    }
  })

  /**
   * REGRESSION. The first guard required an ALPHANUMERIC first character, which killed
   * `--metro=_vt_pme` at CLI start — and `scripts/metros/_vt_pme.json` is a real config in the repo.
   * A leading underscore is legal; a leading DOT still is not, so traversal stays blocked.
   */
  it('accepts a leading underscore, which real config keys use', () => {
    expect(cachePathFor('_vt_pme', 'x/nominatim.json')).toBe(join('x', '_vt_pme.json'))
    expect(() => cachePathFor('.hidden', 'x/nominatim.json')).toThrow()
    expect(() => cachePathFor('..', 'x/nominatim.json')).toThrow()
  })

  it('derives a path for every real metro config key in the repo', () => {
    const keys = readdirSync(join(process.cwd(), 'scripts', 'metros'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
    expect(keys.length).toBeGreaterThan(30)
    for (const key of keys) {
      expect(cachePathFor(key, 'metro-research/.geocode-cache/nominatim.json'))
        .toBe(join('metro-research/.geocode-cache', `${key}.json`))
    }
    // Every metro gets a DISTINCT file — the property the whole split rests on.
    expect(new Set(keys.map((k) => cachePathFor(k, 'x/nominatim.json'))).size).toBe(keys.length)
  })
})

describe('legacyCachePaths', () => {
  it('finds every legacy shared cache and excludes the metro file currently in use', () => {
    const dir = newCacheDir()
    for (const n of ['nominatim.json', 'nominatim-wave1.json', 'nominatim-batch3.json', 'toledo.json']) {
      writeFileSync(join(dir, n), '{}')
    }
    const found = legacyPaths(dir, join(dir, 'toledo.json'))
    expect(found.map((p) => p.split(/[\\/]/).pop())).toEqual([
      'nominatim-batch3.json', 'nominatim-wave1.json', 'nominatim.json',
    ])
  })

  it('never treats a metro cache as a seed, and ignores the unrelated county-bbox cache', () => {
    const dir = newCacheDir()
    for (const n of ['nominatim.json', 'county-bbox-batch3.json', 'albany.json', 'buffalo.json']) {
      writeFileSync(join(dir, n), '{}')
    }
    expect(legacyPaths(dir, join(dir, 'albany.json')).map((p) => p.split(/[\\/]/).pop())).toEqual(['nominatim.json'])
  })

  it('excludes the active file even when the active file IS a legacy-shaped name', () => {
    const dir = newCacheDir()
    writeFileSync(join(dir, 'nominatim.json'), '{}')
    expect(legacyPaths(dir, join(dir, 'nominatim.json'))).toEqual([])
  })

  it('returns nothing rather than throwing when the directory does not exist', () => {
    expect(legacyPaths(join(tmpdir(), 'joinzer-geocode-does-not-exist'), null)).toEqual([])
  })
})

describe('the read-only seed migration', () => {
  let dir: string
  let liveAtStart: number

  beforeEach(() => {
    dir = newCacheDir()
    liveAtStart = liveRequests()
  })

  /**
   * Every query in this block is pre-seeded, so a seed miss would fall through to a REAL Nominatim
   * request. Asserting the live-request counter never moves is what makes "served from the seed" a
   * measurement rather than an inference from the tests being fast.
   */
  afterEach(() => {
    expect(liveRequests()).toBe(liveAtStart)
  })

  it('serves a hit from the legacy shared cache, PROMOTES it, and leaves the legacy file byte-identical', async () => {
    const key = soleQueryKey('Kanis Park', 'Little Rock', 'AR')
    const legacy = join(dir, 'nominatim.json')
    // Indent 4, NOT the indent 1 that `flushCache` emits. With a matching indent a rewrite of
    // identical data produces an identical md5, so the assertion below would pass under the very
    // bug it exists to catch. The differing indent makes it a real discriminator.
    writeFileSync(legacy, JSON.stringify({ [key]: parkHit('Kanis Park', 34.7465, -92.3423) }, null, 4))
    const before = md5(legacy)

    const target = cachePathFor('toledo', legacy)
    const hit = await geocode(venue('Kanis Park', 'Little Rock', 'AR'), { cachePath: target })
    flush()

    // Served from the seed — no network, and the coordinate came through intact.
    expect(hit).not.toBeNull()
    expect(hit!.lat).toBeCloseTo(34.7465, 4)
    expect(hit!.origin).toBe('nominatim')

    // Promoted into the metro's own file...
    expect(existsSync(target)).toBe(true)
    expect(Object.keys(readJson(target))).toEqual([key])

    // ...and the legacy file was never opened for writing. THIS is the migration's safety property.
    expect(md5(legacy)).toBe(before)
  })

  it('reads ALL legacy files, not just the first — the recovered wave1/batch3 entries must not be orphaned', async () => {
    const shared = join(dir, 'nominatim.json')
    const wave1 = join(dir, 'nominatim-wave1.json')
    const batch3 = join(dir, 'nominatim-batch3.json')
    const kShared = soleQueryKey('Shared Park', 'Lakeland', 'FL')
    const kWave1 = soleQueryKey('Wave One Park', 'Bakersfield', 'CA')
    const kBatch3 = soleQueryKey('Batch Three Park', 'Orchard Park', 'NY')
    writeFileSync(shared, JSON.stringify({ [kShared]: parkHit('Shared Park', 28.0, -81.9) }))
    writeFileSync(wave1, JSON.stringify({ [kWave1]: parkHit('Wave One Park', 35.3, -119.0) }))
    writeFileSync(batch3, JSON.stringify({ [kBatch3]: parkHit('Batch Three Park', 42.7, -78.7) }))
    const before = { shared: md5(shared), wave1: md5(wave1), batch3: md5(batch3) }

    const target = cachePathFor('mixed', shared)
    expect(await geocode(venue('Shared Park', 'Lakeland', 'FL'), { cachePath: target })).not.toBeNull()
    expect(await geocode(venue('Wave One Park', 'Bakersfield', 'CA'), { cachePath: target })).not.toBeNull()
    expect(await geocode(venue('Batch Three Park', 'Orchard Park', 'NY'), { cachePath: target })).not.toBeNull()
    flush()

    expect(Object.keys(readJson(target)).sort()).toEqual([kShared, kWave1, kBatch3].sort())
    expect(md5(shared)).toBe(before.shared)
    expect(md5(wave1)).toBe(before.wave1)
    expect(md5(batch3)).toBe(before.batch3)
  })

  it('counts a seed hit as cached, so a seeded re-run still reports zero live requests', async () => {
    const key = soleQueryKey('Stat Park', 'Toledo', 'OH')
    writeFileSync(join(dir, 'nominatim.json'), JSON.stringify({ [key]: parkHit('Stat Park', 41.6, -83.5) }))

    const target = cachePathFor('toledo', join(dir, 'nominatim.json'))
    await geocode(venue('Stat Park', 'Toledo', 'OH'), { cachePath: target })

    const s = stats()
    expect(s.path).toBe(target)
    expect(s.seeds).toBe(1)
    expect(s.seed_entries).toBe(1)
    expect(s.entries).toBe(1) // promoted
  })

  /**
   * A legacy file may be MID-WRITE by another session (writeFileSync is not atomic). A truncated
   * read must degrade to a cache miss, never kill the run — and the other, intact seed must still
   * be read.
   */
  it('skips an unparseable seed instead of throwing, and still reads the intact one', async () => {
    const key = soleQueryKey('Intact Park', 'Akron', 'OH')
    writeFileSync(join(dir, 'nominatim.json'), '{"half-written": ')
    writeFileSync(join(dir, 'nominatim-wave1.json'), JSON.stringify({ [key]: parkHit('Intact Park', 41.0, -81.5) }))

    const target = cachePathFor('akron', join(dir, 'nominatim.json'))
    expect(await geocode(venue('Intact Park', 'Akron', 'OH'), { cachePath: target })).not.toBeNull()
    expect(stats().seed_entries).toBe(1)
  })
})

/**
 * DURABILITY — what a run keeps when it dies partway.
 *
 * The three geocode passes in workbook-extract.mjs flush OUTSIDE their loops, so before this slice a
 * throw at venue 24 of 26 discarded all 24 venues' results, each of which may have spent several live
 * requests at >=1.1 s apiece. The fix lives in geocode-nominatim.mjs rather than at the three call
 * sites, so these tests exercise the property directly and it holds for all three passes at once.
 *
 * These are the only tests in this file that issue a "live" request. They inject `fetchImpl`, so no
 * packet leaves the machine — but they DO pay the real >=1.1 s endpoint spacing, because that limit
 * is deliberately not injectable. Hence the explicit timeouts.
 */
describe('cache durability across a failed run', () => {
  /** A Response-alike carrying Nominatim's array body. */
  const okResponse = (hits: Row[]) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => hits,
    text: async () => JSON.stringify(hits),
  })

  const failResponse = () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => '',
  })

  it('puts a live result on disk immediately, with no explicit flush', async () => {
    const dir = newCacheDir()
    const target = cachePathFor('toledo', join(dir, 'nominatim.json'))
    const key = soleQueryKey('Auto Flush Park', 'Toledo', 'OH')

    const hit = await geocode(venue('Auto Flush Park', 'Toledo', 'OH'), {
      cachePath: target,
      fetchImpl: async () => okResponse(parkHit('Auto Flush Park', 41.6, -83.5)),
    })

    expect(hit).not.toBeNull()
    // NOTE: no flush() call. That is the whole assertion.
    expect(existsSync(target)).toBe(true)
    expect(Object.keys(readJson(target))).toEqual([key])
  }, 20_000)

  /**
   * THE REGRESSION THIS SLICE EXISTS FOR. Two venues succeed, the third throws. Before the fix the
   * caller's flush sat past the end of the loop, so the throw discarded both earlier results.
   */
  it('keeps everything bought before a mid-run throw', async () => {
    const dir = newCacheDir()
    const target = cachePathFor('akron', join(dir, 'nominatim.json'))
    const bought = [
      soleQueryKey('First Park', 'Akron', 'OH'),
      soleQueryKey('Second Park', 'Akron', 'OH'),
    ]

    const fetchImpl = async (url: any) => (
      String(url).includes('Third') ? failResponse() : okResponse(parkHit('Park', 41.0, -81.5))
    )

    expect(await geocode(venue('First Park', 'Akron', 'OH'), { cachePath: target, fetchImpl })).not.toBeNull()
    expect(await geocode(venue('Second Park', 'Akron', 'OH'), { cachePath: target, fetchImpl })).not.toBeNull()

    // A 500 is terminal by design — it is not laundered into a retry — so this is a real mid-run throw.
    await expect(geocode(venue('Third Park', 'Akron', 'OH'), { cachePath: target, fetchImpl }))
      .rejects.toThrow(/nominatim HTTP 500/)

    // The run died without ever reaching a flush, and both paid-for results survived it.
    expect(Object.keys(readJson(target)).sort()).toEqual(bought.sort())
  }, 20_000)

  /**
   * The deliberate exclusion, pinned so nobody "fixes" it into a flush. A promotion costs nothing to
   * redo because its seed is still on disk, so auto-flushing one would make a fully-seeded re-run —
   * which spends ZERO live requests — pay for hundreds of writes it gains nothing from.
   */
  it('does NOT auto-flush a seed promotion, but an explicit flush still persists it', async () => {
    const dir = newCacheDir()
    const key = soleQueryKey('Seeded Park', 'Albany', 'NY')
    const legacy = join(dir, 'nominatim.json')
    writeFileSync(legacy, JSON.stringify({ [key]: parkHit('Seeded Park', 42.6, -73.7) }))

    const target = cachePathFor('albany', legacy)
    expect(await geocode(venue('Seeded Park', 'Albany', 'NY'), { cachePath: target })).not.toBeNull()
    expect(existsSync(target)).toBe(false)

    flush()
    expect(Object.keys(readJson(target))).toEqual([key])
  })

  it('leaves no temp file behind — the write is a rename, not a truncate-in-place', async () => {
    const dir = newCacheDir()
    const target = cachePathFor('boise', join(dir, 'nominatim.json'))
    await geocode(venue('Temp File Park', 'Boise', 'ID'), {
      cachePath: target,
      fetchImpl: async () => okResponse(parkHit('Temp File Park', 43.6, -116.2)),
    })
    flush()
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  }, 20_000)

  it('reports a failed write and returns false instead of throwing', async () => {
    const dir = newCacheDir()
    // A FILE where the cache directory should be, so mkdir fails. The run must survive it — a write
    // failure must never abort a run that has otherwise succeeded.
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not a directory')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const hit = await geocode(venue('Blocked Park', 'Provo', 'UT'), {
        cachePath: join(blocked, 'provo.json'),
        fetchImpl: async () => okResponse(parkHit('Blocked Park', 40.2, -111.6)),
      })
      // The auto-flush already failed at this point, and the geocode still returned its answer.
      expect(hit).not.toBeNull()
      expect(flush()).toBe(false)
      expect(log.mock.calls.flat().join('\n')).toMatch(/ACTION REQUIRED — the geocode cache could NOT be written/)
    } finally {
      log.mockRestore()
    }
  }, 20_000)

  /**
   * `mkdirSync(recursive: true)` would materialize a real `metro-research/` inside the working tree
   * when the junction is missing — research data at a gitignored path a `git clean -fdx` can reach,
   * which is the exact shape of the 2026-08-03 loss. Refusing is visible and costs only a re-run.
   */
  it('refuses to create a cache directory whose parent does not exist', async () => {
    const dir = newCacheDir()
    const absent = join(dir, 'metro-research')
    const target = join(absent, '.geocode-cache', 'toledo.json')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const hit = await geocode(venue('Unlinked Park', 'Toledo', 'OH'), {
        cachePath: target,
        fetchImpl: async () => okResponse(parkHit('Unlinked Park', 41.6, -83.5)),
      })
      expect(hit).not.toBeNull()
      expect(flush()).toBe(false)
      // Nothing was materialized inside the working tree — not the junction point, not the cache dir.
      expect(existsSync(absent)).toBe(false)
      expect(log.mock.calls.flat().join('\n')).toMatch(/mklink \/J metro-research/)
    } finally {
      log.mockRestore()
    }
  }, 20_000)
})

describe('switching cache paths inside one process', () => {
  /**
   * REGRESSION for the latent bug the split would have made live. `loadCache` used to repoint
   * `cachePath` while keeping the already-loaded `cache`, so a second metro in the same process
   * would have flushed the FIRST metro's entries into the SECOND metro's file. Inert while every
   * caller passed one path; a real bug the moment they differ — which is exactly what this slice does.
   */
  it('does not leak one metro\'s entries into another metro\'s file', async () => {
    const dir = newCacheDir()
    const legacy = join(dir, 'nominatim.json')
    const kA = soleQueryKey('Alpha Park', 'Albany', 'NY')
    const kB = soleQueryKey('Beta Park', 'Bakersfield', 'CA')
    writeFileSync(legacy, JSON.stringify({
      [kA]: parkHit('Alpha Park', 42.6, -73.7),
      [kB]: parkHit('Beta Park', 35.3, -119.0),
    }))

    const before = md5(legacy)
    const albany = cachePathFor('albany', legacy)
    const bakersfield = cachePathFor('bakersfield', legacy)

    await geocode(venue('Alpha Park', 'Albany', 'NY'), { cachePath: albany })
    // No explicit flush — switching paths must flush the outgoing cache itself, or entries are lost.
    await geocode(venue('Beta Park', 'Bakersfield', 'CA'), { cachePath: bakersfield })
    flush()

    expect(Object.keys(readJson(albany))).toEqual([kA])
    expect(Object.keys(readJson(bakersfield))).toEqual([kB])
    expect(md5(legacy)).toBe(before) // untouched by either metro
  })
})
