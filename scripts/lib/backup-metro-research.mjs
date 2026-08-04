/**
 * Backs up the metro-research repository — the private, out-of-tree store of court-directory
 * research artifacts.
 *
 * WHY THIS EXISTS. On 2026-08-03 `metro-research/` was wiped from the Joinzer working tree. Most of
 * it came back from the private GitHub backup, but that backup was ONE COMMIT OLD and seven metro
 * folders behind, so the Colorado Springs research artifacts were lost outright. The backup existed;
 * keeping it current was a manual step in a README, and manual steps go stale exactly when they
 * matter. This makes the commit automatic.
 *
 * WHAT IS AT RISK
 *   <metro>/tabs.json                the irreplaceable artifact — a verbatim workbook dump that
 *                                    cannot be regenerated from anything in either repo.
 *   <metro>/<metro>-candidates.json  regenerable, but only by re-spending the Nominatim budget.
 *   <cache-dir>/<metro>.json         the geocode cache. NOT purely regenerable, and NOT excluded
 *                                    because it is "large": the winning anchor survives in the
 *                                    candidates artifact, but the runners-up, the township-guard
 *                                    rejections and the micro-feature skips exist ONLY here, and
 *                                    re-fetching returns TODAY'S OSM rather than the OSM those
 *                                    rulings were made against. It is an audit artifact. It is
 *                                    excluded today only because the research repo's own .gitignore
 *                                    still lists it — an open owner decision, not settled rationale.
 *                                    See "B3 COMPATIBILITY" below.
 *
 * THE COMMIT IS AUTOMATIC. THE PUSH IS NOT. These are different operations with different risk.
 * The failure this script exists to prevent is a LOCAL wipe, and since 2026-08-03 the research repo
 * lives at a sibling path OUTSIDE every working tree — `git clean -fdx` provably does not follow the
 * junction — so a local commit already survives the exact event that caused the loss. A push protects
 * against disk or machine loss, which is a rarer risk AND an external send: ADR-10's deploy autonomy
 * covers the Joinzer repo only, and "anything sent or published externally" is a standing escalation.
 * Firing a push as a side effect of an unrelated operation would trip that on every extract.
 *
 * WHEN A SESSION MAY RUN `--push` WITHOUT ASKING (owner ruling, 2026-08-04): when it has just
 * committed its OWN scoped artifacts and the run reported nothing unexpected. Anything else — leftover
 * paths from another session, a failed or partial commit, a repo it did not just write to — is an
 * owner decision. The report below prints that reminder whenever unexpected paths are present.
 *
 * WHAT IT STAGES: EXPLICIT PATHS ONLY. THERE IS NO `git add -A` IN THIS FILE, BY DESIGN.
 * The old version staged everything and pushed. That is not a hypothetical hazard — research-repo
 * commit cb79409, "Research artifacts: grand-rapids extract", also carries
 * `hartford/hartford-candidates.json`: another metro's in-flight work, swept into a commit whose
 * message denies it exists, and pushed. Two structural consequences of `-A`, both fixed here:
 *
 *   1. It staged whatever happened to be in the repo — another session's work-in-progress, scratch
 *      files, and (the research repo's .gitignore is a single line) anything secret-shaped that a
 *      session had dropped there for convenience.
 *   2. It staged DELETIONS. A backup that can commit and push a loss inverts its own purpose.
 *
 * The path set is derived from what the run ACTUALLY did — the artifact it wrote, the raw dump it
 * read — and is then INTERSECTED with `git status`. That intersection is what makes the whole thing
 * robust, and it falls out of one call: an ignored path never appears in status (so naming one can
 * never raise "paths are ignored by one of your .gitignore files"), a deleted path is filtered out,
 * an unchanged or absent path simply is not there. Everything status reports that we did NOT intend
 * is REPORTED AND LEFT ALONE, which turns the cb79409 sweep into a visible prompt.
 *
 * B3 COMPATIBILITY — this file must work whichever way the owner rules on backing up the cache, and
 * must not quietly assume either. The cache path is named in the candidate set unconditionally:
 *   - while the research repo ignores `.geocode-cache/`, it never appears in status, so it is never
 *     staged and never errors;
 *   - the day that ignore is lifted, it appears in status and is carried automatically.
 * Only the metro's OWN cache file is ever named. The legacy shared seeds (`nominatim*.json`) are
 * read-only by design and are written by nothing; committing those is a deliberate one-time act, not
 * this script's business. NOTE for whoever takes B3: the claim that un-ignoring the cache carries it
 * "with zero new code" was true only of `git add -A`. It is the line below that keeps it true.
 *
 * FAILURE POSTURE: never fatal. A git or network failure must not fail an extract that already
 * succeeded, so this reports loudly and returns a result object rather than throwing. Same posture as
 * scripts/lib/revalidate-directory.mjs.
 *
 * Usage:
 *   node scripts/lib/backup-metro-research.mjs           # report state; commit nothing, push nothing
 *   node scripts/lib/backup-metro-research.mjs --push    # push the local commits that already exist
 *
 * There is deliberately no standalone "commit everything" mode: this file cannot know which paths a
 * given run authored, and guessing is how `-A` got here. The report prints paste-ready, explicit-path
 * commands for anything left uncommitted.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The junction (or, in the main checkout, the link) to the shared research repo. Relative to cwd. */
