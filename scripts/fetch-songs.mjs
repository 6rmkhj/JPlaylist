import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isLikelyJapaneseTrack, normalizeGenre, releaseAgeDays, snapshotSong } from '../core.mjs';

const POPULAR_FEED_URL = 'https://rss.applemarketingtools.com/api/v2/jp/music/most-played/100/songs.json';
const SEARCH_API_URL = 'https://itunes.apple.com/search';
const SEARCH_TERMS = ['J-Pop', 'J-Rock', 'アニメ', 'ボーカロイド', '邦楽'];
const OUTPUT_PATH = new URL('../data/songs.json', import.meta.url);
const PRIMARY_LATEST_DAYS = 180;
const FALLBACK_LATEST_DAYS = 365;
const MIN_POPULAR = 20;
const MIN_LATEST = 8;
const USER_AGENT = 'JPlaylist/2.0 (+https://github.com/6rmkhj/JPlaylist)';

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeExisting(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.popularSongs)) {
    return {
      ...payload,
      popularSongs: payload.popularSongs.map(snapshotSong),
      latestSongs: Array.isArray(payload.latestSongs) ? payload.latestSongs.map(snapshotSong) : [],
    };
  }
  if (Array.isArray(payload.songs) && payload.songs.length) {
    const popularSongs = payload.songs.map((song) => snapshotSong({ ...song, chartRank: song.chartRank ?? song.rank }));
    const latestSongs = popularSongs
      .filter((song) => releaseAgeDays(song.releaseDate) <= FALLBACK_LATEST_DAYS)
      .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
    return {
      schemaVersion: 2,
      status: 'stale',
      updatedAt: payload.updatedAt ?? null,
      lastCheckedAt: payload.updatedAt ?? null,
      latestWindowDays: FALLBACK_LATEST_DAYS,
      latestSongs,
      popularSongs,
    };
  }
  return null;
}

