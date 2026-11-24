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

test('private cloud routes and sync tickets require an authenticated session', async ({ page }) => {
  const id = 'e6a3a67a-bf74-4f17-b013-95eb59b2e937'
  await page.goto('/doc/' + id)
  await expect(page).toHaveURL('/page/' + id)
  await expect(page.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  await page.goto('/cloud')
  await expect(page).toHaveURL(/\/login$/)
  const ticket = await page.request.get('/api/sync/session?pageId=' + id)
  expect(ticket.status()).toBe(401)
  expect(ticket.headers()['cache-control']).toContain('no-store')
  const search = await page.request.get('/api/search?q=private')
  expect(search.status()).toBe(401)
  expect(search.headers()['cache-control']).toContain('no-store')
  const vault = await page.request.get('/api/ai/vault', { headers: { 'X-Lekhan-Account': id } })
  expect(vault.status()).toBe(401)
  expect(vault.headers()['cache-control']).toContain('no-store')
  const rejectedBackup = await page.request.put('/api/ai/vault', {
    headers: { 'X-Lekhan-Account': id, Origin: 'https://unrelated.example' },
    data: { envelope: 'invalid', previous: null },
  })
  expect(rejectedBackup.status()).toBe(403)
  const imported = await page.request.post('/api/import', { data: { importId: id, index: 0, pages: [] } })
  expect(imported.status()).toBe(401)
  expect(imported.headers()['cache-control']).toContain('no-store')
  const reconcile = await page.request.get('/api/cron/billing-reconcile')
  expect(reconcile.status()).toBe(401)
  expect(reconcile.headers()['cache-control']).toContain('no-store')
})

test('an invitation survives the sign-in and sign-up screens', async ({ page }) => {
  const invite = 'e6a3a67a-bf74-4f17-b013-95eb59b2e937'
  await page.goto('/invite/' + invite)
  await expect(page).toHaveURL('/login?invite=' + invite)
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page).toHaveURL('/signup?invite=' + invite)
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/login?invite=' + invite)
})

test('a referral and an invitation survive switching account forms together', async ({ page }) => {
  const invite = 'e6a3a67a-bf74-4f17-b013-95eb59b2e937'
  const ref = '24f66e78-ba69-42c3-a063-38e03bdb0891'
  const query = new URLSearchParams({ invite, ref })
  await page.goto('/login?' + query)
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page).toHaveURL('/signup?' + query)
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/login?' + query)
})
