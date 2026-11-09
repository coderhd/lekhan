import { defineConfig } from '@playwright/test'

// Separate from the authenticated E2E suite: this server uses synthetic API
// configuration and never needs user credentials or a running Supabase service.
const production = process.env.DASHBOARD_QA_MODE === 'production'
const port = production ? 3282 : 3281
const baseURL = `http://localhost:${port}`
export default defineConfig({
	testDir: './tests/e2e',
	testMatch: 'dashboard-cls.qa.ts',
	workers: 1,
	timeout: 90000,
	reporter: 'list',
	preserveOutput: 'always',
	outputDir: production ? 'test-results/dashboard-qa-production' : 'test-results/dashboard-qa-development',
	use: { headless: true, baseURL },
	webServer: {
		command: production ? `npm start -- --port ${port}` : `npm run dev -- --webpack --port ${port}`,
		url: baseURL,
		reuseExistingServer: false,
		env: {
			WATCHPACK_POLLING: 'true',
			NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
			NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-qa-key',
		},
	},
})
