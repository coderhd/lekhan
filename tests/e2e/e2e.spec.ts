import { test, expect } from '@playwright/test'

test.describe('Lekhan Collaborative Workspace E2E Flow', () => {
	test('should log in, load dashboard, and create a new document successfully', async ({ page }) => {
		// Log page console messages
		page.on('console', msg => console.log('PAGE LOG:', msg.text()))

		const email = 'harshdave1095@gmail.com'
		const password = 'testpassword123!'

		// 1. Navigate to login page
		await page.goto('http://localhost:3000/login')
		await expect(page.locator('h2')).toContainText('Welcome to Lekhan')

		// 2. Fill in sign-in credentials
		await page.fill('input[placeholder="you@example.com"]', email)
		await page.fill('input[placeholder="••••••••"]', password)

		// Submit the form
		await Promise.all([
			page.waitForURL('http://localhost:3000/'),
			page.click('button[type="submit"]')
		])

		// 3. Verify we are on the dashboard
		await expect(page.locator('header')).toContainText('Lekhan')
		await expect(page.locator('h2:has-text("My Documents")')).toBeVisible()

		// 4. Create a new document (runs on the real Supabase instance)
		await page.click('button:has-text("New Document")')

		// 5. Verify we are redirected to the editor workspace
		await page.waitForURL(/\/doc\/[a-f0-9-]+/)
		await expect(page.locator('input[placeholder="Untitled Document"]')).toBeVisible()
		
		// Verify editor toolbar elements are present
		await expect(page.locator('button[title="Bold"]')).toBeVisible()
		await expect(page.locator('button[title="Italic"]')).toBeVisible()
	})
})
