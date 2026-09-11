import { test, expect } from '@playwright/test';

test('K-POP is a full Taste Map scene, not a catalog-only filter', async ({ page }) => {
  await page.goto('/?scene=kpop');
  await expect(page.locator('[data-scene-switch="kpop"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#heroTitle')).toContainText('내 K-POP 취향을');
  await expect(page.locator('#discoverTitle')).toHaveText('전체 K-POP 탐색');
  await expect(page.locator('#personalized')).toBeVisible();
  await expect(page.locator('.jp-daily-card')).toHaveCount(3);
  await expect(page.locator('.song-card').first()).toBeVisible();
  await expect(page.locator('.card-rank').first()).not.toContainText('Apple JP');
  await expect(page.locator('#featuredReason')).not.toContainText('일본');
  await expect(page.locator('#personalized')).not.toContainText('일본 차트 흐름');
});

test('POP keeps the same three moves and five-step Rabbit Hole experience', async ({ page }) => {
  await page.goto('/?scene=pop');
  await expect(page.locator('[data-scene-switch="pop"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#heroTitle')).toContainText('내 팝 취향을');
  await expect(page.locator('.jp-daily-card')).toHaveCount(3);
  await expect(page.locator('#featuredReason')).not.toContainText('일본');
  await expect(page.locator('#personalized')).not.toContainText('일본 차트 흐름');
  await page.locator('.jp-daily-card').nth(1).locator('[data-jp-rabbit-start]').click();
  await expect(page.locator('.jp-path-card')).toHaveCount(5);
});

test('category switch resets catalog filters and moves to the selected Taste Map', async ({ page }) => {
  await page.goto('/?scene=kpop&q=APT.');
  await expect(page.locator('#searchInput')).toHaveValue('APT.');
  await page.locator('[data-scene-switch="pop"]').click();
  await expect(page).toHaveURL(/\?scene=pop#personalized$/);
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(page.locator('[data-scene-switch="pop"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#personalized')).toBeVisible();
});

test('scene parameter survives the existing search history serializer and reload', async ({ page }) => {
  await page.goto('/?scene=kpop');
  await page.locator('#searchInput').fill('BLACKPINK');
  await expect.poll(() => page.url()).toContain('scene=kpop');
  await expect.poll(() => page.url()).toContain('q=BLACKPINK');
  await page.reload();
  await expect(page.locator('#heroTitle')).toContainText('내 K-POP 취향을');
  await expect(page.locator('#searchInput')).toHaveValue('BLACKPINK');
});

test('favorites are isolated by music scene while listening platform remains global', async ({ page }) => {
  await page.goto('/?scene=kpop');
  await page.locator('.card-like').first().click();
  await page.locator('[data-scene-switch="pop"]').click();
  await expect(page).toHaveURL(/scene=pop/);
  await page.locator('#favoritesFilter').click();
  await expect(page.locator('#emptyTitle')).toHaveText('아직 좋아요한 곡이 없어요');

  await page.locator('[data-scene-switch="kpop"]').click();
  await expect(page).toHaveURL(/#personalized$/);
  await page.locator('#favoritesFilter').click();
  await expect(page.locator('.song-card')).toHaveCount(1);
});
