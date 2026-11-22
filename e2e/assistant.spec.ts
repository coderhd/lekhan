import { expect, test } from '@playwright/test'

test('saves an encrypted provider connection and shares page content only by choice', async ({ page }) => {
  const sent: unknown[] = []
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    sent.push(route.request().postDataJSON())
    await route.fulfill({
      headers, contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"A short draft."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    })
  })
  await page.goto('/workspace')
  const open = page.getByRole('button', { name: 'Writing assistant' })
  const dialog = page.getByRole('dialog', { name: 'Writing assistant' })
  await open.click()
  await dialog.getByLabel('Passphrase').fill('private testing passphrase')
  await dialog.getByRole('button', { name: 'Create provider vault' }).click()
  await dialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai')
  await dialog.getByLabel('API key', { exact: true }).fill('fixture-key-never-store-in-clear')
  await dialog.getByLabel('Model ID').fill('fixture-model')
  await dialog.getByRole('button', { name: 'Save connection' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Connection saved.')
  const stored = await page.evaluate(() => localStorage.getItem('lekhan:provider-vault:v1'))
  expect(stored).toMatch(/^v1\./)
  expect(stored).not.toContain('fixture-key-never-store-in-clear')

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await open.click()
  await dialog.getByLabel('Passphrase').fill('private testing passphrase')
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  await dialog.getByLabel('Prompt').fill('Draft something short.')
  await dialog.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(dialog.getByText('A short draft.', { exact: true })).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(JSON.stringify(sent)).not.toContain('Field guide')

  await dialog.getByLabel('Prompt').fill('Use the page now.')
  await dialog.getByLabel('Include this page with my request').check()
  await dialog.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Insert in page' })).toHaveCount(2)
  expect(JSON.stringify(sent[1])).toContain('Field guide')
  await dialog.getByRole('button', { name: 'Insert in page' }).last().click()
  await expect(page.getByRole('textbox', { name: 'Page content' })).toContainText('A short draft.')
})
