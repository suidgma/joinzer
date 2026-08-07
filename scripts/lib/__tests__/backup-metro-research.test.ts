/**
 * The metro-research backup: what it stages, and — far more importantly — what it refuses to.
 *
 * WHY THIS EXISTS. The previous version ran `git add -A` against the shared research repo and pushed,
 * at the end of every extract. That is not a theoretical hazard; it already fired. Research-repo
 * commit cb79409, "Research artifacts: grand-rapids extract", contains FOUR files:
 *
 *     grand-rapids/_shapecheck.json
 *     grand-rapids/grand-rapids-candidates.json
 *     grand-rapids/tabs.json
 *     hartford/hartford-candidates.json        <-- another metro, 7 lines, another session's work
 *
 * The hartford change had nothing to do with a grand-rapids extract. `-A` swept it in, the commit
 * message denied it existed, and it was pushed. The first test below replays that exact shape.
 *
 * Two properties carry the whole design, and both are proven here against a real git repo in a temp
 * directory (the pattern geocode-cache.test.ts established) rather than asserted:
 *   1. a pathspec commit does not sweep a co-staged file — the cb79409 fix;
 *   2. `--ignore-removal` cannot record a deletion — a backup that commits a loss inverts itself.
 *
 * NOTHING HERE TOUCHES THE REAL RESEARCH REPO. Every git test runs in its own mkdtemp repo with no
 * remote, and no test issues a network request.
 *
 * `backup-metro-research.mjs` is plain ESM with no types, so tsc widens its exports to `object`.
 * Typed wrappers at the boundary keep `tsc --noEmit` green without loosening the gate.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseStatusZ,
  researchRepoBlocker,
  selectBackupPaths,
  toRepoPathspec,
} from '../backup-metro-research.mjs'

type StatusEntry = { x: string; y: string; path: string; origPath: string | null }
type Selection = {
  stage: string[]
  skipped: { path: string; reason: string }[]
  unexpected: { path: string; status: string }[]
}

const parse = parseStatusZ as (raw: string) => StatusEntry[]
const select = selectBackupPaths as (a: { statusEntries?: StatusEntry[]; candidates?: string[] }) => Selection
const pathspec = toRepoPathspec as (p: unknown, repo?: string) => string | null
const blocker = researchRepoBlocker as (a?: {
  repo?: string
  exists?: (p: string) => boolean
  stat?: (p: string) => { isFile: () => boolean }
}) => string | null

/** Builds a `git status --porcelain -z -uall` payload from `XY path` pairs. */
const statusZ = (...entries: string[]) => entries.map((e) => `${e}\0`).join('')

const tempRepos: string[] = []
afterEach(() => {
  while (tempRepos.length) rmSync(tempRepos.pop()!, { recursive: true, force: true })
})

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'backup-test-'))
  tempRepos.push(dir)
  // stderr is piped, not inherited: git's CRLF and ignored-path advice would otherwise spray the
  // suite output, and one test deliberately provokes the ignored-path error.
  const g = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'Test')
  return { dir, g }
}

describe('selectBackupPaths — what gets staged', () => {
  it('stages a new metro\'s own artifacts', () => {
    const result = select({
      statusEntries: parse(statusZ('?? toledo/tabs.json', '?? toledo/toledo-candidates.json')),
      candidates: ['toledo/tabs.json', 'toledo/toledo-candidates.json'],
    })
    expect(result.stage).toEqual(['toledo/tabs.json', 'toledo/toledo-candidates.json'])
    expect(result.unexpected).toEqual([])
  })

  // THE cb79409 REGRESSION, in the exact shape the real commit has.
  it('does not stage another metro\'s in-flight work (research repo cb79409)', () => {
    const result = select({
      statusEntries: parse(
        statusZ(
          '?? grand-rapids/_shapecheck.json',
          '?? grand-rapids/grand-rapids-candidates.json',
          '?? grand-rapids/tabs.json',
          ' M hartford/hartford-candidates.json'
        )
      ),
      candidates: [
        'grand-rapids/tabs.json',
        'grand-rapids/grand-rapids-candidates.json',
        'grand-rapids/_shapecheck.json',
      ],
    })
    expect(result.stage.sort()).toEqual([
      'grand-rapids/_shapecheck.json',
      'grand-rapids/grand-rapids-candidates.json',
      'grand-rapids/tabs.json',
    ])
    expect(result.stage).not.toContain('hartford/hartford-candidates.json')
    expect(result.unexpected).toEqual([{ path: 'hartford/hartford-candidates.json', status: ' M' }])
  })

  it('never stages a deletion, even when the path was ours', () => {
    const result = select({
      statusEntries: parse(statusZ(' D toledo/tabs.json', ' M toledo/toledo-candidates.json')),
      candidates: ['toledo/tabs.json', 'toledo/toledo-candidates.json'],
    })
    expect(result.stage).toEqual(['toledo/toledo-candidates.json'])
    expect(result.skipped).toContainEqual({
      path: 'toledo/tabs.json',
      reason: 'deleted in the working tree — a backup never records a deletion',
    })
  })

  it('reports renames and unmerged paths instead of staging them', () => {
    const renamed = parse('R  toledo/new.json\0toledo/old.json\0')
    expect(renamed).toEqual([{ x: 'R', y: ' ', path: 'toledo/new.json', origPath: 'toledo/old.json' }])
    const result = select({
      statusEntries: [...renamed, ...parse(statusZ('UU toledo/tabs.json'))],
      candidates: ['toledo/new.json', 'toledo/tabs.json'],
    })
    expect(result.stage).toEqual([])
    expect(result.skipped.map((s) => s.path).sort()).toEqual(['toledo/new.json', 'toledo/tabs.json'])
  })

  it('reports paths this run did not author, and leaves them alone', () => {
    const result = select({
      statusEntries: parse(statusZ('?? toledo/tabs.json', '?? _scratch/notes.md', ' M README.md')),
      candidates: ['toledo/tabs.json'],
    })
    expect(result.stage).toEqual(['toledo/tabs.json'])
    expect(result.unexpected.map((u) => u.path).sort()).toEqual(['README.md', '_scratch/notes.md'])
  })
})

