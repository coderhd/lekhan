import { expect, test } from '@playwright/test'

test('account links fail closed when the backend has not been configured', async ({ page }) => {
  await page.goto('/login?error=confirm')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'couldn’t be verified' })).toBeVisible()
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  if (!configured) {
    await expect(page.getByRole('status').filter({ hasText: 'Account access is unavailable here.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  }
  await page.getByRole('link', { name: 'Open the local workspace' }).click()
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field guide')
})

test('a password reset requires an authenticated session', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page).toHaveURL(/\/login\?error=confirm$/)
  await expect(page.getByLabel('New password')).toHaveCount(0)
})
