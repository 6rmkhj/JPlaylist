import { readFile, writeFile } from 'node:fs/promises';

const SEARCH_API_URL = 'https://itunes.apple.com/search';
const REQUEST_TIMEOUT_MS = 12_000;
const PRIMARY_LATEST_DAYS = 180;
const FALLBACK_LATEST_DAYS = 365;
const MAX_LATEST = 120;
const MAX_POPULAR = 100;

const SCENES = {
  kpop: {
    id: 'kpop',
    label: 'K-POP',
    country: 'KR',
    storefront: 'kr',
    chartCode: 'KR',
    chartLabel: 'Apple Music Korea 인기 차트',
    popularFeed: 'https://rss.marketingtools.apple.com/api/v2/kr/music/most-played/100/songs.json',
    searchTerms: ['K-Pop', 'Korean Pop', 'Korean R&B', 'Korean Hip-Hop', 'Korean Indie'],
    output: new URL('../data/songs-kpop.json', import.meta.url),
  },
  pop: {
    id: 'pop',
    label: 'POP',
    country: 'US',
    storefront: 'us',
    chartCode: 'US',
    chartLabel: 'Apple Music US 인기 차트',
    popularFeed: 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json',
    searchTerms: ['Pop', 'Alternative Pop', 'R&B', 'Dance Pop', 'Singer Songwriter'],
    output: new URL('../data/songs-pop.json', import.meta.url),
  },
};

const requested = String(process.argv[2] || '').toLowerCase();
const config = SCENES[requested];
if (!config) {
  console.error(`Usage: node scripts/fetch-scene.mjs <${Object.keys(SCENES).join('|')}>`);
  process.exit(1);
}

const HANGUL = /[\uac00-\ud7a3]/u;
const KANA = /[\u3040-\u30ff]/u;

function text(value = '') {
  return String(value ?? '').normalize('NFKC').trim();
}

function genresFrom(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((genre) => text(typeof genre === 'string' ? genre : genre?.name)).filter(Boolean))];
}

function genreText(item = {}) {
  return genresFrom(item.genres).concat([item.primaryGenreName]).filter(Boolean).join(' ').toLowerCase();
}

function isKpop(item = {}) {
  const genres = genreText(item);
  const words = `${text(item.artistName || item.artist)} ${text(item.trackName || item.name || item.title)}`;
  return /k[- ]?pop|케이팝/i.test(genres) || HANGUL.test(words);
}

function isJapaneseMusic(item = {}) {
  const genres = genreText(item);
  const words = `${text(item.artistName || item.artist)} ${text(item.trackName || item.name || item.title)}`;
  return /j[- ]?pop|j[- ]?rock|anime|アニメ|邦楽|歌謡曲/i.test(genres) || KANA.test(words);
}

function acceptsChartItem(item) {
  if (config.id === 'kpop') return isKpop(item);
  if (config.id === 'pop') return !isKpop(item) && !isJapaneseMusic(item);
  return true;
}

function acceptsSearchItem(item, term) {
  if (config.id === 'kpop') return isKpop(item) || /^korean/i.test(term) || /k-pop/i.test(term);
  if (config.id === 'pop') return !isKpop(item) && !isJapaneseMusic(item);
  return true;
}

