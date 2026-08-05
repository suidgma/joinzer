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
import { existsSync, copyFileSync, lstatSync, readlinkSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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
const FAIL = Symbol('fail')
const fail = (message) => ({ [FAIL]: true, message })
const step = (label, fn) => {
  try {
    const result = fn()
    if (result && result[FAIL]) {
      failures++
      console.log(`  ${label}: ${result.message}`)
      return
    }
    console.log(`  ${label}: ${result}`)
  } catch (err) {
    failures++
    console.log(`  ${label}: FAILED — ${(err.message || String(err)).split('\n')[0]}`)
  }
}

// What is actually at a path — never inferred from existsSync, which cannot tell a junction from
// the real thing. That distinction is the whole point: the branch this replaces said "already
// present, left alone" and skipped an existing `metro-research` WITHOUT checking what it was, which
// is how .claude/worktrees/metro-wave-1 came to hold five metros' research as a real directory —
// the only copy, invisible to the backup, and reachable by `git clean -fdx`.
//
// A Windows junction reports isSymbolicLink() === true to lstat and readlinkSync returns its
// target, so both halves of "is this a link, and does it point where I expect" are answerable.
const classify = (path) => {
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return { kind: 'missing' }
  }
  if (stats.isSymbolicLink()) {
    try {
      return { kind: 'junction', target: resolve(readlinkSync(path)) }
    } catch {
      return { kind: 'junction', target: null }
    }
  }
  return { kind: stats.isDirectory() ? 'dir' : 'file' }
}

// --- env files: COPIED, never linked. They are per-environment secrets and a worktree may
// legitimately need to point at something different; a link would make an edit in one worktree
// silently rewrite every other one, which is the class of bug this script exists to prevent.
for (const f of ENV_FILES) {
  step(f, () => {
    const found = classify(join(here, f))
    if (found.kind === 'junction') {
      return fail(
        `SYMLINK -> ${found.target} — env files must be COPIES.\n` +
          `      A link makes an edit here silently rewrite every other worktree's environment,\n` +
          `      which is the class of bug this script exists to prevent. Replace it with a copy.`,
      )
    }
    if (found.kind !== 'missing') return 'already present, left alone'
    const src = join(mainCheckout, f)
    if (!existsSync(src)) return `not in the main checkout either — skipped`
    copyFileSync(src, join(here, f))
    return 'copied from the main checkout (gitignored; never commit it)'
  })
}

// --- metro-research: JUNCTION to the shared research repo, which lives outside every working tree.
// Shared deliberately: it is one backed-up git repo and per-worktree copies would diverge silently.
step('metro-research', () => {
  const target = resolve(mainCheckout, '..', RESEARCH_REPO)
  const found = classify(join(here, 'metro-research'))

  if (found.kind === 'junction') {
    if (found.target === target) return `junction -> ${target} (target verified)`
    return fail(
      `WRONG TARGET — points at ${found.target}, expected ${target}\n` +
        `      Every scripts/metros/*.json input resolves through this link, so the pipeline would\n` +
        `      read and write the wrong repo without ever saying so. Repoint it:\n` +
        `          node -e "require('fs').rmdirSync('metro-research')"\n` +
        `          cmd /c mklink /J metro-research ${target}`,
    )
  }

  if (found.kind === 'dir') {
    return fail(
      `REAL DIRECTORY, not a junction — this worktree is NOT sharing the research repo.\n` +
        `      This is the metro-wave-1 shape. Research written here is the ONLY copy: the backup\n` +
        `      never sees it, and \`git clean -fdx\` inside a worktree provably removes it (that is\n` +
        `      the 2026-08-03 loss). Move its contents into\n` +
        `          ${target}\n` +
        `      then remove the directory and re-run this script.`,
    )
  }

  if (found.kind === 'file') return fail('a FILE exists at metro-research — remove it and re-run')
  if (!existsSync(target)) return `${target} not found — clone the private joinzer-metro-research repo there first`
  link(target, join(here, 'metro-research'))
  return `junction -> ${target}`
})

