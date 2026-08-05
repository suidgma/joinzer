/**
 * The path facts a worktree bootstrap and teardown rest on.
 *
 * WHY THIS EXISTS. Two production incidents, both caused by asking a weaker question than the one
 * that mattered:
 *
 *   1. `existsSync` cannot tell a junction from a real directory. The "already present, left alone"
 *      branch asked only whether `metro-research` existed, so it skipped a REAL directory inside
 *      .claude/worktrees/metro-wave-1 — leaving five metros' research stranded there as the only
 *      copy, invisible to the backup and reachable by `git clean -fdx`.
 *   2. `cmd /c rmdir` returned success on 2026-08-04 while lstat still reported the junction. The
 *      teardown ordering exists so that `git worktree remove --force` never walks into the shared
 *      research repo, and a false success defeats it. The unlink therefore has to be re-checked by
 *      the same mechanism that classifies — which is `classify` — and the third test below pins the
 *      property that makes rmdirSync a safe replacement: it removes the LINK, not the target.
 *
 * Every test runs against real filesystem objects in its own mkdtemp directory (the pattern
 * geocode-cache.test.ts established) rather than mocking lstat, because the entire point is what
 * Windows actually reports for a junction. Nothing here touches the real research repo, the Joinzer
 * checkout, or the network.
 *
 * `worktree-paths.mjs` is plain ESM with no types, so tsc widens its exports to `object`. Typed
 * wrappers at the boundary keep `tsc --noEmit` green without loosening the gate.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { classify, countEntries, unresolvedConfigPaths } from '../worktree-paths.mjs'

type Classified = { kind: 'missing' | 'junction' | 'dir' | 'file'; target?: string | null }
type Unresolved = {
  configCount: number
  unresolved: Map<string, { files: string[]; note?: string }>
}

const classifyPath = classify as (p: string) => Classified
const count = countEntries as (p: string) => number | null
const scanConfigs = unresolvedConfigPaths as (a: {
  configDir: string
  root: string
  exists?: (p: string) => boolean
}) => Unresolved

const tempDirs: string[] = []
const makeTemp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-paths-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

/** A real Windows junction. mklink /J is the exact call bootstrap-worktree.mjs makes. */
const junction = (linkPath: string, target: string) =>
  execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, target], { encoding: 'utf8' })

const writeConfig = (dir: string, name: string, config: Record<string, unknown>) =>
  writeFileSync(join(dir, name), JSON.stringify(config, null, 2))

describe('classify', () => {
  it('reports a junction as a junction, not a directory — the metro-wave-1 defect', () => {
    const base = makeTemp()
    const target = join(base, 'shared')
    const linkPath = join(base, 'metro-research')
    mkdirSync(target)
    junction(linkPath, target)

    const found = classifyPath(linkPath)

    // The old check was existsSync(), which is true for BOTH of these — that is the whole bug.
    expect(found.kind).toBe('junction')
    expect(found.target).toBe(resolve(target))
    expect(classifyPath(target).kind).toBe('dir')
  })

  it('distinguishes a real directory from a junction, so a stranded copy can be caught', () => {
    const base = makeTemp()
    const real = join(base, 'metro-research')
    mkdirSync(real)
    mkdirSync(join(real, 'toledo'))

    // This is exactly what metro-wave-1 looked like: present, populated, and NOT shared.
    expect(classifyPath(real).kind).toBe('dir')
  })

  it('reads a junction target so a WRONG target is distinguishable from a right one', () => {
    const base = makeTemp()
    const right = join(base, 'joinzer-metro-research')
    const wrong = join(base, 'some-other-repo')
    mkdirSync(right)
    mkdirSync(wrong)
    junction(join(base, 'link-right'), right)
    junction(join(base, 'link-wrong'), wrong)

    expect(classifyPath(join(base, 'link-right')).target).toBe(resolve(right))
    expect(classifyPath(join(base, 'link-wrong')).target).toBe(resolve(wrong))
    expect(classifyPath(join(base, 'link-wrong')).target).not.toBe(resolve(right))
  })

  it('reports missing and file without throwing', () => {
    const base = makeTemp()
    writeFileSync(join(base, 'a-file'), 'x')

    expect(classifyPath(join(base, 'nope')).kind).toBe('missing')
    expect(classifyPath(join(base, 'a-file')).kind).toBe('file')
  })
})

