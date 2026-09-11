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

test('each music scene has a visibly distinct palette and shape language', async ({ page }) => {
  const snapshots = {};
  for (const [scene, url] of [
    ['jpop', '/'],
    ['kpop', '/?scene=kpop'],
    ['pop', '/?scene=pop'],
  ]) {
    await page.goto(url);
    await expect(page.locator('.featured-card')).toBeVisible();
    snapshots[scene] = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const featured = getComputedStyle(document.querySelector('.featured-card'));
      const switcher = getComputedStyle(document.querySelector('.scene-switch'));
      return {
        background: root.getPropertyValue('--bg').trim(),
        accent: root.getPropertyValue('--accent').trim(),
        selected: root.getPropertyValue('--selected').trim(),
        featuredRadius: featured.borderTopLeftRadius,
        switchRadius: switcher.borderTopLeftRadius,
      };
    });
  }

  expect(new Set(Object.values(snapshots).map((item) => item.background)).size).toBe(3);
  expect(new Set(Object.values(snapshots).map((item) => item.accent)).size).toBe(3);
  expect(new Set(Object.values(snapshots).map((item) => item.featuredRadius)).size).toBe(3);
  expect(snapshots.jpop.background).toBe('#09090f');
  expect(snapshots.kpop.background).toBe('#060817');
  expect(snapshots.pop.background).toBe('#130b08');
  expect(snapshots.jpop.featuredRadius).toBe('28px');
  expect(snapshots.kpop.featuredRadius).toBe('12px');
  expect(snapshots.pop.featuredRadius).toBe('32px');
});
