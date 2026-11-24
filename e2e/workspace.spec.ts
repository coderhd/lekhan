import { expect, test } from '@playwright/test'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { readFile } from 'node:fs/promises'

test('writes, links, finds, renames, reloads, and exports a nested page', async ({ page }) => {
  await page.goto('/workspace')
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field guide')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.locator('summary[aria-label="Page actions"]').click()
  await page.getByRole('button', { name: 'New subpage' }).click()

  const title = page.getByRole('textbox', { name: 'Page title' })
  const content = page.getByRole('textbox', { name: 'Page content' })
  await title.fill('Test notebook')
  await title.press('Enter')
  await expect(content).toBeFocused()
  await content.pressSequentially('/h2')
  await expect(page.getByRole('option', { name: 'Heading 2' })).toBeVisible()
  await content.press('Enter')
  await content.pressSequentially('Observation')
  await expect(content.getByRole('heading', { name: 'Observation' })).toBeVisible()
  await content.press('Enter')
  await content.pressSequentially('One useful sentence. [[Field')
  await expect(page.getByRole('option', { name: 'Field guide' })).toBeVisible()
  await content.press('Enter')
  await expect(content.getByRole('link', { name: 'Field guide' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Saved locally')

  await content.getByRole('link', { name: 'Field guide' }).click()
  await expect(page.getByRole('complementary', { name: 'Page context' }).getByRole('button', { name: /Test notebook/ })).toBeVisible()

  await page.keyboard.press('Control+k')
  const query = page.getByRole('combobox', { name: 'Search pages' })
  await query.fill('useful sentence')
  await query.press('Escape')
  await expect(query).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await query.fill('useful sentence')
  await query.press('Enter')
  await expect(title).toHaveValue('Test notebook')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Projects')
  await expect(page.getByRole('status')).toHaveText('Saved locally')

  await page.reload()
  await expect(title).toHaveValue('Test notebook')
  await expect(content).toContainText('One useful sentence.')
  await expect(page.getByRole('complementary', { name: 'Page context' }).getByRole('button', { name: 'Observation' })).toBeVisible()

  await page.locator('summary[aria-label="Page actions"]').click()
  const single = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  const file = await single
  expect(file.suggestedFilename()).toBe('Test notebook.md')
  expect(await readFile(await file.path(), 'utf8')).toContain('[[Field guide]]')

  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const archive = unzipSync(await readFile(await (await exported).path()))
  expect(strFromU8(archive['Projects/Test notebook.md'])).toContain('## Observation')
})

test('imports Markdown and keeps mobile navigation and page context reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field guide')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('complementary', { name: 'Workspace navigation' })).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await (await chooser).setFiles({
    name: 'Imported page.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Imported page\n\n## A heading\n\n- [x] A task\n\n[[Field guide]]'),
  })
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Imported page')
  await expect(page.getByRole('checkbox', { name: /A task/i })).toBeChecked()
  await page.getByRole('button', { name: 'Toggle page context' }).click()
  await expect(page.getByRole('complementary', { name: 'Page context' }).getByRole('button', { name: 'A heading' })).toBeVisible()
  await page.getByRole('button', { name: 'Close page context', exact: true }).last().click()
  await expect(page.getByRole('button', { name: 'Toggle page context' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('surfaces a stale tab and reloads its latest saved copy only after confirmation', async ({ page, context }) => {
  await page.goto('/workspace')
  const secondTab = await context.newPage()
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  await secondTab.goto('/workspace')
  await expect(secondTab.getByRole('status')).toHaveText('Saved locally')
  await page.getByRole('textbox', { name: 'Page title' }).fill('Newer title')
  await page.getByRole('textbox', { name: 'Page title' }).press('Enter')
  await expect(page.getByRole('status')).toHaveText('Saved locally')

  await secondTab.getByRole('textbox', { name: 'Page title' }).fill('Stale title')
  await secondTab.getByRole('textbox', { name: 'Page title' }).press('Enter')
  await expect(secondTab.getByRole('alert').filter({ hasText: 'This workspace' })).toContainText('changed in another tab')
  await secondTab.getByRole('button', { name: 'Open saved copy' }).click()
  const dialog = secondTab.getByRole('dialog', { name: 'Open saved copy' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(secondTab.getByRole('textbox', { name: 'Page title' })).toHaveValue('Stale title')
  await secondTab.getByRole('button', { name: 'Open saved copy' }).click()
  await dialog.getByRole('button', { name: 'Open saved copy' }).click()
  await expect(secondTab.getByRole('textbox', { name: 'Page title' })).toHaveValue('Newer title')
})

test('saves title edits while the title still has focus', async ({ page }) => {
  await page.goto('/workspace')
  const title = page.getByRole('textbox', { name: 'Page title' })
  await title.fill('Draft title')
  await expect(title).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  await page.reload()
  await expect(title).toHaveValue('Draft title')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Draft title')
})

test('opens an inline page link with the keyboard', async ({ page }) => {
  await page.goto('/workspace')
  const link = page.getByRole('textbox', { name: 'Page content' }).getByRole('link', { name: 'Quick capture' })
  await link.focus()
  await expect(link).toBeFocused()
  await link.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Quick capture')
})

test('keeps table and image syntax after editing imported Markdown', async ({ page }) => {
  await page.goto('/workspace')
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  const source = '## Notes\n\n| Column | Value |\n| --- | --- |\n| First | 42 |\n\n![Field sketch](https://example.test/sketch.png)'
  await page.locator('input[type=file]').setInputFiles({
    name: 'Field research.md', mimeType: 'text/markdown', buffer: Buffer.from(source),
  })
  const markdown = page.getByRole('textbox', { name: 'Markdown source' })
  await expect(markdown).toHaveValue(source)
  await markdown.fill(source.replace('## Notes', '## Field notes'))
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible()
  await page.reload()
  await expect(markdown).toHaveValue(source.replace('## Notes', '## Field notes'))
  await page.locator('summary[aria-label="Page actions"]').click()
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  expect(await readFile(await (await exported).path(), 'utf8')).toContain(source.replace('## Notes', '## Field notes'))
})

test('shows formatted headings in the outline and follows their wikilink anchors', async ({ page }) => {
  await page.goto('/workspace')
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  await page.locator('input[type=file]').setInputFiles({
    name: 'With outline.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Go to [[#Overview]].\n\n## **Overview**\n\nA heading with formatting.'),
  })
  const heading = page.getByRole('heading', { name: 'Overview', exact: true })
  const outline = page.getByRole('complementary', { name: 'Page context' })
  await expect(outline.getByRole('button', { name: 'Overview', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '#Overview' }).click()
  await expect.poll(() => heading.evaluate(element => {
    const anchor = document.getSelection()?.anchorNode
    return !!anchor && element.contains(anchor)
  })).toBe(true)
})

test('round-trips a vault with nested pages, properties, callouts and local images', async ({ page, browser }) => {
  await page.goto('/workspace')
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64')
  const archive = zipSync({
    'Vault/Index.md': strToU8('> [!note] Read this first\n> Link to [[Guide/Notes|the field notes]].\n\n![[stamp.png]]'),
    'Vault/Guide/Notes.md': strToU8('---\ntitle: Field notes\ntags: [fieldwork]\n---\n\nBody text.'),
    'Vault/stamp.png': png,
    'Vault/.obsidian/config.md': strToU8('Do not import.'),
  })
  await page.getByRole('button', { name: 'Import vault' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import an Obsidian vault' })
  await dialog.locator('input[type=file]').first().setInputFiles({
    name: 'vault.zip', mimeType: 'application/zip', buffer: Buffer.from(archive),
  })
  await expect(dialog.getByRole('status')).toHaveText('Import saved locally')
  await dialog.getByRole('button', { name: 'Open workspace' }).click()
  await page.getByRole('button', { name: 'Index', exact: true }).click()
  await expect(page.locator('aside[data-vault-callout=note]')).toContainText('Read this first')
  await expect(page.getByRole('img', { name: 'stamp.png' })).toBeVisible()
  await page.getByRole('link', { name: 'the field notes' }).click()
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field notes')
  await expect(page.getByRole('complementary', { name: 'Page context' })).toContainText('fieldwork')
  await page.getByRole('button', { name: '#fieldwork', exact: true }).click()
  const palette = page.getByRole('dialog', { name: 'Search pages' })
  await expect(palette.getByRole('combobox')).toHaveValue('#fieldwork')
  await expect(palette.getByRole('option', { name: /Field notes.*#fieldwork/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'config', exact: true })).toHaveCount(0)

  await page.keyboard.press('Escape')
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const bytes = await readFile(await (await exported).path())
  const files = unzipSync(bytes)
  expect(Buffer.from(files['Attachments/image-1.png'])).toEqual(png)
  expect(strFromU8(files['Vault/Index.md'])).toContain('![stamp.png](../Attachments/image-1.png)')

  const restored = await browser.newPage()
  try {
    await restored.goto(new URL('/workspace', page.url()).href)
    await restored.getByRole('button', { name: 'Import vault' }).click()
    const importDialog = restored.getByRole('dialog', { name: 'Import an Obsidian vault' })
    await importDialog.locator('input[type=file]').first().setInputFiles({
      name: 'Lekhan workspace.zip', mimeType: 'application/zip', buffer: bytes,
    })
    await expect(importDialog.getByRole('status')).toHaveText('Import saved locally')
    await importDialog.getByRole('button', { name: 'Open workspace' }).click()
    await restored.getByRole('button', { name: 'Index', exact: true }).click()
    await expect(restored.locator('aside[data-vault-callout=note]')).toContainText('Read this first')
    await expect(restored.getByRole('img', { name: 'stamp.png' })).toBeVisible()
    await restored.getByRole('link', { name: 'the field notes' }).click()
    await expect(restored.getByRole('textbox', { name: 'Page title' })).toHaveValue('Field notes')
    await expect(restored.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Guide')
    await expect(restored.getByRole('complementary', { name: 'Page context' })).toContainText('fieldwork')
    await expect(restored.getByRole('button', { name: 'Attachments', exact: true })).toHaveCount(0)
  } finally {
    await restored.close()
  }
})

test('keeps the selected workspace language across reload', async ({ page }) => {
  await page.goto('/workspace')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('textbox', { name: 'Título de la página' })).toHaveValue('Field guide')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('textbox', { name: 'Título de la página' })).toHaveValue('Field guide')
  await page.getByRole('button', { name: 'Asistente de escritura' }).click()
  const assistant = page.getByRole('dialog', { name: 'Asistente de escritura' })
  await assistant.getByLabel('Frase de contraseña').fill('fixture spanish vault')
  await assistant.getByRole('button', { name: 'Crear caja fuerte de proveedores' }).click()
  await expect(assistant.getByRole('button', { name: 'Guardar conexión' })).toBeVisible()
  await expect(assistant.getByRole('button', { name: 'Probar conexión' })).toBeVisible()
})

test('uses the workspace shortcuts while preserving modal and editor behavior', async ({ page }) => {
  await page.goto('/workspace')
  const title = page.getByRole('textbox', { name: 'Page title' })
  const content = page.getByRole('textbox', { name: 'Page content' })
  await expect(title).toHaveValue('Field guide')

  await page.keyboard.press('Control+/')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help.getByText('Quick switch')).toBeVisible()
  await page.keyboard.press('Control+Shift+n')
  await expect(help).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(title).toHaveValue('Field guide')
  await page.keyboard.press('Control+Shift+n')
  await expect(title).toBeFocused()
  await title.fill('Shortcut notebook')
  await title.press('Enter')
  await content.fill('Plum-color orchard')
  await expect(page.getByRole('status')).toHaveText('Saved locally')

  await page.keyboard.press('Control+Shift+k')
  const switcher = page.getByRole('combobox', { name: 'Quick switch' })
  await switcher.fill('Plum-color orchard')
  await expect(page.getByRole('dialog', { name: 'Quick switch' }).getByRole('option')).toHaveCount(0)
  await switcher.fill('Field guide')
  await switcher.press('Enter')
  await expect(title).toHaveValue('Field guide')
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(title).toHaveValue('Shortcut notebook')
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(title).toHaveValue('Field guide')

  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+Shift+e')
  expect((await download).suggestedFilename()).toBe('Field guide.md')
  await page.keyboard.press('Control+Shift+Backspace')
  const confirmation = page.getByRole('dialog', { name: 'Delete page' })
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(title).toHaveValue('Field guide')

  const navigation = page.getByRole('complementary', { name: 'Workspace navigation' })
  const pages = navigation.getByRole('region', { name: 'All pages' })
  await pages.getByRole('button', { name: 'Field guide', exact: true }).press('ArrowDown')
  await expect(pages.getByRole('button', { name: 'Quick capture', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(pages.getByRole('button', { name: 'Shortcut notebook', exact: true })).toBeFocused()
  await page.keyboard.press('Control+Backslash')
  await expect(navigation).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(navigation).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('Control+Backslash')
  await expect(navigation).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
})

test('reveals more notebook pages and backlinks without hiding the active branch', async ({ page }) => {
  await page.goto('/about')
  await page.evaluate(async () => {
    const now = new Date().toISOString()
    const pages = Array.from({ length: 61 }, (_, index) => ({
      id: 'fixture-' + index,
      parentId: index === 60 ? 'fixture-59' : null,
      title: 'Fixture page ' + index,
      markdown: index === 0 ? 'Start here.' : 'Reference [[Fixture page 0]].',
      favorite: false, createdAt: now, updatedAt: now,
    }))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('lekhan-writing-workspace')
      request.onupgradeneeded = () => request.result.createObjectStore('workspace')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('workspace', 'readwrite')
        transaction.objectStore('workspace').put({ pages, revision: 1, activePageId: 'fixture-60' }, 'personal')
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onabort = () => { database.close(); reject(transaction.error) }
      }
    })
  })
  await page.goto('/workspace')
  const tree = page.getByRole('region', { name: 'All pages' })
  const title = page.getByRole('textbox', { name: 'Page title' })
  await expect(title).toHaveValue('Fixture page 60')
  await expect(tree.getByRole('button', { name: 'Fixture page 59', exact: true })).toBeVisible()
  await expect(tree.getByRole('button', { name: 'Fixture page 60', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(tree.getByRole('button', { name: 'Fixture page 48', exact: true })).toHaveCount(0)
  await tree.getByRole('button', { name: 'Show more pages' }).press('Enter')
  await expect(tree.getByRole('button', { name: 'Fixture page 48', exact: true })).toBeFocused()

  await tree.getByRole('button', { name: 'Fixture page 0', exact: true }).click()
  const context = page.getByRole('complementary', { name: 'Page context' })
  await expect(context.getByRole('heading', { name: 'Backlinks 60' })).toBeVisible()
  await expect(context.getByRole('button', { name: /Fixture page 25/ })).toHaveCount(0)
  await context.getByRole('button', { name: 'Show more backlinks' }).press('Enter')
  await expect(context.getByRole('button', { name: /Fixture page 25/ })).toBeFocused()
  await context.getByRole('button', { name: /Fixture page 25/ }).press('Enter')
  await expect(title).toHaveValue('Fixture page 25')
})

test('downloads a vault attachment after saving the notebook and reopening its exported ZIP', async ({ page, browser }) => {
  const bytes = Buffer.from('%PDF-1.7\nPortable document fixture\n')
  const original = zipSync({
    'Work/Attachment notebook.md': strToU8('Read [[../Evidence/Report.pdf#page=3|the report]].'),
    'Evidence/Report.pdf': bytes,
  })
  async function importArchive(tab: typeof page, name: string, archive: Buffer) {
    await tab.getByRole('button', { name: 'Import vault' }).click()
    const dialog = tab.getByRole('dialog', { name: 'Import an Obsidian vault' })
    await dialog.getByLabel('Vault ZIP').setInputFiles({ name, mimeType: 'application/zip', buffer: archive })
    await expect(dialog.getByRole('status')).toHaveText('Import saved locally')
    await expect(dialog.getByText('Files saved')).toBeVisible()
    await dialog.getByRole('button', { name: 'Open workspace' }).click()
    await tab.getByRole('button', { name: 'Attachment notebook', exact: true }).click()
    await expect(tab.getByRole('textbox', { name: 'Page title' })).toHaveValue('Attachment notebook')
  }
  async function verifyDownload(tab: typeof page, keyboard = false) {
    const file = await Promise.all([
      tab.waitForEvent('download', { timeout: 5000 }),
      keyboard ? tab.getByRole('button', { name: 'Report.pdf' }).press('Enter')
        : tab.getByRole('link', { name: 'the report' }).click(),
    ]).then(([download]) => download)
    expect(file.suggestedFilename()).toBe('Report.pdf')
    expect(await readFile(await file.path())).toEqual(bytes)
  }

  await page.goto('/workspace')
  await importArchive(page, 'original.zip', Buffer.from(original))
  await page.reload()
  await verifyDownload(page)

  const exporting = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await exporting).path())
  expect(Buffer.from(unzipSync(exported)['Attachments/Files/1/Report.pdf'])).toEqual(bytes)
  const restored = await browser.newPage()
  try {
    await restored.goto(new URL('/workspace', page.url()).href)
    await importArchive(restored, 'Lekhan workspace.zip', exported)
    await verifyDownload(restored, true)
  } finally {
    await restored.close()
  }
})
