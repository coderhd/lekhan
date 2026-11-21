import { expect, test } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
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
  const query = page.getByRole('searchbox', { name: 'Search pages' })
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
