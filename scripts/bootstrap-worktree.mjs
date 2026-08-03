/**
 * Makes a fresh Joinzer git worktree actually usable, in one command.
 *
 * WHY THIS EXISTS. "Work in your own worktree" has been the rule for a while and kept getting
 * skipped, and the reason was never discipline — it was that a worktree carries only TRACKED files.
 * A new worktree has no `.env.local`, no `node_modules` and (before 2026-08-03) no `metro-research/`,
 * so isolating actively broke the directory pipeline and every session drifted back into the shared
 * main checkout. That shared tree is what produced, in a single afternoon on 2026-08-03:
 *
 *   - `metro-research/` wiped by a `git clean -fdx` (30+ metros, since recovered from backup)
 *   - one session's uncommitted files swept into another session's commit
 *   - two sessions queued to edit `scripts/lib/workbook-extract.mjs` at the same time
 *
 * A rule that costs something gets skipped. This makes isolation free, so it stops being a judgment
 * call. Two worktrees are physically different files: concurrent edits become MERGE CONFLICTS, which
 * are visible and resolvable, instead of silent clobbering, which is neither.
 *
 * Usage, from anywhere inside the new worktree:
 *   git worktree add ../joinzer-<task> -b <branch>
 *   cd ../joinzer-<task>
 *   node scripts/bootstrap-worktree.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ENV_FILES = ['.env.local', '.env.test']
const RESEARCH_REPO = 'joinzer-metro-research'

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const link = (target, name) => execFileSync('cmd', ['/c', 'mklink', '/J', name, target], { encoding: 'utf8' })

const gitDir = sh('git', ['rev-parse', '--git-dir'])
const commonDir = sh('git', ['rev-parse', '--git-common-dir'])
const here = sh('git', ['rev-parse', '--show-toplevel'])

if (resolve(gitDir) === resolve(commonDir)) {
  console.error(`\nThis is the MAIN checkout (${here}), not a worktree.`)
  console.error('Bootstrapping it would be a no-op at best. Create a worktree first:')
  console.error('    git worktree add ../joinzer-<task> -b <branch>')
  console.error('    cd ../joinzer-<task> && node scripts/bootstrap-worktree.mjs')
  process.exit(1)
}

// .git/worktrees/<name> -> the main checkout is two levels up from the common dir's parent
const mainCheckout = resolve(commonDir, '..')
console.log(`worktree     : ${here}`)
console.log(`main checkout: ${mainCheckout}\n`)

let failures = 0
const step = (label, fn) => {
  try {
    console.log(`  ${label}: ${fn()}`)
  } catch (err) {
    failures++
    console.log(`  ${label}: FAILED — ${(err.message || String(err)).split('\n')[0]}`)
  }
}

// --- env files: COPIED, never linked. They are per-environment secrets and a worktree may
// legitimately need to point at something different; a link would make an edit in one worktree
// silently rewrite every other one, which is the class of bug this script exists to prevent.
for (const f of ENV_FILES) {
  step(f, () => {
    if (existsSync(join(here, f))) return 'already present, left alone'
    const src = join(mainCheckout, f)
    if (!existsSync(src)) return `not in the main checkout either — skipped`
    copyFileSync(src, join(here, f))
    return 'copied from the main checkout (gitignored; never commit it)'
  })
}

// --- metro-research: JUNCTION to the shared research repo, which lives outside every working tree.
// Shared deliberately: it is one backed-up git repo and per-worktree copies would diverge silently.
step('metro-research', () => {
  if (existsSync(join(here, 'metro-research'))) return 'already present, left alone'
  const target = resolve(mainCheckout, '..', RESEARCH_REPO)
  if (!existsSync(target)) return `${target} not found — clone the private joinzer-metro-research repo there first`
  link(target, join(here, 'metro-research'))
  return `junction -> ${target}`
})

// --- node_modules: JUNCTION when the dependency set is identical, install otherwise. Sharing a
// module tree across branches with different package.json would be a real footgun, so the check is
// on package.json + package-lock.json content rather than on trust.
step('node_modules', () => {
  if (existsSync(join(here, 'node_modules'))) return 'already present, left alone'
  const same = ['package.json', 'package-lock.json'].every((f) => {
    const a = join(here, f)
    const b = join(mainCheckout, f)
    return existsSync(a) && existsSync(b) && readFileSync(a, 'utf8') === readFileSync(b, 'utf8')
  })
  if (!same) return 'package.json/lock DIFFER from the main checkout — run `npm install` here instead of sharing'
  link(join(mainCheckout, 'node_modules'), join(here, 'node_modules'))
  return 'junction -> main checkout (dependency set is byte-identical)'
})

console.log(
  failures
    ? `\n${failures} step(s) failed — fix them before running the pipeline here.`
    : '\nReady. This worktree is isolated: edits here cannot collide with another session.',
)
process.exit(failures ? 1 : 0)
