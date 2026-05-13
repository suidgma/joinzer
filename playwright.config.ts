import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'

config({ path: '.env.test' })

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: 'list',
  use: {
    // Port 3001 for test server — keeps dev server on 3000 free
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Production server on port 3001 — no HMR chunk invalidation.
  // Run `npm run build` before `npm test` (or use `npm run test:e2e`).
  // reuseExistingServer: true allows local iteration if `next start --port 3001` is already running.
  webServer: {
    command: 'npx next start --port 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
