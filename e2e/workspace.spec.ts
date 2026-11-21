import { expect, test } from '@playwright/test'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { readFile } from 'node:fs/promises'

test('writes, links, finds, renames, reloads, and exports a nested page', async ({ page }) => {
  await page.goto('/')
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
  await page.goto('/')
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
  await page.goto('/')
  const secondTab = await context.newPage()
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  await secondTab.goto('/')
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
  await page.goto('/')
  const title = page.getByRole('textbox', { name: 'Page title' })
  await title.fill('Draft title')
  await expect(title).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Saved locally')
  await page.reload()
  await expect(title).toHaveValue('Draft title')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Draft title')
})

test('opens an inline page link with the keyboard', async ({ page }) => {
  await page.goto('/')
  const link = page.getByRole('textbox', { name: 'Page content' }).getByRole('link', { name: 'Quick capture' })
  await link.focus()
  await expect(link).toBeFocused()
  await link.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Quick capture')
})

test('keeps table and image syntax after editing imported Markdown', async ({ page }) => {
  await page.goto('/')
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
  await page.goto('/')
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

test('imports an Obsidian ZIP with nested pages, properties, callouts and local images', async ({ page }) => {
  await page.goto('/')
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
})

test('keeps the selected workspace language across reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('textbox', { name: 'Título de la página' })).toHaveValue('Field guide')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('textbox', { name: 'Título de la página' })).toHaveValue('Field guide')
})
