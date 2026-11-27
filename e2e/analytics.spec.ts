import { test, expect, type Page } from '@playwright/test'
import { gunzipSync } from 'node:zlib'

test.use({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
})

function queuedEvents(page: Page) {
  return page.evaluate(() => {
    const queue = (window as Window & { dataLayer?: unknown[][] }).dataLayer ?? []
    return queue.map(item => Array.from(item)).filter(item => item[0] === 'event')
      .map(([, name, payload]) => ({ name, payload }))
  })
}

test('only shares coarse product events after opt-in and stops after revocation', async ({ page }) => {
  const id = process.env.NEXT_PUBLIC_GA4_ID
  test.skip(!id || !/^G-[A-Z0-9]+$/.test(id), 'Set NEXT_PUBLIC_GA4_ID to enable the analytics fixture.')
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
  })
  let loads = 0
  const productEvents: { event: string; properties: Record<string, unknown> }[] = []
  await page.route('https://www.googletagmanager.com/**', async route => {
    loads++
    await route.fulfill({ contentType: 'application/javascript', body: '' })
  })
  await page.route('https://eu-assets.i.posthog.com/**', async route => {
    await route.fulfill({ json: { hasFeatureFlags: true } })
  })
  await page.route('https://eu.i.posthog.com/**', async route => {
    const body = route.request().postDataBuffer()
    const path = new URL(route.request().url()).pathname
    if (body && /\/e\/?$/.test(path)) {
      const text = (body[0] === 31 && body[1] === 139 ? gunzipSync(body) : body).toString()
      productEvents.push(...JSON.parse(text).batch)
      await route.fulfill({ json: { status: 1 } })
      return
    }
    if (/\/flags\/?$/.test(path)) {
      await route.fulfill({ json: { flags: { 'tier-gate-tier': { enabled: true, variant: 'free' } } } })
      return
    }
    await route.fulfill({ json: { status: 1 } })
  })
  await page.goto('/workspace?private=secret-token')
  const newPage = page.getByRole('button', { name: 'New page', exact: true })
  const consent = page.getByRole('checkbox', { name: 'Share usage analytics' })
  await expect(consent).not.toBeChecked()
  await newPage.click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  expect(loads).toBe(0)
  expect(await queuedEvents(page)).toEqual([])
  expect(productEvents).toEqual([])
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lekhan:tier-gates:personal')))
    .toContain('"tier-gate-tier":"free"')

  await consent.check()
  await newPage.click()
  await expect.poll(async () => (await queuedEvents(page)).map(event => event.name)).toContain('page_created')
  const title = page.getByRole('textbox', { name: 'Page title' })
  await title.fill('Private title')
  const body = page.getByRole('textbox', { name: 'Page content' })
  await body.fill('Private body')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source' })
  await source.fill('Private body with a [[Private linked title]]')
  await source.fill('Edited body with a [[Private linked title]]')
  const importFile = page.locator('input[type=file]').first()
  await importFile.setInputFiles({ name: 'Private file.md', mimeType: 'text/markdown', buffer: Buffer.from('# Unshared title') })
  await expect.poll(async () => (await queuedEvents(page)).map(event => event.name)).toContain('import_completed')
  const events = await queuedEvents(page)
  const byName = Object.fromEntries(events.map(event => [String(event.name), event.payload]))
  expect(byName.page_created).toMatchObject({ is_first: true, page_referrer: '' })
  expect(byName.link_created).toMatchObject({ is_first: true })
  expect(byName.import_completed).toMatchObject({ source: 'markdown', pages_bucket: '1' })
  expect(events.filter(event => event.name === 'daily_active_edit')).toHaveLength(1)
  expect(JSON.stringify(events)).not.toMatch(/secret-token|Private|Unshared/)
  await expect.poll(() => loads).toBe(1)
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    await expect.poll(() => productEvents.map(event => event.event)).toContain('import_completed')
    expect(productEvents.find(event => event.event === 'import_completed')?.properties).toMatchObject(
      byName.import_completed as Record<string, unknown>,
    )
    expect(productEvents.every(event => !event.event.startsWith('$'))).toBe(true)
    expect(JSON.stringify(productEvents)).not.toMatch(/secret-token|Private|Unshared|\$current_url|\$referrer/)
  }

  // Open the same workspace under a second tab before changing consent.
  const billingConsent = 'lekhan:usage-analytics:billing-consent'
  const billingRevocation = 'lekhan:usage-analytics:billing-revocation'
  const token = '19a47a11-0a56-4d36-8597-fdc1e7ef755e'
  const revocations: unknown[] = []
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: billingConsent, value: token })
  await page.context().route('**/api/analytics/revoke', async route => {
    revocations.push(route.request().postDataJSON())
    await route.fulfill({ status: 204 })
  })
  const second = await page.context().newPage()
  await second.route('https://www.googletagmanager.com/**', route => route.fulfill({ body: '' }))
  await second.goto('/workspace')
  const secondConsent = second.getByRole('checkbox', { name: 'Share usage analytics' })
  await expect(secondConsent).toBeChecked()
  await consent.uncheck()
  await expect(secondConsent).not.toBeChecked()
  await expect.poll(() => revocations).toContainEqual({ token })
  await expect.poll(() => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [billingConsent, billingRevocation]))
    .toEqual([null, null])
  await expect.poll(() => page.evaluate(key => Reflect.get(window, key), 'ga-disable-' + id)).toBe(true)
  await newPage.click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  expect(await queuedEvents(page)).toEqual(events)
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    expect(productEvents.filter(event => event.event === 'page_created')).toHaveLength(1)
  }
  await second.close()
  await page.goto('/about?private=secret-token')
  await consent.check()
  await expect.poll(() => queuedEvents(page)).toEqual([
    { name: 'page_view', payload: { page_location: new URL('/about', page.url()).href, page_title: 'Lekhan', page_referrer: '' } },
  ])
  await page.context().setOffline(true)
  expect(await page.evaluate(() => localStorage.getItem('lekhan:tier-gates:personal'))).toContain('"tier-gate-tier":"free"')
})
