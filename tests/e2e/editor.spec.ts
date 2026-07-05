import { test, expect } from '@playwright/test';

test.describe('Editor Workspace', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the main dashboard
    await page.goto('http://localhost:3000/');
  });

  test('should load the dashboard and show login/documents', async ({ page }) => {
    // If we're not logged in, we might see the Auth component
    const hasLogin = await page.locator('text=Sign in to Lekhan').isVisible();
    
    if (hasLogin) {
      // Mock login or skip the test based on actual setup.
      // This is a basic sanity check that the app boots
      expect(hasLogin).toBeTruthy();
    } else {
      // We are logged in, dashboard should show "Your Documents"
      await expect(page.locator('text=Your Documents')).toBeVisible();
    }
  });
});
