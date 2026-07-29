import { defineConfig } from 'vitest/config'

// The repo separates the two test runners by filename convention:
//   *.test.ts  -> unit tests, run by vitest
//   *.spec.ts  -> Playwright e2e specs (tests/e2e/), run by playwright.config.ts
// Vitest's default include glob matches both, so it was collecting the Playwright
// specs and failing 10 files at collection. That noise masks genuine file-level
// failures, which is the reason this config exists.
//
// Include-by-convention rather than exclude-by-path: a new e2e spec added anywhere
// in the tree is never collected, and moving a directory needs no config edit.
export default defineConfig({
  test: {
    include: ['**/*.test.{ts,tsx}'],
  },
})
