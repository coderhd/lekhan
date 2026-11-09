import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Synthetic local Supabase responses exercise the real dashboard without a
// logged-in profile or mutations to a user's workspace.
const user = { id: '00000000-0000-0000-0000-000000000281', email: 'layout@example.test', user_metadata: { full_name: 'Layout Test' }, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' }
const workspace = { id: 'ws-layout', owner_id: user.id, name: 'Layout fixture' }
const now = new Date()
const title = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const dailyPage = { id: 'daily-layout', workspace_id: workspace.id, owner_id: user.id, title, properties: { daily: true }, page_tags: [{ tag: 'daily' }], searchable_text: Array.from({ length: 7 }, (_, i) => `Capture ${i} ${'long preview '.repeat(20)} #inbox`).join('\n'), created_at: now.toISOString(), updated_at: now.toISOString(), is_deleted: false }

for (const width of [320, 390, 768, 1280]) {
 for (const state of ['empty', 'populated', 'error']) {
  test(`${width}px ${state}: no overflow, stable inbox and responsive controls`, async ({ page }) => {
   await page.setViewportSize({ width, height: 900 })
   await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'synthetic-layout-token', refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }))
    const entries: number[] = []
    Object.assign(window, { layoutShifts: entries })
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) entries.push((entry as PerformanceEntry & { value: number }).value) }).observe({ type: 'layout-shift', buffered: true })
   }, { user })
   const errors: string[] = []
   const networkFailures: Array<{ url: string, method: string, failure?: string, status?: number }> = []
   // Do not persist query strings or headers, which could contain credentials.
   const safeUrl = (value: string) => { const url = new URL(value); return url.origin + url.pathname }
   page.on('requestfailed', request => networkFailures.push({ url: safeUrl(request.url()), method: request.method(), failure: request.failure()?.errorText }))
   page.on('response', response => { if (response.status() >= 400) networkFailures.push({ url: safeUrl(response.url()), method: response.request().method(), status: response.status() }) })
   page.on('pageerror', error => errors.push(error.message))
   let release!: () => void
   const pending = new Promise<void>(resolve => { release = resolve })
   await page.route('http://127.0.0.1:54321/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/auth/')) return route.fulfill({ json: user })
    const table = url.pathname.split('/').pop()
    let data: unknown = []
    if (table === 'workspaces') data = workspace
    if (table === 'workspace_plans') data = { workspace_id: workspace.id, tier: 'free', gateway: 'none' }
    if (table === 'pages') {
     if (url.searchParams.get('title')?.split(',').length === 14) {
      await pending
      if (state === 'error') return route.fulfill({ status: 500, json: { message: 'Synthetic inbox failure' } })
      data = state === 'populated' ? [dailyPage] : []
     } else data = [dailyPage]
    }
    return route.fulfill({ json: data })
   })
   await page.goto('/')
   const inbox = page.getByRole('region', { name: 'Inbox', exact: true })
   // Save both states before assertions, including on a settled-state timeout.
   const capture = async (phase: string) => {
    const geometry = await inbox.evaluate(section => {
     const bounds = (element: Element | null) => {
      if (!element) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
     }
     const header = section.firstElementChild
     const preview = header?.nextElementSibling ?? null
     return {
      inbox: bounds(section), header: bounds(header), heading: bounds(header?.firstElementChild ?? null),
      badge: bounds(header?.querySelector('[aria-live]') ?? null),
      openButton: bounds(header?.querySelector('button') ?? null),
      preview: bounds(preview), previewContent: bounds(preview?.firstElementChild ?? null),
      downstream: bounds(section.nextElementSibling ?? section.parentElement?.nextElementSibling ?? null),
      cls: (window as unknown as { layoutShifts: number[] }).layoutShifts.reduce((a, b) => a + b, 0),
     }
    })
    const measurement = { width, state, phase, ...geometry }
    await writeFile(test.info().outputPath(`${phase}.json`), JSON.stringify(measurement, null, 2))
    await page.screenshot({ path: test.info().outputPath(`${phase}.png`), fullPage: true })
    console.log(JSON.stringify(measurement))
    return geometry
   }
   try {
    await inbox.getByRole('status').waitFor()
   } catch (error) {
    await writeFile(test.info().outputPath('cold-boot.json'), JSON.stringify({ width, state, url: safeUrl(page.url()), networkFailures, pageErrors: errors }, null, 2))
    await page.screenshot({ path: test.info().outputPath('cold-boot.png'), fullPage: true })
    throw error
   }
   await page.evaluate(() => document.fonts.ready)
   const loadingText = await inbox.getByRole('status').textContent()
   const before = await inbox.boundingBox()
   const shiftsBefore = (await capture('loading')).cls
   release()
   try {
    const settled = state === 'populated' ? inbox.getByRole('list', { name: 'Pending captures' }) : state === 'empty' ? inbox.getByText('Inbox zero') : inbox.getByRole('button', { name: 'Try again' })
    await settled.waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
   } finally {
    await capture('settled')
   }
   expect(loadingText).toContain('Loading captures')
   if (state === 'populated') {
    await expect(inbox.getByRole('list', { name: 'Pending captures' }).getByRole('listitem')).toHaveCount(5)
    await expect(inbox.getByText('+2 more pending')).toBeVisible()
   }
   if (state === 'empty') await expect(inbox.getByText('Inbox zero')).toBeVisible()
   if (state === 'error') await expect(inbox.getByRole('button', { name: 'Try again' })).toBeVisible()
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
   const after = await inbox.boundingBox()
   expect(after!.height).toBe(before!.height)
   expect(after!.y).toBe(before!.y)
   const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, headerHeight: document.querySelector('header')!.getBoundingClientRect().height, cls: (window as unknown as { layoutShifts: number[] }).layoutShifts.reduce((a, b) => a + b, 0) }))
   expect(geometry.scrollWidth).toBe(width)
   expect(geometry.cls).toBeLessThanOrEqual(0.1)
   expect(geometry.cls - shiftsBefore).toBeLessThan(0.001)
   const header = page.getByRole('banner')
   for (const button of await header.getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await button.click({ trial: true })
   }
   const start = await page.evaluate(() => performance.now())
   await header.getByRole('button', { name: 'Quick capture', exact: true }).click()
   await expect(page.getByRole('dialog')).toBeVisible()
   await expect(page.getByPlaceholder('Capture anything… #tag and [[page]] work here')).toBeFocused()
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
   const interactionMs = await page.evaluate(start => performance.now() - start, start)
   expect(interactionMs).toBeLessThan(1000)
   expect(errors).toEqual([])
   console.log(JSON.stringify({ width, state, ...geometry, inboxHeight: after!.height, inboxDelta: after!.height - before!.height, inboxCls: geometry.cls - shiftsBefore, interactionMs }))
   await page.keyboard.press('Escape')
  })
 }
}
