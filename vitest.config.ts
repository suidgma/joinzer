import { defineConfig, configDefaults } from 'vitest/config'

// The repo separates the two test runners by filename convention:
//   *.test.ts  -> unit tests, run by vitest
//   *.spec.ts  -> Playwright e2e specs (tests/e2e/), run by playwright.config.ts
// Vitest's default include glob matches both, so it was collecting the Playwright
// specs and failing 10 files at collection. That noise masks genuine file-level
// failures, which is the reason this config exists.
//
// Include-by-convention rather than exclude-by-path: a new e2e spec added anywhere
// in the tree is never collected, and moving a directory needs no config edit.
//
// Git worktrees are the one case the convention cannot solve. Sessions isolate their
// work in worktrees under .claude/worktrees/, and a worktree is a full second copy of
// the tree, so its test files match the include glob and get collected alongside the
// real suite. They are legitimately named *.test.ts — they just belong to another
// branch. Left alone this inflates the gate (74 real files read as 289 with three
// worktrees checked out), doubles runtime, and — the part that actually bites — lets a
// failing test on an unrelated branch turn the gate red for a diff that never touched it.
//
// configDefaults.exclude MUST be spread: supplying `exclude` REPLACES vitest's default
// list rather than extending it, so omitting it would drop the node_modules exclusion
// and pull in every dependency's own tests.
export default defineConfig({
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