const REPO = 'metro-research'

/**
 * Whether a backup pushes by default. Deliberately false — see the header. Flipping this one constant
 * is the entire change if the owner ever grants a research-repo carve-out; nothing else assumes it.
 */
const PUSH_BY_DEFAULT = false

function git(args, { quiet = true } = {}) {
  return execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  })
}

function gitDetail(err) {
  return (err?.stderr || err?.stdout || err?.message || '').toString().trim().split('\n').slice(-3).join(' | ')
}

/**
 * Normalizes a cwd-relative path (as the metro configs and CLI flags express them) into a pathspec
 * relative to the research repo root, or null when it does not live inside the repo.
 *
 * `join()` returns backslashes on Windows and git pathspecs want forward slashes, so both the
 * separator swap and the escape check are load-bearing rather than cosmetic.
 */
export function toRepoPathspec(cwdRelativePath, repo = REPO) {
  if (!cwdRelativePath || typeof cwdRelativePath !== 'string') return null
  if (isAbsolute(cwdRelativePath)) return null
  const rel = relative(repo, cwdRelativePath).replace(/\\/g, '/')
  if (!rel || rel === '..' || rel.startsWith('../')) return null
  return rel
}

/**
 * Parses `git status --porcelain -z -uall` into records.
 *
 * `-z` avoids porcelain v1's quoting of unusual paths, and `-uall` is required rather than optional:
 * with the default `-unormal` a brand-new metro directory collapses to a single `metro-name/` entry,
 * which cannot be intersected with file-level candidates.
 *
 * Rename and copy records carry a second NUL-terminated field holding the original path.
 */
export function parseStatusZ(raw) {
  const out = []
  if (!raw) return out
  const chunks = raw.split('\0')
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    if (!chunk || chunk.length < 4) continue
    const x = chunk[0]
    const y = chunk[1]
    const path = chunk.slice(3)
    let origPath = null
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 1
      origPath = chunks[i] ?? null
    }
    out.push({ x, y, path, origPath })
  }
  return out
}

/**
 * THE DECISION FUNCTION. Pure — no git, no filesystem, no network — so the rules below are unit
 * tested directly rather than inferred from a run.
 *
 * @param statusEntries records from parseStatusZ
 * @param candidates    repo-relative FILE pathspecs this run believes it authored. `git status`
 *                      reports files, so a directory candidate matches nothing and is reported as
 *                      having no pending change rather than staging its contents.
 */