// --- metro configs: prove every declared input path actually resolves HERE, before a pipeline run
// discovers it at ENOENT. 47 of the 48 configs resolve through the metro-research junction above, so
// they are really a second assertion that the link works. The 48th is the reason this step exists:
// little-rock.json's input is `little-rock-count/`, a gitignored directory INSIDE the Joinzer repo,
// which a fresh worktree therefore does not carry. It ENOENTs exactly like a missing artifact, for a
// completely recoverable reason.
//
// Deliberately NOT FATAL, and deliberately no auto-copy. Not fatal because only the metro you are
// about to run matters, and the junction failure above already exits 1 for the case that affects all
// 47. No auto-copy because these are ADR-14 private research inputs, and duplicating them into every
// worktree is not a decision a bootstrap script should make silently — so it reports the exact
// command and lets a human choose.
step('metro configs', () => {
  const configDir = join(here, 'scripts', 'metros')
  if (!existsSync(configDir)) return 'scripts/metros not found — skipped'
  const configs = readdirSync(configDir).filter((f) => f.endsWith('.json'))
  const unresolved = new Map()

  for (const file of configs) {
    let config
    try {
      config = JSON.parse(readFileSync(join(configDir, file), 'utf8'))
    } catch (err) {
      unresolved.set(`${file} (unparseable)`, { files: [file], note: err.message.split('\n')[0] })
      continue
    }
    // `input` is the artifact; `geocode_cache` is a file whose DIRECTORY must exist for a flush to
    // land. Both are repo-root-relative in every config today.
    const declared = [config.input, config.geocode_cache && dirname(config.geocode_cache)].filter(Boolean)
    for (const rel of declared) {
      if (existsSync(resolve(here, rel))) continue
      if (!unresolved.has(rel)) unresolved.set(rel, { files: [] })
      unresolved.get(rel).files.push(file)
    }
  }

  if (unresolved.size === 0) return `${configs.length} configs — every input path resolves`

  const lines = [`${configs.length} configs — ${unresolved.size} path(s) do NOT resolve in this worktree:`]
  for (const [rel, { files, note }] of unresolved) {
    const owners = files.length > 3 ? `${files.slice(0, 3).join(', ')} +${files.length - 3} more` : files.join(', ')
    lines.push(`      ${rel}   (${owners})`)
    if (note) {
      lines.push(`        -> ${note}`)
      continue
    }
    const inMain = resolve(mainCheckout, rel)
    lines.push(
      existsSync(inMain)
        ? `        -> present in the main checkout. If you are running that metro, copy it:\n` +
            `           node -e "require('fs').cpSync(String.raw\`${inMain}\`, String.raw\`${resolve(here, rel)}\`, { recursive: true })"`
        : `        -> absent from the main checkout too — this metro cannot run anywhere until it is restored`,
    )
  }
  lines.push('      NOT FATAL — only the metro you actually run needs its own input.')
  return lines.join('\n')
})

// --- node_modules: a REAL install, never a link.
//
// This used to junction to the main checkout when package.json + package-lock.json were
// byte-identical. That broke `next build` — one of the three gates that define "done" — for every
// worktree it touched: Turbopack resolves the module root itself and rejects a link that leaves the
// project directory, failing with
//     Symlink [project]/node_modules is invalid, it points out of the filesystem root
//       -> TurbopackInternalError
// so the default configuration made the known-broken path the default, and every session that
// needed the build gate unpicked it by hand.
//
// The junction existed to save disk, and that premise does not survive measurement: node_modules is
// 0.49 GB against 337 GB free, so six parallel worktrees cost under 1% of the disk. It bought about
// a minute of install time and cost a working build. It was also the ONLY reason `rmdir
// node_modules` appeared in teardown at all — so deleting the option deletes half the teardown
// hazard outright, rather than documenting it better.
//
// `npm ci`, not `npm install`: it installs exactly the lockfile and never rewrites it, so a
// bootstrap can't leave a spurious package-lock.json diff in the worktree you're about to work in.
step('node_modules', () => {
  const found = classify(join(here, 'node_modules'))

  if (found.kind === 'junction') {
    return fail(
      `JUNCTION -> ${found.target} — bootstrapped before node_modules became a real install.\n` +
        `      \`next build\` WILL fail here with TurbopackInternalError (see the note above).\n` +
        `      Replace the link with a real tree:\n` +
        `          node -e "require('fs').rmdirSync('node_modules')"   # removes the LINK only\n` +
        `          npm ci\n` +
        `      Never \`rm -rf node_modules\` on a junction — it walks into the main checkout's own\n` +
        `      module tree and empties it for every session.`,
    )
  }

  if (found.kind === 'dir') return 'already present (real directory), left alone'
  if (found.kind === 'file') return fail('a FILE exists at node_modules — remove it and re-run')
  if (!existsSync(join(here, 'package-lock.json'))) return fail('no package-lock.json here — cannot `npm ci`')
  console.log('  node_modules: absent — running `npm ci` (a minute or so; output follows)')
  execFileSync('cmd', ['/c', 'npm', 'ci'], { cwd: here, stdio: 'inherit' })
  return 'installed via `npm ci` — a real tree, so the BUILD gate works here'
})

console.log(
  failures
    ? `\n${failures} step(s) failed — fix them before running the pipeline here.`
    : '\nReady. This worktree is isolated: edits here cannot collide with another session.',
)
process.exit(failures ? 1 : 0)
