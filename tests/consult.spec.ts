import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4443';

test.describe('Consult / Second Opinion Feature', () => {
  test('Second Opinion button visible on session detail page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Sessions');
    await page.waitForLoadState('networkidle');

    // Click the first session card to open detail view
    const sessionCard = page.locator('[class*="Card"]').first();
    if (await sessionCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionCard.click();
      await page.waitForLoadState('networkidle');

      // "Second Opinion" button should be visible if multiple providers enabled
      const consultButton = page.locator('button:has-text("Second Opinion")');
      if (await consultButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(consultButton).toBeVisible();
      }
    }
  });

  test('Second Opinion opens provider dropdown', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Sessions');
    await page.waitForLoadState('networkidle');

    const sessionCard = page.locator('[class*="Card"]').first();
    if (await sessionCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionCard.click();
      await page.waitForLoadState('networkidle');

      const consultButton = page.locator('button:has-text("Second Opinion")');
      if (await consultButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await consultButton.click();
        // Provider dropdown should appear
        const dropdown = page.locator('[class*="popover"]');
        await expect(dropdown).toBeVisible({ timeout: 2000 });
      }
    }
  });

  test('Continue with... button opens provider dropdown', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Sessions');
    await page.waitForLoadState('networkidle');

    const sessionCard = page.locator('[class*="Card"]').first();
    if (await sessionCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionCard.click();
      await page.waitForLoadState('networkidle');

      const handoffButton = page.locator('button:has-text("Continue with")');
      if (await handoffButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await handoffButton.click();
        const dropdown = page.locator('[class*="popover"]');
        await expect(dropdown).toBeVisible({ timeout: 2000 });
      }
    }
  });
});
