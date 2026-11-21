import { defineConfig } from '@playwright/test'

const baseURL = 'http://localhost:3182'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 3182',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
