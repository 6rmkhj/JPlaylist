import { test, expect } from '@playwright/test';

const today = '2026-09-10';
const song = (id, title, artist, daysAgo, extra = {}) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    id: String(id),
    title,
    artist,
    releaseDate: date.toISOString().slice(0, 10),
    artwork: null,
    genres: extra.genres || ['J-Pop'],
    appleUrl: `https://music.apple.com/jp/song/${id}`,
    previewUrl: null,
    chartRank: extra.chartRank ?? null,
    collectionId: `release-${id}`,
    collectionName: `Release ${id}`,
    searchAliases: [],
    platformLinks: {},
    sourceKinds: ['fixture'],
  };
};

const songs = [
  song(1, 'Seed Favorite', 'Artist A', 10, { genres: ['J-Rock'] }),
  song(2, 'Fresh Rock', 'Artist B', 1, { genres: ['J-Rock'] }),
  song(3, 'Chart Pop', 'Artist C', 20, { chartRank: 3 }),
  song(4, 'New Pop', 'Artist D', 3),
  song(5, 'Deep Cut', 'Artist E', 80, { genres: ['Alternative'] }),
  song(6, 'Anime One', 'Artist F', 8, { genres: ['Anime'] }),
  song(7, 'Rock Two', 'Artist G', 15, { genres: ['J-Rock'] }),
  song(8, 'City Pop', 'Artist H', 40, { genres: ['J-Pop'] }),
  song(9, 'Vocaloid', 'Artist I', 6, { genres: ['Vocaloid'] }),
  song(10, 'Newcomer', 'Artist J', 2),
  song(11, 'Popular Two', 'Artist K', 60, { chartRank: 12 }),
  song(12, 'Rare One', 'Artist L', 120, { genres: ['Alternative'] }),
];

const fixture = {
  schemaVersion: 3,
  status: 'fresh',
  updatedAt: '2026-09-10T06:00:00.000Z',
  lastCheckedAt: '2026-09-10T06:00:00.000Z',
  latestWindowDays: 180,
  sources: { discovery: { components: [] } },
  coverage: { previewAvailable: 0, canonicalRecording: 0, isrc: 0, exactNonAppleLink: 0, releaseIndex: 'ok' },
  latestSongs: songs,
  popularSongs: songs.map((item, index) => ({ ...item, chartRank: index + 1 })),
  songs,
};

async function install(page, { favorite = true } = {}) {
  await page.route('**/data/songs.json', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.addInitScript(({ favoriteSong, useFavorite }) => {
    if (localStorage.getItem('jp-signature-fixture-seeded')) return;
    localStorage.clear();
    if (useFavorite) localStorage.setItem('jplaylist-favorites-v2', JSON.stringify({ version: 3, items: [{ ...favoriteSong, likedAt: '2026-09-10T05:00:00.000Z' }] }));
    localStorage.setItem('jp-signature-fixture-seeded', '1');
  }, { favoriteSong: songs[0], useFavorite: favorite });
  await page.goto('/');
  await expect(page.locator('#personalized')).toBeVisible();
  await expect(page.locator('.jp-daily-card').first()).toBeVisible();
}

test('taste map is the primary personalized artifact and daily recommendation is exactly three roles', async ({ page }) => {
  await install(page);
  await expect(page.locator('#jpTasteMapTitle')).toHaveText('지금 내 취향의 위치');
  await expect(page.locator('.jp-map-point')).toHaveCount(1);
  await expect(page.locator('.jp-daily-card')).toHaveCount(3);
  await expect(page.locator('.jp-daily-card[data-role="safe"]')).toHaveCount(1);
  await expect(page.locator('.jp-daily-card[data-role="step"]')).toHaveCount(1);
  await expect(page.locator('.jp-daily-card[data-role="deep"]')).toHaveCount(1);
  await expect(page.locator('[data-jp-song="1"]')).toHaveCount(0);
});

test('interest feedback persists and removes a song from both daily discovery and rabbit candidates', async ({ page }) => {
  await install(page);
  const firstId = await page.locator('.jp-daily-card').first().getAttribute('data-jp-song');
  await page.locator('.jp-daily-card').first().locator('[data-jp-dismiss]').click();
  await expect(page.locator(`[data-jp-song="${firstId}"]`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#personalized')).toBeVisible();
  await expect(page.locator(`[data-jp-song="${firstId}"]`)).toHaveCount(0);
});

test('recommendation novelty remains keyboard operable with roving tabindex', async ({ page }) => {
  await install(page);
  const balanced = page.locator('[data-jp-exploration="balanced"]');
  await balanced.focus();
  await balanced.press('ArrowRight');
  const adventurous = page.locator('[data-jp-exploration="adventurous"]');
  await expect(adventurous).toBeFocused();
  await expect(adventurous).toHaveAttribute('aria-checked', 'true');
  await expect(balanced).toHaveAttribute('tabindex', '-1');
});

test('rabbit hole turns one daily pick into a five-step path and direction is keyboard operable', async ({ page }) => {
  await install(page);
  await page.locator('.jp-daily-card').nth(1).locator('[data-jp-rabbit-start]').click();
  await expect(page.locator('.jp-path-card')).toHaveCount(5);
  await expect(page.locator('#rabbitHole')).toBeInViewport();

  const deeper = page.locator('[data-jp-rabbit-direction="deeper"]');
  await deeper.focus();
  await deeper.press('ArrowRight');
  const newer = page.locator('[data-jp-rabbit-direction="newer"]');
  await expect(newer).toBeFocused();
  await expect(newer).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.jp-path-card')).toHaveCount(5);
});

test('daily pick still hands off to the unified catalog instead of creating a second song-detail system', async ({ page }) => {
  await install(page);
  const card = page.locator('.jp-daily-card').first();
  const id = await card.getAttribute('data-jp-song');
  await card.locator('[data-jp-open]').click();
  await expect(page.locator(`[data-song-id="${id}"]`)).toBeVisible();
  await expect(page.locator('#searchInput')).not.toHaveValue('');
});

test('signature experience stays usable without favorites and at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await install(page, { favorite: false });
  await expect(page.locator('.jp-map-narrative')).toContainText('취향 지도가 비어');
  await expect(page.locator('.jp-daily-card')).toHaveCount(3);
  const minHeights = await page.locator('.jp-direction, .jp-daily-open, .jp-daily-listen, .jp-daily-hole').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.min(...minHeights)).toBeGreaterThanOrEqual(43.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
