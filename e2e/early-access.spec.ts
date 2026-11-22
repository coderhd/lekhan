import { expect, test } from '@playwright/test'

test('early access shows the product gallery and requires a receipt to display a place', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/early?joined=1&position=3')
  await expect(page.getByRole('heading', { name: 'Join early access' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Founding spot #3 of 500' })).toHaveCount(0)
  const pictures = page.locator('.early-pictures img')
  await expect(pictures).toHaveCount(3)
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded()
    await expect.poll(() => picture.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})