export function selectBackupPaths({ statusEntries = [], candidates = [] } = {}) {
  const wanted = []
  for (const c of candidates) {
    if (typeof c === 'string' && c && !wanted.includes(c)) wanted.push(c)
  }
  const byPath = new Map(statusEntries.map((e) => [e.path, e]))

  const stage = []
  const skipped = []
  for (const path of wanted) {
    const entry = byPath.get(path)
    if (!entry) {
      // Unchanged, absent, or ignored. An ignored path is invisible to `git status`, which is
      // exactly what lets the cache path be named unconditionally (see B3 COMPATIBILITY).
      skipped.push({ path, reason: 'no pending change (unchanged, absent, or ignored)' })
      continue
    }
    if (entry.x === 'D' || entry.y === 'D') {
      // A backup must be structurally incapable of recording a loss.
      skipped.push({ path, reason: 'deleted in the working tree — a backup never records a deletion' })
      continue
    }
    if (entry.x === 'R' || entry.y === 'R' || entry.x === 'C' || entry.y === 'C') {
      skipped.push({ path, reason: `${entry.x}${entry.y} rename/copy — reported, not staged` })
      continue
    }
    if (entry.x === 'U' || entry.y === 'U') {
      skipped.push({ path, reason: 'unmerged — reported, not staged' })
      continue
    }
    stage.push(path)
  }

  const unexpected = statusEntries
    .filter((e) => !wanted.includes(e.path))
    .map((e) => ({ path: e.path, status: `${e.x}${e.y}` }))

  return { stage, skipped, unexpected }
}

/**
 * Why the research repo cannot be written to right now, or null when it can.
 *
 * The two "missing" cases get DIFFERENT advice on purpose. In a linked worktree the overwhelmingly
 * likely cause is that bootstrap was never run there (observed 2026-08-04: the active batch3 worktree
 * had no link at all and was being told a git clean had removed one). In the main checkout, where the
 * link is set up once and stays, something removing it is the likely cause.
 */
export function researchRepoBlocker({ repo = REPO, exists = existsSync, stat = lstatSync } = {}) {
  if (!exists(repo)) {
    let isLinkedWorktree = false
    try {
      // `.git` is a FILE in a linked worktree and a DIRECTORY in the main checkout.
      isLinkedWorktree = stat('.git').isFile()
    } catch {
      isLinkedWorktree = false
    }
    return isLinkedWorktree
      ? `${repo}/ is not linked in this worktree — it was most likely never bootstrapped. Create the link:\n  node scripts/bootstrap-worktree.mjs`
      : `${repo}/ is missing. If a "git clean" removed the junction, recreate it:\n  cmd /c mklink /J metro-research ..\\joinzer-metro-research`
  }
  if (!exists(join(repo, '.git'))) {
    return `${repo}/ is not a git repository, so nothing here is backed up. Expected the private joinzer-metro-research clone (or a link to it).`
  }
  for (const [marker, what] of [
    ['.git/MERGE_HEAD', 'a merge'],
    ['.git/rebase-merge', 'a rebase'],
    ['.git/rebase-apply', 'a rebase'],
    ['.git/CHERRY_PICK_HEAD', 'a cherry-pick'],
  ]) {
    if (exists(join(repo, marker))) {
      return `${repo}/ is in the middle of ${what} — refusing to commit into it. Finish or abort it first.`
    }
  }
  return null
}