function validExisting(payload) {
  return Boolean(
    payload &&
    Array.isArray(payload.popularSongs) && payload.popularSongs.length >= MIN_POPULAR &&
    Array.isArray(payload.latestSongs) && payload.latestSongs.length > 0,
  );
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

function normalizePopular(track, index) {
  return snapshotSong({
    id: track.id,
    title: track.name,
    artist: track.artistName,
    artistId: track.artistId,
    releaseDate: track.releaseDate,
    artwork: track.artworkUrl100,
    genres: (track.genres ?? []).map((genre) => genre?.name).filter(Boolean),
    appleUrl: track.url,
    chartRank: index + 1,
  });
}

function normalizeSearch(track) {
  return snapshotSong({
    id: track.trackId,
    title: track.trackName,
    artist: track.artistName,
    artistId: track.artistId,
    releaseDate: track.releaseDate,
    artwork: track.artworkUrl100,
    genres: [track.primaryGenreName].filter(Boolean),
    appleUrl: track.trackViewUrl,
    previewUrl: track.previewUrl,
    chartRank: null,
  });
}

function mergeSong(base, incoming) {
  const a = snapshotSong(base);
  const b = snapshotSong(incoming);
  return {
    ...a,
    ...b,
    title: b.title !== 'Unknown title' ? b.title : a.title,
    artist: b.artist !== 'Unknown artist' ? b.artist : a.artist,
    artistId: b.artistId || a.artistId,
    releaseDate: b.releaseDate || a.releaseDate,
    artwork: b.artwork || a.artwork,
    genres: [...new Set([...(a.genres || []), ...(b.genres || [])])],
    appleUrl: b.appleUrl || a.appleUrl,
    previewUrl: b.previewUrl || a.previewUrl,
    chartRank: b.chartRank || a.chartRank,
  };
}

function dedupe(songs) {
  const map = new Map();
  for (const song of songs) {
    if (!song?.id) continue;
    map.set(song.id, map.has(song.id) ? mergeSong(map.get(song.id), song) : snapshotSong(song));
  }
  return [...map.values()];
}

async function fetchPopular() {
  const data = await fetchJson(POPULAR_FEED_URL, 'Apple Music Japan chart');
  const results = data?.feed?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error('Apple Music Japan chart returned no songs');

  const selected = results
    .map((track, index) => ({ track, song: normalizePopular(track, index) }))
    .filter(({ track, song }) => isLikelyJapaneseTrack(track) && normalizeGenre(song.genres?.[0]) !== 'K-Pop')
    .map(({ song }) => song);

  if (selected.length < MIN_POPULAR) {
    throw new Error(`Japanese popular-song filter returned only ${selected.length} songs`);
  }
  return selected;
}

async function fetchDiscoveryCandidates() {
  const songs = [];
  const failures = [];

  for (const term of SEARCH_TERMS) {
    const url = new URL(SEARCH_API_URL);
    url.searchParams.set('term', term);
    url.searchParams.set('country', 'JP');
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', '200');
    url.searchParams.set('lang', 'ja_jp');

    try {
      const data = await fetchJson(url, `iTunes Search (${term})`);
      const results = Array.isArray(data?.results) ? data.results : [];
      for (const track of results) {
        if (!isLikelyJapaneseTrack(track)) continue;
        const song = normalizeSearch(track);
        if (normalizeGenre(song.genres?.[0]) === 'K-Pop') continue;
        songs.push(song);
      }
    } catch (error) {
      failures.push(`${term}: ${error.message}`);
    }
  }

  return { songs: dedupe(songs), failures };
}

function buildLatest(discoverySongs, popularSongs) {
  const combined = dedupe([...popularSongs, ...discoverySongs]);
  const sortNewest = (items) => items.sort((a, b) => {
    const byDate = String(b.releaseDate || '').localeCompare(String(a.releaseDate || ''));
    if (byDate) return byDate;
    return (a.chartRank ?? 999) - (b.chartRank ?? 999);
  });

  const primary = sortNewest(combined.filter((song) => releaseAgeDays(song.releaseDate) <= PRIMARY_LATEST_DAYS));
  if (primary.length >= MIN_LATEST) return { songs: primary, windowDays: PRIMARY_LATEST_DAYS };

  const fallback = sortNewest(combined.filter((song) => releaseAgeDays(song.releaseDate) <= FALLBACK_LATEST_DAYS));
  return { songs: fallback, windowDays: FALLBACK_LATEST_DAYS };
}

function makePayload({ popularSongs, latestSongs, latestWindowDays, discoveryFailures }) {
  const updatedAt = new Date().toISOString();
  const allSongs = dedupe([...latestSongs, ...popularSongs]);
  return {
    schemaVersion: 2,
    status: 'fresh',
    updatedAt,
    lastCheckedAt: updatedAt,
    latestWindowDays,
    sources: {
      popular: {
        label: 'Apple Music Japan 인기 차트',
        url: POPULAR_FEED_URL,
      },
      discovery: {
        label: 'iTunes Search API 최근 발매 후보',
        url: SEARCH_API_URL,
        note: discoveryFailures.length ? `일부 검색 실패: ${discoveryFailures.length}/${SEARCH_TERMS.length}` : '정상',
      },
    },
    counts: {
      latest: latestSongs.length,
      popular: popularSongs.length,
      total: allSongs.length,
    },
    latestSongs,
    popularSongs,
    songs: allSongs,
  };
}

async function writePayload(payload) {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const popularSongs = await fetchPopular();
  const discovery = await fetchDiscoveryCandidates();
  const latest = buildLatest(discovery.songs, popularSongs);

  if (latest.songs.length < MIN_LATEST) {
    throw new Error(`Latest-song pool returned only ${latest.songs.length} songs`);
  }

  const payload = makePayload({
    popularSongs,
    latestSongs: latest.songs,
    latestWindowDays: latest.windowDays,
    discoveryFailures: discovery.failures,
  });
  await writePayload(payload);
  console.log(`Saved ${payload.counts.latest} recent + ${payload.counts.popular} popular Japanese songs.`);
  if (discovery.failures.length) console.warn(`Discovery partial failures: ${discovery.failures.join(' | ')}`);
}

main().catch(async (error) => {
  console.error(`Song collection failed: ${error.message}`);
  const existing = normalizeExisting(await readExisting());
  if (!validExisting(existing)) {
    console.error('No valid last-success snapshot exists; refusing to deploy empty or invalid data.');
    process.exitCode = 1;
    return;
  }

  const stalePayload = {
    ...existing,
    schemaVersion: 2,
    status: 'stale',
    lastCheckedAt: new Date().toISOString(),
    staleReason: error.message,
    counts: {
      latest: existing.latestSongs.length,
      popular: existing.popularSongs.length,
      total: dedupe([...existing.latestSongs, ...existing.popularSongs]).length,
    },
    songs: dedupe([...existing.latestSongs, ...existing.popularSongs]),
  };
  await writePayload(stalePayload);
  console.warn(`Using last successful snapshot from ${stalePayload.updatedAt || 'unknown time'}.`);
});
