import { defineConfig, devices } from '@playwright/test'

/**
 * Figure generation, kept out of the normal test run: it writes into paper/figures/
 * and takes minutes on a full BioGRID release.
 */
export default defineConfig({
  testDir: './tests/figures',
  workers: 1,
  reporter: 'list',
  timeout: 900_000,
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 300_000,
  },
})