// The design must work whichever way the owner rules on backing up the geocode cache (B3), and must
// not silently depend on either outcome. These two tests are that proof.
describe('selectBackupPaths — geocode cache, both B3 outcomes', () => {
  it('B3 NOT taken: the cache is ignored, so it never appears in status and is never staged', () => {
    const result = select({
      // An ignored path is absent from `git status` by construction. That is what makes naming the
      // cache path unconditionally safe — `git add` on an ignored path would otherwise ERROR.
      statusEntries: parse(statusZ('?? toledo/tabs.json')),
      candidates: ['toledo/tabs.json', '.geocode-cache/toledo.json'],
    })
    expect(result.stage).toEqual(['toledo/tabs.json'])
    expect(result.skipped).toContainEqual({
      path: '.geocode-cache/toledo.json',
      reason: 'no pending change (unchanged, absent, or ignored)',
    })
    expect(result.unexpected).toEqual([])
  })

  it('B3 taken: the cache appears in status and is carried, with no code change', () => {
    const result = select({
      statusEntries: parse(statusZ('?? toledo/tabs.json', '?? .geocode-cache/toledo.json')),
      candidates: ['toledo/tabs.json', '.geocode-cache/toledo.json'],
    })
    expect(result.stage.sort()).toEqual(['.geocode-cache/toledo.json', 'toledo/tabs.json'])
    expect(result.unexpected).toEqual([])
  })

  it('carries only the metro\'s own cache file, never the legacy shared seeds', () => {
    const result = select({
      statusEntries: parse(
        statusZ('?? .geocode-cache/toledo.json', '?? .geocode-cache/nominatim.json', '?? .geocode-cache/nominatim-wave1.json')
      ),
      candidates: ['.geocode-cache/toledo.json'],
    })
    expect(result.stage).toEqual(['.geocode-cache/toledo.json'])
    expect(result.unexpected.map((u) => u.path).sort()).toEqual([
      '.geocode-cache/nominatim-wave1.json',
      '.geocode-cache/nominatim.json',
    ])
  })
})

describe('toRepoPathspec', () => {
  it('rewrites a cwd-relative path into a repo-relative pathspec with forward slashes', () => {
    expect(pathspec('metro-research/toledo/tabs.json')).toBe('toledo/tabs.json')
    expect(pathspec('metro-research/.geocode-cache/toledo.json')).toBe('.geocode-cache/toledo.json')
  })

  /**
   * WINDOWS-ONLY: a backslash is a path SEPARATOR on Windows and an ordinary filename character on
   * Linux, so `metro-research\toledo\tabs.json` is one flat filename there and correctly resolves
   * to null rather than to a pathspec. Split out of the test above so the two platform-agnostic
   * cases keep running on the ubuntu CI runner; before this split the whole test failed there.
   *
   * The behaviour is real and worth keeping — git wants forward slashes and the callers hand this
   * Windows paths — it just cannot be asserted anywhere except Windows.
   */
  it.skipIf(process.platform !== 'win32')(
    'rewrites a BACKSLASH path too, because callers on Windows produce them',
    () => {
      expect(pathspec('metro-research\\toledo\\tabs.json')).toBe('toledo/tabs.json')
    },
  )

  it('refuses anything that escapes the repo or is absolute', () => {
    expect(pathspec('scripts/metros/toledo.json')).toBeNull()
    expect(pathspec('../elsewhere/tabs.json')).toBeNull()
    expect(pathspec('C:/Users/marty/secrets.env')).toBeNull()
    expect(pathspec(null)).toBeNull()
    expect(pathspec('')).toBeNull()
  })
})

