import { defineConfig } from '@playwright/test'

const baseURL = 'http://localhost:3182'
const authFixtureURL = 'http://127.0.0.1:3183'
const externalAuth = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

export default defineConfig({
  testDir: './e2e',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: externalAuth ? {
    command: 'npm run dev -- --port 3182',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  } : [
    {
      command: 'node e2e/auth-fixture.mjs',
      url: `${authFixtureURL}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -- --port 3182',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: authFixtureURL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_fixture',
      },
    },
  ],
})
