import { expect, test, type Page } from '@playwright/test'
import * as Y from 'yjs'
import { authCookieName, defaultSubject, mintAuthCookies, signInContext } from './auth'

const subject = defaultSubject
const alphaId = '11111111-1111-4111-8111-111111111111'
const betaId = '22222222-2222-4222-8222-222222222222'

async function authCookies(baseURL: string) {
  return mintAuthCookies(baseURL, { subject })
}

function configuredCookieName() {
  return authCookieName()
}

function encodedDocUpdate(markdown: string) {
  const doc = new Y.Doc()
  doc.getMap('lekhan').set('mode', 'source')
  doc.getText('source').insert(0, markdown)
  return Array.from(Y.encodeStateAsUpdate(doc))
}

async function seedOfflineCloudCopies(page: Page) {
  const alphaMarkdown = '# Alpha Note\n\nJump to [[Beta Note#Details]] when offline.'
  const betaMarkdown = '# Beta Note\n\n## Details\n\nOffline anchor paragraph for navigation parity.'
  const alphaUpdate = encodedDocUpdate(alphaMarkdown)
  const betaUpdate = encodedDocUpdate(betaMarkdown)

  await page.evaluate(async ({ account, alpha, beta }) => {
    function openDb(name: string, version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version)
        req.onupgradeneeded = () => upgrade?.(req.result)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }

    const searchDb = await openDb('lekhan-cloud-search', 1, db => {
      db.createObjectStore('pages', { keyPath: ['subject', 'id'] }).createIndex('subject', 'subject')
    })
    await new Promise<void>((resolve, reject) => {
      const tx = searchDb.transaction('pages', 'readwrite')
      const store = tx.objectStore('pages')
      store.put({
        subject: account,
        id: alpha.id,
        title: 'Alpha Note',
        markdown: alpha.markdown,
        properties: {},
        updatedAt: '2026-11-26T10:00:00.000Z',
        role: 'editor',
      })
      store.put({
        subject: account,
        id: beta.id,
        title: 'Beta Note',
        markdown: beta.markdown,
        properties: {},
        updatedAt: '2026-11-26T09:00:00.000Z',
        role: 'editor',
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    searchDb.close()

    for (const entry of [alpha, beta]) {
      const yDb = await openDb(`lekhan:cloud:${account}:${entry.id}`, 1, db => {
        db.createObjectStore('updates', { autoIncrement: true })
        db.createObjectStore('custom')
      })
      await new Promise<void>((resolve, reject) => {
        const tx = yDb.transaction(['updates', 'custom'], 'readwrite')
        tx.objectStore('updates').add(new Uint8Array(entry.update))
        tx.objectStore('custom').put('write', 'last-checked-permission')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      yDb.close()
    }
  }, {
    account: subject,
    alpha: { id: alphaId, markdown: alphaMarkdown, update: alphaUpdate },
    beta: { id: betaId, markdown: betaMarkdown, update: betaUpdate },
  })
}

test('navigates saved cloud copies offline with SPA links, Cmd+K search, wikilinks, and browser history', async ({ page, context }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3182'
  await page.route('**/api/**', route => route.abort('internetdisconnected'))
  await context.addCookies(await authCookies(baseURL))
  await page.goto('/cloud-offline')
  await seedOfflineCloudCopies(page)

  await page.reload()
  await expect(page.getByRole('link', { name: 'Alpha Note' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Offline notebook' })).toHaveAttribute('href', '/workspace-offline')

  await page.evaluate(() => {
    (window as Window & { __offlineNavToken?: string }).__offlineNavToken = 'kept'
  })

  await page.getByRole('link', { name: 'Alpha Note' }).click()
  await expect(page).toHaveURL('/cloud-offline?page=' + alphaId)
  await expect(page.getByRole('heading', { name: 'Alpha Note' })).toBeVisible()
  await expect(page.getByLabel('Markdown source')).toContainText('Jump to [[Beta Note#Details]]')
  expect(await page.evaluate(() => (window as Window & { __offlineNavToken?: string }).__offlineNavToken)).toBe('kept')

  await page.keyboard.press('Control+k')
  const searchBox = page.getByRole('combobox', { name: 'Search pages' })
  await searchBox.fill('anchor paragraph')
  await expect(page.getByRole('option', { name: /Beta Note/ })).toBeVisible()
  await searchBox.press('Enter')
  await expect(page).toHaveURL('/cloud-offline?page=' + betaId)
  await expect(page.getByRole('heading', { name: 'Beta Note' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL('/cloud-offline?page=' + alphaId)
  await expect(page.getByRole('heading', { name: 'Alpha Note' })).toBeVisible()

  await page.getByText('Page links (1)').click()
  await page.getByRole('button', { name: 'Beta Note#Details' }).click()
  await expect(page).toHaveURL(`/cloud-offline?page=${betaId}#heading=Details`)
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL('/cloud-offline?page=' + alphaId)
  await page.goBack()
  await expect(page).toHaveURL('/cloud-offline')
  await expect(page.getByRole('link', { name: 'Alpha Note' })).toBeVisible()
})

test('links offline workspace to saved cloud copies and searches cached cloud pages offline', async ({ page, context }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3182'
  const cookieName = configuredCookieName()
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) return route.abort('internetdisconnected')
    return route.continue()
  })
  await context.addCookies(await authCookies(baseURL))
  await page.goto('/cloud-offline')
  await seedOfflineCloudCopies(page)

  await page.goto('/workspace-offline')
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field guide')
  await expect(page.getByRole('link', { name: 'Open notebook online' })).toHaveAttribute('href', '/workspace')

  if (cookieName) {
    await expect(page.getByRole('link', { name: 'On this device' })).toHaveAttribute('href', '/cloud-offline')
    await page.keyboard.press('Control+k')
    await page.getByRole('button', { name: 'Cloud' }).click()
    const searchBox = page.getByRole('combobox', { name: 'Search pages' })
    await searchBox.fill('Alpha Note')
    await expect(page.getByRole('option', { name: /Alpha Note/ })).toBeVisible()
    await searchBox.press('Enter')
    await expect(page).toHaveURL('/cloud-offline?page=' + alphaId)
    await expect(page.getByRole('heading', { name: 'Alpha Note' })).toBeVisible()
  }
})

test('routes offline browser navigations through the service worker in production builds', async ({ page, context }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3182'
  await signInContext(context, baseURL, { subject })
  await page.goto('/workspace')

  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (registrations.length === 0) return false
    await navigator.serviceWorker.ready
    return true
  })
  test.skip(!registered, 'Service worker offline shell caching runs in production builds.')

  await page.waitForFunction(async () => {
    const cache = await caches.open('lekhan-offline-shell-v3')
    return Boolean(await cache.match('/cloud-offline?cached-shell') && await cache.match('/workspace-offline?cached-shell'))
  })

  await context.addCookies(await authCookies(baseURL))
  await seedOfflineCloudCopies(page)

  await context.setOffline(true)
  try {
    await page.goto('/workspace')
    await expect(page).toHaveURL(/\/workspace-offline$/)
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field guide')

    await page.goto('/cloud')
    await expect(page).toHaveURL(/\/cloud-offline$/)
    await expect(page.getByRole('link', { name: 'Alpha Note' })).toBeVisible()

    await page.goto(`/page/${betaId}#heading=Details`)
    await expect(page).toHaveURL(`/cloud-offline?page=${betaId}#heading=Details`)
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible()

    await page.goto(`/doc/${betaId}#heading=Details`)
    await expect(page).toHaveURL(`/cloud-offline?page=${betaId}#heading=Details`)
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
