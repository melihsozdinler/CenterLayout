import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end suite. It drives the *built* app so that what CI verifies is what
 * GitHub Pages serves, and so the paper's figure-generation script (Phase 12) can
 * reuse the same harness.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // OPFS is shared per origin, so specs must not race each other over the database.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
})