describe('teardown safety properties', () => {
  it('rmdirSync removes the LINK and leaves the target contents intact', () => {
    const base = makeTemp()
    const target = join(base, 'shared')
    const linkPath = join(base, 'metro-research')
    mkdirSync(target)
    for (const name of ['toledo', 'tucson', 'wichita']) mkdirSync(join(target, name))
    junction(linkPath, target)

    expect(count(target)).toBe(3)

    // This is the property that makes rmdirSync a safe replacement for `cmd /c rmdir`. If it
    // recursed into the junction, teardown would destroy the shared research repo.
    rmdirSync(linkPath)

    expect(classifyPath(linkPath).kind).toBe('missing')
    expect(count(target)).toBe(3)
  })

  it('classify is the check that proves an unlink happened — a survivor stays visible', () => {
    const base = makeTemp()
    const target = join(base, 'shared')
    const linkPath = join(base, 'metro-research')
    mkdirSync(target)
    junction(linkPath, target)

    // Model the 2026-08-04 observation: the unlink "succeeded" but nothing was removed. Teardown
    // aborts on precisely this, because a surviving junction plus `git worktree remove --force`
    // is the shared-repo loss it exists to prevent.
    expect(classifyPath(linkPath).kind).toBe('junction')

    rmdirSync(linkPath)
    expect(classifyPath(linkPath).kind).toBe('missing')
  })

  it('countEntries returns null rather than throwing on an unreadable path', () => {
    expect(count(join(makeTemp(), 'does-not-exist'))).toBeNull()
  })
})

describe('unresolvedConfigPaths', () => {
  it('flags a config whose input is a gitignored directory the worktree does not carry', () => {
    const base = makeTemp()
    const configDir = join(base, 'metros')
    mkdirSync(configDir)
    mkdirSync(join(base, 'metro-research'))
    mkdirSync(join(base, 'metro-research', '.geocode-cache'))

    // The real shape: 2 configs resolve through metro-research, little-rock points at a gitignored
    // directory INSIDE the repo, which a worktree carries only tracked files of.
    writeConfig(configDir, 'toledo.json', {
      input: 'metro-research/toledo/toledo-candidates.json',
      geocode_cache: 'metro-research/.geocode-cache/nominatim.json',
    })
    writeConfig(configDir, 'little-rock.json', {
      input: 'little-rock-count/little-rock-candidates.json',
      geocode_cache: 'metro-research/.geocode-cache/nominatim.json',
    })
    mkdirSync(join(base, 'metro-research', 'toledo'), { recursive: true })
    writeFileSync(join(base, 'metro-research', 'toledo', 'toledo-candidates.json'), '{}')

    const { configCount, unresolved } = scanConfigs({ configDir, root: base })

    expect(configCount).toBe(2)
    expect([...unresolved.keys()]).toEqual(['little-rock-count/little-rock-candidates.json'])
    expect(unresolved.get('little-rock-count/little-rock-candidates.json')!.files).toEqual(['little-rock.json'])
  })

  it('reports a shared missing directory ONCE, listing every config that named it', () => {
    const base = makeTemp()
    const configDir = join(base, 'metros')
    mkdirSync(configDir)

    // metro-research is absent entirely — the broken-junction case. Without grouping this would
    // print one line per config and bury the single actual problem.
    for (const metro of ['akron', 'boise', 'tucson']) {
      writeConfig(configDir, `${metro}.json`, {
        input: `metro-research/${metro}/${metro}-candidates.json`,
        geocode_cache: 'metro-research/.geocode-cache/nominatim.json',
      })
    }

    const { unresolved } = scanConfigs({ configDir, root: base })

    expect(unresolved.get('metro-research/.geocode-cache')!.files).toEqual([
      'akron.json',
      'boise.json',
      'tucson.json',
    ])
    expect(unresolved.size).toBe(4) // three distinct inputs + the one shared cache directory
  })

  it('checks the DIRECTORY of geocode_cache, not the file — the flush creates the file, not the dir', () => {
    const base = makeTemp()
    const configDir = join(base, 'metros')
    mkdirSync(configDir)
    mkdirSync(join(base, 'metro-research', '.geocode-cache'), { recursive: true })
    mkdirSync(join(base, 'metro-research', 'akron'), { recursive: true })
    writeFileSync(join(base, 'metro-research', 'akron', 'akron-candidates.json'), '{}')

    writeConfig(configDir, 'akron.json', {
      input: 'metro-research/akron/akron-candidates.json',
      // This file does not exist and must NOT be reported — only its directory has to.
      geocode_cache: 'metro-research/.geocode-cache/nominatim.json',
    })

    expect(scanConfigs({ configDir, root: base }).unresolved.size).toBe(0)
  })

  it('records an unparseable config instead of throwing the whole bootstrap', () => {
    const base = makeTemp()
    const configDir = join(base, 'metros')
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'broken.json'), '{ not json')

    const { unresolved } = scanConfigs({ configDir, root: base })

    expect([...unresolved.keys()]).toEqual(['broken.json (unparseable)'])
    expect(unresolved.get('broken.json (unparseable)')!.note).toBeTruthy()
  })

  it('returns an empty result for a missing config directory rather than throwing', () => {
    const { configCount, unresolved } = scanConfigs({ configDir: join(makeTemp(), 'nope'), root: '/' })

    expect(configCount).toBe(0)
    expect(unresolved.size).toBe(0)
  })
})
