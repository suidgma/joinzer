/**
 * Prints every test the CI run SKIPPED, by name, with the reason.
 *
 * WHY THIS EXISTS. CI runs on ubuntu-latest to match Vercel's build platform, and a handful of
 * tests are guarded with `skipIf(process.platform !== 'win32')` because they exercise Windows
 * junction semantics that have no analogue on Linux. That is a deliberate trade — but a silently
 * skipped test is worse than a missing one, because the run still reports green and a reader
 * reasonably assumes everything ran.
 *
 * So the skip is made LOUD: this names each skipped test in the log and in the run's summary panel,
 * so anyone reading a green run knows exactly what it did and did not check.
 *
 * It is derived from vitest's own JSON report rather than a hand-maintained list, so it cannot go
 * stale — guard a new test tomorrow and it appears here without anyone remembering to update it.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const REPORT = process.argv[2] ?? 'vitest-report.json'

// A missing report must NOT read as "nothing was skipped" — that is the exact failure this script
// exists to prevent, so it fails loudly instead of printing a reassuring zero.
if (!existsSync(REPORT)) {
  console.error(
    `No vitest report at ${REPORT}.\n` +
      `Cannot say what was skipped, and "cannot say" must not look like "nothing was skipped".`,
  )
  process.exit(1)
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'))

// jest-compatible shape. Vitest spells a skipped test 'pending'; accept the neighbours too so a
// reporter change cannot quietly zero this out.
const SKIPPED = new Set(['pending', 'skipped', 'todo', 'disabled'])

// Report repo-relative paths. Strip the checkout root rather than matching a repo name — the
// runner's path (/home/runner/work/joinzer/joinzer) and a local worktree (…/joinzer-ci) differ,
// and a name-based regex silently leaves absolute paths in the output on one of them.
const ROOT = (process.env.GITHUB_WORKSPACE ?? process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
const rel = (p) => {
  const norm = String(p).replace(/\\/g, '/')
  return norm.startsWith(`${ROOT}/`) ? norm.slice(ROOT.length + 1) : norm
}

const skipped = []
for (const file of report.testResults ?? []) {
  for (const test of file.assertionResults ?? []) {
    if (SKIPPED.has(test.status)) skipped.push({ file: rel(file.name), name: test.fullName ?? test.title })
  }
}

const lines = []
if (skipped.length === 0) {
  lines.push(`Every test ran on this runner (${process.platform}) — nothing was skipped.`)
} else {
  lines.push(`${skipped.length} test(s) SKIPPED on this runner (${process.platform}).`)
  lines.push('')
  lines.push('These are guarded by `skipIf(process.platform !== \'win32\')`. They build real NTFS')
  lines.push('junctions with `cmd /c mklink /J`, or assert Windows backslash path handling — neither')
  lines.push('primitive exists on Linux, so there is nothing meaningful to run here. They are')
  lines.push("DEVELOPER TOOLING (worktree bootstrap/teardown), not shipped app code, and they still")
  lines.push("run on the Windows machines where that behaviour actually matters.")
  lines.push('')
  lines.push('The full reasoning sits in a comment above each guard.')
  lines.push('')
  const byFile = new Map()
  for (const s of skipped) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s.name])
  for (const [file, names] of [...byFile].sort()) {
    lines.push(`  ${file}`)
    for (const name of names) lines.push(`    - ${name}`)
  }
}

const text = lines.join('\n')
console.log(text)

// Also surface it on the run's summary panel, so it is visible without opening the log.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Skipped tests\n\n\`\`\`\n${text}\n\`\`\`\n`,
  )
}
