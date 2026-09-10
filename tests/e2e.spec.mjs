import { test, expect } from '@playwright/test';

const iso = (daysAgo) => {
  const date = new Date('2026-09-10T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

function song(id, title, artist, daysAgo, extra = {}) {
  return {
    id: String(id),
    title,
    artist,
    artistId: `artist-${id}`,
    releaseDate: iso(daysAgo),
    artwork: null,
    genres: extra.genres || ['J-Pop'],
    appleUrl: `https://music.apple.com/jp/song/${id}`,
    previewUrl: extra.previewUrl || null,
    chartRank: extra.chartRank ?? null,
    collectionId: extra.collectionId || `release-${Math.ceil(Number(id) / 2)}`,
    collectionName: extra.collectionName || `Release ${Math.ceil(Number(id) / 2)}`,
    trackNumber: extra.trackNumber || ((Number(id) - 1) % 2) + 1,
    trackCount: 2,
    discNumber: 1,
    discCount: 1,
    recordingId: extra.recordingId || null,
    isrc: extra.isrc || null,
    searchAliases: extra.searchAliases || [],
    platformLinks: extra.platformLinks || {},
    sourceKinds: ['fixture'],
  };
}

const latestSongs = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  const genres = n % 3 === 0 ? ['ロック', 'ミュージック'] : ['J-Pop'];
  return song(n, `Latest ${n}`, `Artist ${n}`, Math.min(index, 29), { genres });
});
latestSongs[0] = song(1, '情熱', '荒谷翔大', 0, {
  genres: ['J-Pop'],
  collectionId: 'release-jounetsu',
  collectionName: '情熱 - Album',
  trackNumber: 1,
});
latestSongs[1] = song(2, '情熱 Instrumental', '荒谷翔大', 0, {
  genres: ['J-Pop'],
  collectionId: 'release-jounetsu',
  collectionName: '情熱 - Album',
  trackNumber: 2,
});

const popularSongs = [
  song(200, 'IRIS OUT', '米津玄師', 40, {
    genres: ['J-Pop'],
    chartRank: 8,
    collectionId: 'release-iris',
    collectionName: 'IRIS OUT - Single',
    trackNumber: 1,
    trackCount: 1,
    recordingId: 'mb-iris',
    isrc: 'JPABC2600001',
    searchAliases: ['Kenshi Yonezu', '요네즈 켄시'],
  }),
  song(201, 'ライラック', 'Mrs. GREEN APPLE', 80, { genres: ['ロック'], chartRank: 2 }),
  ...Array.from({ length: 12 }, (_, index) => song(300 + index, `Popular ${index + 1}`, `Popular Artist ${index + 1}`, 100 + index, { chartRank: index + 10 })),
];

const all = [...new Map([...latestSongs, ...popularSongs].map((item) => [item.id, item])).values()];
const fixture = {
  schemaVersion: 3,
  status: 'fresh',
  updatedAt: '2026-09-10T06:00:00.000Z',
  lastCheckedAt: '2026-09-10T06:00:00.000Z',
  latestWindowDays: 180,
  sources: {
    discovery: {
      components: [
        { label: 'MusicBrainz 일본 발매일 인덱스', status: 'ok' },
        { label: 'iTunes Japan 카탈로그 검색', status: 'ok' },
      ],
    },
  },
  counts: { latest: latestSongs.length, popular: popularSongs.length, total: all.length },
  coverage: {
    previewAvailable: 0,
    canonicalRecording: 1,
    isrc: 1,
    exactNonAppleLink: 0,
    releaseIndex: 'ok',
  },
  latestSongs,
  popularSongs,
  songs: all,
};

async function installFixture(page, payload = fixture) {
  await page.route('**/data/songs.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route('https://itunes.apple.com/lookup**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resultCount: 0, results: [] }) });
  });
}