/** Commits ONLY the paths this run authored. Never stages anything it was not given. */
export function backupMetroResearch({ metro = null, artifacts = [], push = PUSH_BY_DEFAULT, label = null } = {}) {
  const blocked = researchRepoBlocker()
  if (blocked) return { ok: false, reason: blocked }

  try {
    // A detached HEAD would orphan the commit. Cheap to check, expensive to discover later.
    try {
      git(['symbolic-ref', '-q', 'HEAD'])
    } catch {
      return { ok: false, reason: `${REPO}/ has a detached HEAD — refusing to commit, the result would be unreachable.` }
    }

    const candidates = artifacts.map((p) => toRepoPathspec(p)).filter(Boolean)
    // `--no-optional-locks` keeps a read from refreshing the index of a repo another session may be
    // using. The read is the only place we can afford to be polite; the write needs the real lock.
    const raw = execFileSync('git', ['--no-optional-locks', '-C', REPO, 'status', '--porcelain', '-z', '-uall'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const statusEntries = parseStatusZ(raw)
    const { stage, skipped, unexpected } = selectBackupPaths({ statusEntries, candidates })

    let committed = 0
    if (stage.length) {
      // `--ignore-removal` is belt-and-braces: the intersection above already dropped deletions, and
      // this guarantees the index cannot acquire one even if a file vanishes between the two calls.
      git(['add', '--ignore-removal', '--', ...stage])
      const msg = label ? `Research artifacts: ${label}` : `Research artifacts: ${stage.length} path(s)`
      try {
        // The pathspec on `commit` is what fences this out of another session's index. A bare
        // `git commit` writes the WHOLE index, so a co-staged file from another session would ride
        // along — which is precisely how cb79409 acquired hartford.
        git(['commit', '-m', msg, '--', ...stage])
      } catch (err) {
        // Restore the pre-run index for our paths only. Leaving a shared repo's index dirty is what
        // makes the next session's commit sweep something it did not author.
        try { git(['reset', '-q', '--', ...stage]) } catch { /* best effort */ }
        throw err
      }
      committed = stage.length
    }

    let pushed = false
    if (push) {
      git(['push'])
      pushed = true
    }

    let unpushed = null
    try {
      unpushed = Number(git(['rev-list', '--count', '@{u}..HEAD']).trim())
    } catch {
      unpushed = null // no upstream configured
    }

    return { ok: true, metro, committed, staged: stage, skipped, unexpected, pushed, unpushed }
  } catch (err) {
    return { ok: false, reason: gitDetail(err) || String(err) }
  }
}

const RULE = '='.repeat(78)

/** Prints the result in the house ACTION REQUIRED style. Returns true when the backup is safe. */
export function reportBackup(result) {
  if (!result.ok) {
    console.log('\n' + RULE)
    console.log('ACTION REQUIRED — the metro-research backup did NOT update.')
    result.reason.split('\n').forEach((line) => console.log(`  ${line}`))
    console.log('  The research artifacts on disk may now be the ONLY copy.')
    console.log(RULE)
    return false
  }

  const what = result.committed
    ? `committed ${result.committed} path(s) locally`
    : 'nothing of ours to commit'
  console.log(`\nmetro-research backup: ${what}${result.pushed ? ', pushed' : ''}`)
  result.staged?.forEach((p) => console.log(`  + ${p}`))
  result.skipped?.filter((s) => !s.reason.startsWith('no pending change')).forEach((s) => console.log(`  - ${s.path} — ${s.reason}`))

  if (result.unexpected?.length) {
    console.log(`\n  ${result.unexpected.length} path(s) changed in the research repo that this run did NOT author.`)
    console.log('  LEFT ALONE deliberately — they may be another session\'s work in progress:')
    result.unexpected.forEach((u) => console.log(`    ${u.status}  ${u.path}`))
    console.log('  Commit them explicitly, by path, once you know they are yours:')
    console.log(`    git -C ${REPO} add -- ${result.unexpected.map((u) => u.path).join(' ')}`)
    console.log(`    git -C ${REPO} commit -m "<what these are>"`)
    console.log('  Because these are here, a push is NOT an unattended action — ask before running --push.')
  }

  if (!result.pushed && result.unpushed) {
    console.log(`\n  ${result.unpushed} commit(s) not yet pushed. The backup is local-only until you run:`)
    console.log('    node scripts/lib/backup-metro-research.mjs --push')
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const push = process.argv.includes('--push')
  // No --metro here on purpose: a standalone run cannot know which paths a given extract authored,
  // so it reports and (optionally) pushes what is already committed. It never stages.
  const ok = reportBackup(backupMetroResearch({ artifacts: [], push }))
  process.exit(ok ? 0 : 1)
}
