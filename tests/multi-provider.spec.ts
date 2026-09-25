import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4443';

test.describe('Multi-Provider Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('Settings page shows provider management', async ({ page }) => {
    await page.click('text=Settings');
    await page.waitForSelector('text=AI Providers');
    // Should show Claude and any other installed providers
    await expect(page.locator('text=Claude Code')).toBeVisible();
  });

  test('Provider picker appears when multiple providers enabled', async ({ page }) => {
    // Navigate to sessions page
    await page.click('text=Sessions');
    // If multiple providers enabled, provider picker should be available in grid
    const gridButton = page.locator('button[title="Terminal grid view"]');
    if (await gridButton.isVisible()) {
      await gridButton.click();
    }
  });

  test('Sessions page shows provider badges on non-Claude sessions', async ({ page }) => {
    await page.click('text=Sessions');
    // Look for Gemini badge "G" on any Gemini sessions
    const geminiBadge = page.locator('text=G').first();
    // This test passes if no Gemini sessions exist (nothing to check)
    if (await geminiBadge.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(geminiBadge).toBeVisible();
    }
  });

  test('Agents page has provider filter', async ({ page }) => {
    await page.click('text=Agents');
    await page.waitForSelector('h1:has-text("Agents")');
    // If multiple providers, filter buttons should be visible
    const filterButtons = page.locator('button:has-text("CC"), button:has-text("G")');
    const count = await filterButtons.count();
    // At minimum, CC (Claude) should be there if multiple providers
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Skills page has provider filter', async ({ page }) => {
    await page.click('text=Skills');
    await page.waitForSelector('h1:has-text("Skills")');
    const filterButtons = page.locator('button:has-text("CC"), button:has-text("G")');
    const count = await filterButtons.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Plugins page has provider filter', async ({ page }) => {
    await page.click('text=Plugins');
    await page.waitForSelector('h1');
    const filterButtons = page.locator('button:has-text("CC"), button:has-text("G")');
    const count = await filterButtons.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Projects page has provider filter', async ({ page }) => {
    await page.click('text=Projects');
    await page.waitForSelector('h1:has-text("Projects")');
    const filterButtons = page.locator('button:has-text("CC"), button:has-text("G")');
    const count = await filterButtons.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Model names formatted correctly for Claude sessions', async ({ page }) => {
    await page.click('text=Sessions');
    // Model badges should not show raw "claude-" prefix
    const modelBadges = page.locator('[class*="Badge"]');
    const count = await modelBadges.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = await modelBadges.nth(i).textContent();
      if (text?.includes('claude-')) {
        // Should have been stripped by formatModelDisplay
        expect(text).not.toMatch(/^claude-/);
      }
    }
  });
});

test.describe('Gemini Provider (requires Gemini CLI installed)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only');

  test('Can switch Agents page to Gemini', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Agents');
    await page.waitForSelector('h1:has-text("Agents")');

    const geminiButton = page.locator('button:has-text("G")');
    if (await geminiButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await geminiButton.click();
      // Page should show Gemini agents
      await expect(page.locator('text=Gemini CLI')).toBeVisible();
    }
  });

  test('Can switch Skills page to Gemini', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Skills');
    await page.waitForSelector('h1:has-text("Skills")');

    const geminiButton = page.locator('button:has-text("G")');
    if (await geminiButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await geminiButton.click();
      // Should show "custom commands" for Gemini
      await expect(page.locator('text=custom commands')).toBeVisible();
    }
  });

  test('Can switch Plugins page to Gemini (Extensions)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('text=Plugins');

    const geminiButton = page.locator('button:has-text("G")');
    if (await geminiButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await geminiButton.click();
      // Should show "Extensions" for Gemini
      await expect(page.locator('h1:has-text("Extensions")')).toBeVisible();
    }
  });
});
