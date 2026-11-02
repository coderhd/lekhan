import { test, expect, type Page } from '@playwright/test'

/**
 * DN-T2 quick capture e2e (epic #39).
 *
 * Runs against the real dev stack (Next.js + Supabase + the y-websocket sync
 * server in `NEXT_PUBLIC_WS_URL`) because the whole point is the CRDT append.
 * Opt in with credentials:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=… npx playwright test quick-capture
 *
 * The specs are skipped when the credentials are absent so the default suite
 * stays runnable without seeded accounts.
 */
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+C' : 'Control+Shift+C'
const CAPTURE_TIMEOUT = 20_000

test.describe('Quick capture', () => {
	test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run the capture e2e.')

	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('captures into today\'s daily page as a timestamped #inbox bullet and appends a second below it', async ({ page }) => {
		const marker = `e2e-capture-${Date.now()}`

		await capture(page, `${marker}-one`)
		await openCapturedPage(page)
		await expect(page.getByText(`${marker}-one`, { exact: false })).toBeVisible({ timeout: CAPTURE_TIMEOUT })

		// The visible bullet carries the local time and the #inbox marker.
		const firstBullet = page.getByText(`${marker}-one`, { exact: false })
		const bulletText = (await firstBullet.textContent()) ?? ''
		expect(bulletText).toMatch(/\b\d{2}:\d{2}\b/)
		expect(bulletText).toContain('#inbox')

		await page.goto('/')
		await capture(page, `${marker}-two`)
		await openCapturedPage(page)

		const one = page.getByText(`${marker}-one`, { exact: false })
		const two = page.getByText(`${marker}-two`, { exact: false })
		await expect(two).toBeVisible({ timeout: CAPTURE_TIMEOUT })
		expect(await two.boundingBox()).not.toBeNull()
		expect((await one.boundingBox())!.y).toBeLessThan((await two.boundingBox())!.y)
	})

	test('a capture on device A is visible on device B without a reload', async ({ page, browser }) => {
		const marker = `e2e-live-${Date.now()}`

		// Device B opens today's daily page first, so it is subscribed to the room.
		const otherContext = await browser.newContext()
		const deviceB = await otherContext.newPage()
		await login(deviceB)
		await openTodayDailyPage(deviceB)
		await expect(deviceB.locator('.ProseMirror')).toBeVisible({ timeout: CAPTURE_TIMEOUT })

		// Device A captures from the dashboard.
		await capture(page, `${marker}-live`)

		// Device B receives the CRDT update live — no navigation, no reload.
		await expect(deviceB.getByText(`${marker}-live`, { exact: false })).toBeVisible({ timeout: CAPTURE_TIMEOUT })
		await otherContext.close()
	})
})

async function login (page: Page) {
	await page.goto('/login')
	await page.fill('input[placeholder="you@example.com"]', EMAIL!)
	await page.fill('input[placeholder="••••••••"]', PASSWORD!)
	await Promise.all([
		page.waitForURL('/'),
		page.click('button[type="submit"]'),
	])
	await expect(page.getByRole('button', { name: 'Quick capture' })).toBeVisible()
}

async function capture (page: Page, text: string) {
	await page.keyboard.press(SHORTCUT)
	const input = page.getByLabel('Capture text')
	await expect(input).toBeVisible()
	await input.fill(text)
	await input.press('Enter')
	await expect(page.getByText(/Captured to/)).toBeVisible({ timeout: CAPTURE_TIMEOUT })
}

async function openCapturedPage (page: Page) {
	await page.getByRole('button', { name: 'Open' }).last().click()
	await page.waitForURL(/\/page\//)
}

async function openTodayDailyPage (page: Page) {
	await page.getByRole('button', { name: /today.*daily page/i }).click()
	await page.waitForURL(/\/page\//)
}
