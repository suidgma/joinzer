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
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

  it('falls back to the default directory when a config omits geocode_cache (little-rock does)', () => {
    expect(cachePathFor('little-rock', undefined)).toBe(join('.geocode-cache', 'little-rock.json'))
    expect(cachePathFor('little-rock', '')).toBe(join('.geocode-cache', 'little-rock.json'))
  })

  it('gives two metros two different files — the whole point of the split', () => {
    const conf = 'metro-research/.geocode-cache/nominatim.json'
    expect(cachePathFor('albany', conf)).not.toBe(cachePathFor('bakersfield', conf))
  })

  it('refuses a key that would escape the cache directory or collide blankly', () => {
    for (const bad of ['', '   ', '../evil', 'a/b', 'a\\b', '.hidden', null, undefined]) {
      expect(() => cachePathFor(bad, 'x/nominatim.json')).toThrow(/refusing to derive a cache path/)
    }
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
    writeFileSync(legacy, JSON.stringify({ [key]: parkHit('Kanis Park', 34.7465, -92.3423) }, null, 1))
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