async function openReady(page, path = '/') {
  await installFixture(page);
  await page.goto(path);
  await expect(page.locator('#songGrid')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.song-card').first()).toBeVisible();
}

test('search uses the unified catalog and artist navigation does not collapse to zero', async ({ page }) => {
  await openReady(page);
  await page.locator('#searchInput').fill('IRIS OUT');
  await expect(page.locator('.song-card')).toHaveCount(1);
  await expect(page.locator('.song-title')).toHaveText('IRIS OUT');
  await expect(page.locator('#featuredTitle')).toHaveText('IRIS OUT');

  const latestTab = page.locator('[data-mode="latest"]');
  const popularTab = page.locator('[data-mode="popular"]');
  await expect(latestTab).toBeDisabled();
  await expect(popularTab).toBeDisabled();
  await expect(latestTab).toHaveAttribute('aria-pressed', 'false');
  await expect(popularTab).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.song-artist').click();
  await expect(page.locator('.song-card')).toHaveCount(1);
  await expect(page.locator('.song-title')).toHaveText('IRIS OUT');
  await expect(page.locator('#activeArtistName')).toHaveText('米津玄師');
});

test('romanized and Korean artist aliases return relevant results', async ({ page }) => {
  await openReady(page);
  await page.locator('#searchInput').fill('Kenshi Yonezu');
  await expect(page.locator('.song-title')).toHaveText('IRIS OUT');
  await page.locator('#searchInput').fill('요네즈 켄시');
  await expect(page.locator('.song-title')).toHaveText('IRIS OUT');
});

test('favorites filter reset keeps the user inside favorites', async ({ page }) => {
  await openReady(page);
  await page.locator('.song-card').first().locator('[data-like-id]').click();
  await page.locator('#favoritesFilter').click();
  await expect(page.locator('#favoritesFilter')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#searchInput').fill('no-match');
  await expect(page.locator('#emptyState')).toBeVisible();
  await page.locator('#emptyResetFilters').click();
  await expect(page.locator('#favoritesFilter')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.song-card')).toHaveCount(1);
});

test('platform radiogroup uses roving tabindex and Arrow keys', async ({ page }) => {
  await openReady(page);
  await page.locator('#platformSettings').click();
  const youtubeMusic = page.locator('[data-platform="youtubeMusic"]');
  const spotify = page.locator('[data-platform="spotify"]');
  await youtubeMusic.focus();
  await youtubeMusic.press('ArrowRight');
  await expect(spotify).toBeFocused();
  await expect(spotify).toHaveAttribute('aria-checked', 'true');
  await expect(spotify).toHaveAttribute('tabindex', '0');
  await expect(youtubeMusic).toHaveAttribute('tabindex', '-1');
});

test('load more moves keyboard focus to the first newly added card', async ({ page }) => {
  await openReady(page);
  await expect(page.locator('.song-card')).toHaveCount(24);
  await page.locator('#loadMore').focus();
  await page.locator('#loadMore').press('Enter');
  await expect(page.locator('.song-card')).toHaveCount(30);
  await expect(page.locator('#loadMoreWrap')).toHaveClass(/hidden/);
  const activeIsCard = await page.evaluate(() => document.activeElement?.classList.contains('song-card'));
  expect(activeIsCard).toBe(true);
});

test('deep search link starts at discovery and whitespace-only input is treated as empty', async ({ page }) => {
  await openReady(page, '/?q=IRIS%20OUT');
  await expect(page).toHaveURL(/q=IRIS(?:\+|%20)OUT.*#discovery$/);
  await expect(page.locator('.song-card')).toHaveCount(1);
  const discoveryTop = await page.locator('#discovery').evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(discoveryTop)).toBeLessThan(180);

  await page.locator('#searchInput').fill('　   ');
  await expect(page.locator('#resultSummary')).not.toContainText('전체 검색');
  await expect(page).not.toHaveURL(/(?:\?|&)q=/);
});

test('mobile recommendation context remains visible and representative targets are at least 44px high', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openReady(page);
  await expect(page.locator('#featuredReason')).toBeVisible();
  await expect(page.locator('#featuredGenres')).toBeVisible();

  for (const selector of ['#favoritesFilter', '#platformSettings', '[data-mode="latest"]', '.filter-button', '.song-artist', '.card-listen']) {
    const height = await page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);
    expect(height, `${selector} touch target`).toBeGreaterThanOrEqual(43.5);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 720, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`layout smoke ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openReady(page);
    await expect(page.locator('#featuredCard')).toBeVisible();
    await expect(page.locator('#discovery')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