describe('researchRepoBlocker — the two "missing" cases give different advice', () => {
  it('a linked worktree is told to bootstrap, not to blame a git clean', () => {
    const reason = blocker({
      exists: () => false,
      stat: () => ({ isFile: () => true }), // `.git` is a FILE in a linked worktree
    })
    expect(reason).toContain('never bootstrapped')
    expect(reason).toContain('bootstrap-worktree.mjs')
    expect(reason).not.toContain('git clean')
  })

  it('the main checkout is told a clean may have removed the junction', () => {
    const reason = blocker({
      exists: () => false,
      stat: () => ({ isFile: () => false }), // `.git` is a DIRECTORY in the main checkout
    })
    expect(reason).toContain('git clean')
    expect(reason).toContain('mklink')
    expect(reason).not.toContain('bootstrap-worktree.mjs')
  })

  it('refuses a repo that is mid-merge', () => {
    // Everything exists except the rebase/cherry-pick markers, i.e. MERGE_HEAD is present.
    const reason = blocker({ exists: (p) => !p.includes('rebase') && !p.includes('CHERRY_PICK') })
    expect(reason).toContain('middle of a merge')
  })

  it('refuses a repo that is mid-rebase', () => {
    const reason = blocker({ exists: (p) => !p.includes('MERGE_HEAD') && !p.includes('CHERRY_PICK') })
    expect(reason).toContain('middle of a rebase')
  })

  it('passes a healthy repo', () => {
    const healthy = blocker({
      exists: (p) => p === 'metro-research' || p === join('metro-research', '.git'),
    })
    expect(healthy).toBeNull()
  })
})

// These two are the properties the whole design rests on. Real git, real filesystem, temp repo.
describe('git semantics the design depends on', () => {
  it('a pathspec commit does NOT sweep another session\'s staged file', () => {
    const { dir, g } = scratchRepo()
    mkdirSync(join(dir, 'toledo'))
    mkdirSync(join(dir, 'hartford'))
    writeFileSync(join(dir, 'hartford/hartford-candidates.json'), '{"v":1}\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'seed')

    // Another session stages an unrelated change and walks away.
    writeFileSync(join(dir, 'hartford/hartford-candidates.json'), '{"v":"WIP"}\n')
    g('add', '--', 'hartford/hartford-candidates.json')

    // Our run stages and commits ONLY its own paths.
    writeFileSync(join(dir, 'toledo/tabs.json'), '{"v":1}\n')
    g('add', '--ignore-removal', '--', 'toledo/tabs.json')
    g('commit', '-q', '-m', 'Research artifacts: toledo extract', '--', 'toledo/tabs.json')

    const committed = g('show', '--name-only', '--format=', 'HEAD').trim().split('\n')
    expect(committed).toEqual(['toledo/tabs.json'])
    // The other session's work is untouched — still staged, exactly as they left it.
    expect(g('diff', '--cached', '--name-only').trim()).toBe('hartford/hartford-candidates.json')
  })

  it('--ignore-removal cannot record a deletion, where a plain add does', () => {
    const { dir, g } = scratchRepo()
    mkdirSync(join(dir, 'toledo'))
    writeFileSync(join(dir, 'toledo/tabs.json'), '{"v":1}\n')
    writeFileSync(join(dir, 'toledo/toledo-candidates.json'), '{"v":1}\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'seed')

    unlinkSync(join(dir, 'toledo/tabs.json'))
    writeFileSync(join(dir, 'toledo/toledo-candidates.json'), '{"v":2}\n')

    g('add', '--ignore-removal', '--', 'toledo/tabs.json', 'toledo/toledo-candidates.json')
    expect(g('diff', '--cached', '--name-status').trim()).toBe('M\ttoledo/toledo-candidates.json')

    // Negative control: the flag is doing the work, not the path list.
    g('reset', '-q')
    g('add', '--', 'toledo/tabs.json', 'toledo/toledo-candidates.json')
    expect(g('diff', '--cached', '--name-status')).toContain('D\ttoledo/tabs.json')
  })

  it('an ignored path named in git add is an ERROR, which is why staging intersects status', () => {
    const { dir, g } = scratchRepo()
    writeFileSync(join(dir, '.gitignore'), '/.geocode-cache/\n')
    mkdirSync(join(dir, '.geocode-cache'))
    writeFileSync(join(dir, '.geocode-cache/toledo.json'), '{"c":1}\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'seed')

    expect(() => g('add', '--', '.geocode-cache/toledo.json')).toThrow()
    // ...and it is absent from status, which is exactly how selectBackupPaths avoids ever naming it.
    expect(g('status', '--porcelain', '-uall')).not.toContain('.geocode-cache')
  })

  it('status needs -uall: the default collapses a new metro directory to one entry', () => {
    const { dir, g } = scratchRepo()
    writeFileSync(join(dir, 'README.md'), '# seed\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'seed')
    mkdirSync(join(dir, 'toledo'))
    writeFileSync(join(dir, 'toledo/tabs.json'), '{"v":1}\n')
    writeFileSync(join(dir, 'toledo/toledo-candidates.json'), '{"v":1}\n')

    expect(g('status', '--porcelain').trim()).toBe('?? toledo/')
    const all = parse(g('status', '--porcelain', '-z', '-uall'))
    expect(all.map((e) => e.path).sort()).toEqual(['toledo/tabs.json', 'toledo/toledo-candidates.json'])
  })
})
