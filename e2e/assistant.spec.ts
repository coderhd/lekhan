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

test('generates selected-text suggestions with the chosen model and applies only confirmed edits', async ({ page }) => {
  const { createProviderVault } = await import('../lib/ai/vault')
  const passphrase = 'private fixture passphrase'
  const vault = await createProviderVault(passphrase, [
    { id: 'first', provider: 'openai', model: 'fixture-first', apiKey: 'fixture-key' },
    { id: 'second', provider: 'openai', model: 'fixture-second', apiKey: 'fixture-key' },
  ])
  await page.addInitScript(envelope => localStorage.setItem('lekhan:provider-vault:v1', envelope), await vault.seal())
  const sends: { model: string; messages: { role: string; content: string }[] }[] = []
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const request = route.request().postDataJSON()
    sends.push(request)
    const response = request.messages[0].content.includes('Hindi') ? 'चुना हुआ वाक्य।' : 'A revised sentence.'
    await route.fulfill({ headers, contentType: 'text/event-stream', body:
      'data: ' + JSON.stringify({ choices: [{ delta: { content: response }, finish_reason: 'stop' }] }) +
      '\n\ndata: {"usage":{"total_tokens":31}}\n\ndata: [DONE]\n\n',
    })
  })
  await page.goto('/workspace')
  const editor = page.getByRole('textbox', { name: 'Page content' })
  await editor.fill('Private sentence. Draft phrase.')
  async function selectDraft() {
    await editor.evaluate(element => {
      element.focus()
      const node = element.querySelector('p')!.firstChild!
      window.getSelection()!.setBaseAndExtent(node, 18, node, 31)
    })
  }
  await selectDraft()
  const actions = page.getByRole('group', { name: 'Writing actions' })
  await actions.getByRole('button', { name: 'Polish', exact: true }).click()
  const polish = page.getByRole('dialog', { name: 'Polish', exact: true })
  await polish.getByLabel('Passphrase').fill(passphrase)
  await polish.getByRole('button', { name: 'Unlock', exact: true }).click()
  await polish.getByRole('combobox', { name: 'Model', exact: true }).selectOption('provider:second')
  expect(sends).toHaveLength(0)
  await polish.getByRole('button', { name: 'Generate' }).click()
  await expect(polish.getByRole('region', { name: 'Suggestion' })).toHaveText('A revised sentence.')
  await expect(polish.getByText(/31 tokens · .* ms/)).toBeVisible()
  expect(sends[0].model).toBe('fixture-second')
  expect(sends[0].messages[1]).toEqual({ role: 'user', content: 'Draft phrase.' })
  expect(JSON.stringify(sends[0])).not.toContain('Private sentence.')
  await expect(editor).toHaveText('Private sentence. Draft phrase.')
  await polish.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(editor).toHaveText('Private sentence. Draft phrase.')

  await page.setViewportSize({ width: 390, height: 780 })
  await selectDraft()
  await actions.getByRole('button', { name: 'Translate', exact: true }).click()
  const translation = page.getByRole('dialog', { name: 'Translate', exact: true })
  await translation.getByLabel('Passphrase').fill(passphrase)
  await translation.getByRole('button', { name: 'Unlock', exact: true }).click()
  await translation.getByRole('combobox', { name: 'Translate into' }).selectOption('hi')
  await translation.getByRole('button', { name: 'Generate' }).click()
  await expect(translation.getByRole('region', { name: 'Suggestion' })).toHaveText('चुना हुआ वाक्य।')
  await translation.getByRole('button', { name: 'Replace selection' }).click()
  await expect(editor).toHaveText('Private sentence. चुना हुआ वाक्य।')

  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source' })
  await source.press('Control+Home')
  for (let index = 0; index < 'Private'.length; index++) await source.press('Shift+ArrowRight')
  await actions.getByRole('button', { name: 'Continue writing' }).click()
  const continuation = page.getByRole('dialog', { name: 'Continue writing' })
  await continuation.getByLabel('Passphrase').fill(passphrase)
  await continuation.getByRole('button', { name: 'Unlock', exact: true }).click()
  await continuation.getByRole('button', { name: 'Generate' }).click()
  await expect(continuation.getByRole('region', { name: 'Suggestion' })).toHaveText('A revised sentence.')
  await continuation.getByRole('button', { name: 'Insert below' }).click()
  await expect(source).toHaveValue('Private sentence. चुना हुआ वाक्य।\n\nA revised sentence.')
  expect(sends[2].messages[1]).toEqual({ role: 'user', content: 'Private' })
})

