/**
 * Commits and pushes the metro-research backup repository.
 *
 * WHY THIS EXISTS. On 2026-08-03 `metro-research/` was wiped from the Joinzer working tree. Most of
 * it came back from the private GitHub backup, but the backup was ONE COMMIT OLD and seven metro
 * folders behind, so the Colorado Springs research artifacts were lost outright. The backup existed;
 * keeping it current was a manual step in a README, and manual steps go stale exactly when they
 * matter. This makes it automatic.
 *
 * WHAT IS AT RISK. `<metro>/tabs.json` is the irreplaceable artifact — a verbatim dump of a research
 * workbook. The derived `<metro>-candidates.json` is regenerable but costs geocoding requests, and the
 * geocode cache is deliberately NOT backed up (regenerable, and large). So the moment new data exists
 * is right after an extract, which is where the CLI calls this from.
 *
 * FAILURE POSTURE: never fatal. A network failure must not fail an extract that already succeeded, so
 * this reports loudly and exits non-zero only when run directly. Same posture as
 * scripts/lib/revalidate-directory.mjs, which prints an ACTION REQUIRED block rather than throwing.
 *
 * Usage:
 *   node scripts/backup-metro-research.mjs            # commit + push
 *   node scripts/backup-metro-research.mjs --no-push  # commit only
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const REPO = 'metro-research'

function git(args, { quiet = false } = {}) {
  return execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  })
}

export function backupMetroResearch({ push = true, label = null } = {}) {
  if (!existsSync(REPO)) {
    return { ok: false, reason: `${REPO}/ does not exist. If a "git clean" removed the junction, recreate it:\n  cmd /c mklink /J metro-research ..\\joinzer-metro-research` }
  }
  if (!existsSync(`${REPO}/.git`)) {
    return { ok: false, reason: `${REPO}/ is not a git repository — the backup cannot be pushed. Expected a clone of the private joinzer-metro-research repo.` }
  }

  try {
    const status = git(['status', '--porcelain'], { quiet: true }).trim()
    if (!status) return { ok: true, noop: true, reason: 'backup already up to date — nothing to commit' }

    const changed = status.split('\n').length
    git(['add', '-A'], { quiet: true })
    const msg = label
      ? `Research artifacts: ${label}`
      : `Research artifacts backup — ${changed} path(s) changed`
    git(['commit', '-m', msg], { quiet: true })

    if (!push) return { ok: true, pushed: false, changed, reason: `committed ${changed} path(s); push skipped (--no-push)` }

    git(['push'], { quiet: true })
    return { ok: true, pushed: true, changed, reason: `committed and pushed ${changed} path(s)` }
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim().split('\n').slice(-3).join(' | ')
    return { ok: false, reason: detail || String(err) }
  }
}

/** Prints the result in the house ACTION REQUIRED style. Returns true when the backup is safe. */
export function reportBackup(result) {
  if (result.ok) {
    console.log(`\nmetro-research backup: ${result.reason}`)
    return true
  }
  console.log('\n' + '='.repeat(78))
  console.log('ACTION REQUIRED — the metro-research backup did NOT update.')
  console.log(`  ${result.reason}`)
  console.log('  The research artifacts on disk are now the ONLY copy. Recover with:')
  console.log('    node scripts/backup-metro-research.mjs')
  console.log('='.repeat(78))
  return false
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const push = !process.argv.includes('--no-push')
  const ok = reportBackup(backupMetroResearch({ push }))
  process.exit(ok ? 0 : 1)
}