function releaseAgeDays(releaseDate, now = new Date()) {
  if (!releaseDate) return Number.POSITIVE_INFINITY;
  const date = new Date(`${String(releaseDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JPlaylist/3.1 (+https://github.com/6rmkhj/JPlaylist)',
      },
    });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFeedSong(item, rank) {
  return {
    id: String(item.id),
    title: text(item.name),
    artist: text(item.artistName),
    artistId: item.artistId ? String(item.artistId) : null,
    releaseDate: item.releaseDate ? String(item.releaseDate).slice(0, 10) : null,
    artwork: item.artworkUrl100 || null,
    genres: genresFrom(item.genres),
    appleUrl: item.url || null,
    previewUrl: null,
    chartRank: rank,
    collectionId: null,
    collectionName: null,
    trackNumber: null,
    trackCount: null,
    discNumber: null,
    discCount: null,
    recordingId: null,
    isrc: null,
    searchAliases: [],
    platformLinks: item.url ? { apple: item.url } : {},
    sourceKinds: [`apple-${config.storefront}-chart`],
  };
}

function normalizeSearchSong(item, term) {
  const appleUrl = item.trackViewUrl || null;
  return {
    id: String(item.trackId),
    title: text(item.trackName),
    artist: text(item.artistName),
    artistId: item.artistId ? String(item.artistId) : null,
    releaseDate: item.releaseDate ? String(item.releaseDate).slice(0, 10) : null,
    artwork: item.artworkUrl100 || null,
    genres: [item.primaryGenreName].filter(Boolean).map(text),
    appleUrl,
    previewUrl: item.previewUrl || null,
    chartRank: null,
    collectionId: item.collectionId ? String(item.collectionId) : null,
    collectionName: item.collectionName ? text(item.collectionName) : null,
    trackNumber: Number.isFinite(Number(item.trackNumber)) ? Number(item.trackNumber) : null,
    trackCount: Number.isFinite(Number(item.trackCount)) ? Number(item.trackCount) : null,
    discNumber: Number.isFinite(Number(item.discNumber)) ? Number(item.discNumber) : null,
    discCount: Number.isFinite(Number(item.discCount)) ? Number(item.discCount) : null,
    recordingId: null,
    isrc: item.isrc ? String(item.isrc).replace(/-/g, '').toUpperCase() : null,
    searchAliases: [],
    platformLinks: appleUrl ? { apple: appleUrl } : {},
    sourceKinds: [`itunes-${config.storefront}-search:${term}`],
  };
}

function mergeSong(base, incoming) {
  if (!base) return incoming;
  return {
    ...base,
    ...incoming,
    artwork: incoming.artwork || base.artwork,
    appleUrl: incoming.appleUrl || base.appleUrl,
    previewUrl: incoming.previewUrl || base.previewUrl,
    chartRank: incoming.chartRank || base.chartRank,
    collectionId: incoming.collectionId || base.collectionId,
    collectionName: incoming.collectionName || base.collectionName,
    trackNumber: incoming.trackNumber || base.trackNumber,
    trackCount: incoming.trackCount || base.trackCount,
    isrc: incoming.isrc || base.isrc,
    genres: [...new Set([...(base.genres || []), ...(incoming.genres || [])])],
    platformLinks: { ...(base.platformLinks || {}), ...(incoming.platformLinks || {}) },
    sourceKinds: [...new Set([...(base.sourceKinds || []), ...(incoming.sourceKinds || [])])],
  };
}

function identity(song) {
  return `${text(song.artist).toLowerCase()}::${text(song.title).toLowerCase()}`;
}

function dedupeSongs(songs = []) {
  const byIdentity = new Map();
  for (const song of songs) {
    if (!song?.id || !song?.title || !song?.artist) continue;
    const key = identity(song);
    byIdentity.set(key, mergeSong(byIdentity.get(key), song));
  }
  return [...byIdentity.values()];
}

function diversifyByArtist(songs = []) {
  const queues = new Map();
  const order = [];
  for (const song of songs) {
    const key = text(song.artist).toLowerCase();
    if (!queues.has(key)) {
      queues.set(key, []);
      order.push(key);
    }
    queues.get(key).push(song);
  }
  const result = [];
  let left = songs.length;
  while (left > 0) {
    for (const key of order) {
      const queue = queues.get(key);
      if (!queue?.length) continue;
      result.push(queue.shift());
      left -= 1;
    }
  }
  return result;
}

async function fetchPopular() {
  const data = await fetchJson(config.popularFeed, config.chartLabel);
  const results = data?.feed?.results;
  if (!Array.isArray(results) || !results.length) throw new Error(`${config.chartLabel} returned no songs`);
  return results
    .filter(acceptsChartItem)
    .map((item) => normalizeFeedSong(item, results.indexOf(item) + 1))
    .slice(0, MAX_POPULAR);
}

async function fetchSearchTerm(term) {
  const url = new URL(SEARCH_API_URL);
  url.searchParams.set('term', term);
  url.searchParams.set('country', config.country);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '200');
  url.searchParams.set('lang', 'en_us');
  const data = await fetchJson(url, `iTunes ${config.country} search: ${term}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((item) => item?.wrapperType === 'track' && item.trackId && item.trackName && item.artistName)
    .filter((item) => acceptsSearchItem(item, term))
    .map((item) => normalizeSearchSong(item, term));
}

async function fetchSearchCatalog() {
  const songs = [];
  const failures = [];
  let successful = 0;
  for (const term of config.searchTerms) {
    try {
      songs.push(...await fetchSearchTerm(term));
      successful += 1;
    } catch (error) {
      failures.push(`${term}: ${error.message}`);
    }
  }
  return { songs: dedupeSongs(songs), failures, successful, total: config.searchTerms.length };
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(config.output, 'utf8'));
  } catch {
    return null;
  }
}