test('persists the writer’s fallback order and discloses retries before sending', async ({ page }) => {
  const { createProviderVault } = await import('../lib/ai/vault')
  const passphrase = 'fallback fixture passphrase'
  const vault = await createProviderVault(passphrase, [
    { id: 'first', provider: 'openai', model: 'fixture-primary', apiKey: 'fixture-primary-key' },
    { id: 'second', provider: 'groq', model: 'fixture-second', apiKey: 'fixture-second-key' },
    { id: 'third', provider: 'openrouter', model: 'fixture-third', apiKey: 'fixture-third-key' },
  ])
  await page.addInitScript(payload => {
    const key = 'lekhan:provider-vault:v1'
    if (!localStorage.getItem(key)) localStorage.setItem(key, payload)
  }, await vault.seal())
  const requests: { hostname: string; authorization?: string; messages: unknown }[] = []
  const hosts = ['api.openai.com', 'api.groq.com', 'openrouter.ai']
  await page.route(url => hosts.includes(url.hostname) && url.pathname.endsWith('/chat/completions'), async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const hostname = new URL(route.request().url()).hostname
    const authorization = route.request().headers().authorization
    requests.push({ hostname, authorization, messages: route.request().postDataJSON().messages })
    if (hostname === 'api.openai.com') return route.fulfill({ status: 429, headers })
    if (hostname === 'openrouter.ai') return route.fulfill({ status: 503, headers })
    await route.fulfill({ headers, contentType: 'text/event-stream', body:
      'data: {"choices":[{"delta":{"content":"Backup reply."},"finish_reason":"stop"}],"usage":{"total_tokens":19}}\n\ndata: [DONE]\n\n',
    })
  })
  await page.goto('/workspace')
  const open = page.getByRole('button', { name: 'Writing assistant' })
  const dialog = page.getByRole('dialog', { name: 'Writing assistant' })
  async function unlock() {
    await open.click()
    await dialog.getByLabel('Passphrase').fill(passphrase)
    await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible()
  }
  await unlock()
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click()
  await dialog.getByRole('button', { name: 'OpenAI fixture-primary' }).click()
  await dialog.getByText('Fallback models', { exact: true }).click()
  const add = dialog.getByRole('combobox', { name: 'Add a fallback model' })
  await add.selectOption('provider:second')
  await add.selectOption('provider:third')
  await dialog.getByRole('button', { name: 'Move OpenRouter · fixture-third up' }).click()
  await dialog.getByRole('button', { name: 'Save connection' }).click()
  await expect(dialog.getByText('Connection saved.')).toBeVisible()
  const payload = await page.evaluate(() => localStorage.getItem('lekhan:provider-vault:v1'))
  expect(payload).toMatch(/^v1\./)
  expect(payload).not.toContain('provider:third')

  await page.reload()
  await unlock()
  await expect(dialog.getByText(/OpenRouter · fixture-third → Groq · fixture-second/)).toBeVisible()
  expect(requests).toHaveLength(0)
  await dialog.getByLabel('Prompt').fill('Draft a sentence.')
  await dialog.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(dialog.getByText('Backup reply.', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Response from Groq · fixture-second.', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/19 tokens · .* ms/)).toBeVisible()
  expect(requests).toEqual([
    { hostname: 'api.openai.com', authorization: 'Bearer fixture-primary-key', messages: [{ role: 'user', content: 'Draft a sentence.' }] },
    { hostname: 'openrouter.ai', authorization: 'Bearer fixture-third-key', messages: [{ role: 'user', content: 'Draft a sentence.' }] },
    { hostname: 'api.groq.com', authorization: 'Bearer fixture-second-key', messages: [{ role: 'user', content: 'Draft a sentence.' }] },
  ])
})