function latestFrom(catalog, popular) {
  const candidates = dedupeSongs([...catalog, ...popular])
    .filter((song) => song.releaseDate)
    .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)) || (a.chartRank || 999) - (b.chartRank || 999));
  let windowDays = PRIMARY_LATEST_DAYS;
  let recent = candidates.filter((song) => releaseAgeDays(song.releaseDate) <= windowDays);
  if (recent.length < 8) {
    windowDays = FALLBACK_LATEST_DAYS;
    recent = candidates.filter((song) => releaseAgeDays(song.releaseDate) <= windowDays);
  }
  return { latestSongs: diversifyByArtist(recent).slice(0, MAX_LATEST), windowDays };
}

function payloadFor({ popular, search, chartError = null }) {
  const fallbackPopular = popular.length ? popular : search.songs.slice(0, Math.min(50, search.songs.length));
  const { latestSongs, windowDays } = latestFrom(search.songs, fallbackPopular);
  if (!fallbackPopular.length || !latestSongs.length) throw new Error(`${config.label} did not return enough usable songs`);
  const songs = dedupeSongs([...latestSongs, ...fallbackPopular]);
  const degraded = Boolean(chartError || search.failures.length);
  const now = new Date().toISOString();
  return {
    schemaVersion: 3,
    scene: { id: config.id, label: config.label, storefront: config.storefront, chartCode: config.chartCode },
    status: degraded ? 'degraded' : 'fresh',
    updatedAt: now,
    lastCheckedAt: now,
    latestWindowDays: windowDays,
    sources: {
      popular: { label: config.chartLabel, url: config.popularFeed, status: chartError ? 'failed' : 'ok' },
      discovery: {
        label: `${config.label} 최근 발매 카탈로그 후보`,
        components: [{
          label: `iTunes ${config.country} 카탈로그 검색`,
          url: SEARCH_API_URL,
          status: search.failures.length ? (search.successful ? 'partial' : 'failed') : 'ok',
          successful: search.successful,
          total: search.total,
        }],
      },
    },
    coverage: {
      keywordSearch: { successful: search.successful, total: search.total },
      releaseIndex: 'catalog-search',
      previewAvailable: songs.filter((song) => song.previewUrl).length,
      canonicalRecording: 0,
      isrc: songs.filter((song) => song.isrc).length,
      exactNonAppleLink: 0,
      enrichmentFailures: search.failures.length + (chartError ? 1 : 0),
    },
    counts: { latest: latestSongs.length, popular: fallbackPopular.length, total: songs.length },
    latestSongs,
    popularSongs: fallbackPopular,
    songs,
    staleReason: null,
  };
}

async function main() {
  const existing = await readExisting();
  let popular = [];
  let chartError = null;
  try {
    popular = await fetchPopular();
  } catch (error) {
    chartError = error;
    console.warn(`${config.chartLabel} unavailable: ${error.message}`);
  }

  const search = await fetchSearchCatalog();
  if (search.failures.length) console.warn(`${config.label} search partial failures: ${search.failures.join(' | ')}`);

  try {
    const payload = payloadFor({ popular, search, chartError });
    await writeFile(config.output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Saved ${payload.counts.latest} recent + ${payload.counts.popular} popular ${config.label} songs (${payload.status}).`);
    return;
  } catch (error) {
    if (!existing?.songs?.length) throw error;
    const stale = {
      ...existing,
      scene: existing.scene || { id: config.id, label: config.label, storefront: config.storefront, chartCode: config.chartCode },
      status: 'stale',
      lastCheckedAt: new Date().toISOString(),
      staleReason: error.message,
    };
    await writeFile(config.output, `${JSON.stringify(stale, null, 2)}\n`, 'utf8');
    console.warn(`Using stale ${config.label} fallback: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(`${config.label} collection failed:`, error);
  process.exit(1);
});
