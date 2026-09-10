import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  isLikelyJapaneseTrack,
  normalizeGenre,
  normalizeSearchText,
  releaseAgeDays,
  snapshotSong,
} from '../core.mjs';

const POPULAR_FEED_URL = 'https://rss.marketingtools.apple.com/api/v2/jp/music/most-played/100/songs.json';
const SEARCH_API_URL = 'https://itunes.apple.com/search';
const MUSICBRAINZ_RECORDING_URL = 'https://musicbrainz.org/ws/2/recording/';
const SEARCH_TERMS = ['J-Pop', 'J-Rock', 'アニメ', 'ボーカロイド', '邦楽'];
const OUTPUT_PATH = new URL('../data/songs.json', import.meta.url);
const PRIMARY_LATEST_DAYS = 180;
const FALLBACK_LATEST_DAYS = 365;
const MIN_POPULAR = 20;
const MIN_LATEST = 8;
const MUSICBRAINZ_DISCOVERY_LIMIT = 100;
const MUSICBRAINZ_ENRICH_TARGETS = 12;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;
const USER_AGENT = 'JPlaylist/3.0 (+https://github.com/6rmkhj/JPlaylist)';
let lastMusicBrainzRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      schemaVersion: 3,
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

async function fetchMusicBrainzJson(url, label) {
  const wait = Math.max(0, MUSICBRAINZ_MIN_INTERVAL_MS - (Date.now() - lastMusicBrainzRequestAt));
  if (wait) await sleep(wait);
  lastMusicBrainzRequestAt = Date.now();
  return fetchJson(url, label);
}

function textIdentity(song) {
  return `${normalizeSearchText(song?.artist || '')}::${normalizeSearchText(song?.title || '')}`;
}

function preferredId(a, b) {
  const ids = [b?.id, a?.id].filter(Boolean).map(String);
  return ids.find((id) => !id.startsWith('mb:')) || ids[0] || '';
}

function mergeSong(base, incoming) {
  const a = snapshotSong(base);
  const b = snapshotSong(incoming);
  return snapshotSong({
    ...a,
    ...b,
    id: preferredId(a, b),
    title: b.title !== 'Unknown title' ? b.title : a.title,
    artist: b.artist !== 'Unknown artist' ? b.artist : a.artist,
    artistId: b.artistId || a.artistId,
    releaseDate: b.releaseDate || a.releaseDate,
    artwork: b.artwork || a.artwork,
    genres: [...new Set([...(a.genres || []), ...(b.genres || [])])],
    appleUrl: b.appleUrl || a.appleUrl,
    previewUrl: b.previewUrl || a.previewUrl,
    chartRank: b.chartRank || a.chartRank,
    collectionId: b.collectionId || a.collectionId,
    collectionName: b.collectionName || a.collectionName,
    trackNumber: b.trackNumber || a.trackNumber,
    trackCount: b.trackCount || a.trackCount,
    discNumber: b.discNumber || a.discNumber,
    discCount: b.discCount || a.discCount,
    recordingId: b.recordingId || a.recordingId,
    isrc: b.isrc || a.isrc,
    searchAliases: [...new Set([...(a.searchAliases || []), ...(b.searchAliases || [])])],
    platformLinks: { ...(a.platformLinks || {}), ...(b.platformLinks || {}) },
    sourceKinds: [...new Set([...(a.sourceKinds || []), ...(b.sourceKinds || [])])],
    likedAt: b.likedAt || a.likedAt,
  });
}

function dedupe(songs) {
  const result = [];
  const idIndex = new Map();
  const textIndex = new Map();
  const isrcIndex = new Map();

  for (const raw of songs || []) {
    const song = snapshotSong(raw);
    if (!song.id) continue;
    const identity = textIdentity(song);
    const existingIndex = idIndex.get(song.id) ?? (song.isrc ? isrcIndex.get(song.isrc) : undefined) ?? textIndex.get(identity);
    if (existingIndex !== undefined) {
      result[existingIndex] = mergeSong(result[existingIndex], song);
      const merged = result[existingIndex];
      idIndex.set(merged.id, existingIndex);
      textIndex.set(textIdentity(merged), existingIndex);
      if (merged.isrc) isrcIndex.set(merged.isrc, existingIndex);
      continue;
    }

    const index = result.length;
    result.push(song);
    idIndex.set(song.id, index);
    textIndex.set(identity, index);
    if (song.isrc) isrcIndex.set(song.isrc, index);
  }
  return result;
}

function buildExistingIndexes(existing) {
  const songs = dedupe([...(existing?.latestSongs || []), ...(existing?.popularSongs || []), ...(existing?.songs || [])]);
  return {
    byId: new Map(songs.map((song) => [song.id, song])),
    byText: new Map(songs.map((song) => [textIdentity(song), song])),
    byIsrc: new Map(songs.filter((song) => song.isrc).map((song) => [song.isrc, song])),
  };
}

function reuseExisting(song, indexes) {
  const current = snapshotSong(song);
  const old = indexes.byId.get(current.id) || (current.isrc ? indexes.byIsrc.get(current.isrc) : null) || indexes.byText.get(textIdentity(current));
  return old ? mergeSong(old, current) : current;
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
    platformLinks: track.url ? { apple: track.url } : {},
    sourceKinds: ['apple-jp-chart'],
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
    collectionId: track.collectionId,
    collectionName: track.collectionName,
    trackNumber: track.trackNumber,
    trackCount: track.trackCount,
    discNumber: track.discNumber,
    discCount: track.discCount,
    platformLinks: track.trackViewUrl ? { apple: track.trackViewUrl } : {},
    sourceKinds: ['itunes-jp-search'],
  });
}

function artistCreditName(recording) {
  return (recording?.['artist-credit'] || [])
    .map((credit) => `${credit?.name || credit?.artist?.name || ''}${credit?.joinphrase || ''}`)
    .join('')
    .trim();
}

function normalizeMusicBrainzRecording(recording) {
  const release = Array.isArray(recording?.releases) ? recording.releases[0] : null;
  const tags = Array.isArray(recording?.tags) ? recording.tags.map((tag) => tag?.name).filter(Boolean) : [];
  return snapshotSong({
    id: `mb:${recording.id}`,
    title: recording.title,
    artist: artistCreditName(recording),
    artistId: recording?.['artist-credit']?.[0]?.artist?.id,
    releaseDate: recording?.['first-release-date'] || release?.date,
    genres: tags,
    collectionId: release?.id ? `mb:${release.id}` : null,
    collectionName: release?.title || null,
    recordingId: recording.id,
    isrc: Array.isArray(recording.isrcs) ? recording.isrcs[0] : null,
    sourceKinds: ['musicbrainz-jp-release-index'],
  });
}

async function fetchPopular(existingIndexes) {
  const data = await fetchJson(POPULAR_FEED_URL, 'Apple Music Japan chart');
  const results = data?.feed?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error('Apple Music Japan chart returned no songs');

  const selected = results
    .map((track, index) => ({ track, song: normalizePopular(track, index) }))
    .filter(({ track, song }) => isLikelyJapaneseTrack(track) && normalizeGenre(song.genres?.[0]) !== 'K-Pop')
    .map(({ song }) => reuseExisting(song, existingIndexes));

  if (selected.length < MIN_POPULAR) {
    throw new Error(`Japanese popular-song filter returned only ${selected.length} songs`);
  }
  return selected;
}

async function fetchDiscoveryCandidates(existingIndexes) {
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
        songs.push(reuseExisting(song, existingIndexes));
      }
    } catch (error) {
      failures.push(`${term}: ${error.message}`);
    }
  }

  return { songs: dedupe(songs), failures };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchMusicBrainzRecent(existingIndexes) {
  const now = new Date();
  const from = new Date(now.getTime() - PRIMARY_LATEST_DAYS * 86_400_000);
  const url = new URL(MUSICBRAINZ_RECORDING_URL);
  url.searchParams.set('query', `firstreleasedate:[${isoDate(from)} TO ${isoDate(now)}] AND country:JP AND video:false`);
  url.searchParams.set('limit', String(MUSICBRAINZ_DISCOVERY_LIMIT));
  url.searchParams.set('fmt', 'json');

  const data = await fetchMusicBrainzJson(url, 'MusicBrainz Japan release index');
  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
  const songs = recordings
    .map(normalizeMusicBrainzRecording)
    .filter((song) => song.title && song.artist && releaseAgeDays(song.releaseDate) <= PRIMARY_LATEST_DAYS)
    .filter((song) => isLikelyJapaneseTrack({ name: song.title, artistName: song.artist, genres: song.genres }))
    .map((song) => reuseExisting(song, existingIndexes));
  return dedupe(songs);
}

function buildLatest(discoverySongs, musicBrainzSongs, popularSongs) {
  const combined = dedupe([...popularSongs, ...discoverySongs, ...musicBrainzSongs]);
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

function luceneQuote(value = '') {
  return String(value).replace(/([\\"])/g, '\\$1');
}

function candidateMatchesSong(recording, song) {
  const title = normalizeSearchText(recording?.title || '');
  const artist = normalizeSearchText(artistCreditName(recording));
  const wantedTitle = normalizeSearchText(song.title);
  const wantedArtist = normalizeSearchText(song.artist);
  if (!title || title !== wantedTitle || !artist || !wantedArtist) return false;
  return artist.includes(wantedArtist) || wantedArtist.includes(artist);
}

async function findMusicBrainzRecording(song) {
  if (song.recordingId) return song.recordingId;
  const url = new URL(MUSICBRAINZ_RECORDING_URL);
  url.searchParams.set('query', `recording:"${luceneQuote(song.title)}" AND artist:"${luceneQuote(song.artist)}"`);
  url.searchParams.set('limit', '5');
  url.searchParams.set('fmt', 'json');
  const data = await fetchMusicBrainzJson(url, `MusicBrainz match (${song.artist} - ${song.title})`);
  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
  return recordings.find((recording) => candidateMatchesSong(recording, song))?.id || null;
}

function relationPlatform(resource = '') {
  try {
    const url = new URL(resource);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'open.spotify.com' && url.pathname.includes('/track/')) return 'spotify';
    if (host === 'music.youtube.com') return 'youtubeMusic';
    if ((host === 'youtube.com' || host === 'youtu.be') && resource) return 'youtube';
    if (host === 'music.apple.com') return 'apple';
    if (host === 'deezer.com' && url.pathname.includes('/track/')) return 'deezer';
  } catch {
    return null;
  }
  return null;
}

async function lookupMusicBrainzRecording(recordingId) {
  const url = new URL(`${MUSICBRAINZ_RECORDING_URL}${encodeURIComponent(recordingId)}`);
  url.searchParams.set('inc', 'isrcs+url-rels+artist-credits');
  url.searchParams.set('fmt', 'json');
  const data = await fetchMusicBrainzJson(url, `MusicBrainz recording ${recordingId}`);
  const links = {};
  for (const relation of data?.relations || []) {
    const resource = relation?.url?.resource;
    const platform = relationPlatform(resource);
    if (platform && !links[platform]) links[platform] = resource;
  }
  return {
    recordingId: data?.id || recordingId,
    isrc: Array.isArray(data?.isrcs) ? data.isrcs[0] : null,
    platformLinks: links,
  };
}

async function enrichCanonical(songs) {
  const targets = dedupe(songs)
    .filter((song) => !song.recordingId || !song.isrc || Object.keys(song.platformLinks || {}).length <= 1)
    .slice(0, MUSICBRAINZ_ENRICH_TARGETS);
  const enrichment = new Map();
  const failures = [];

  for (const song of targets) {
    try {
      const recordingId = await findMusicBrainzRecording(song);
      if (!recordingId) continue;
      const details = await lookupMusicBrainzRecording(recordingId);
      enrichment.set(song.id, snapshotSong({
        ...song,
        ...details,
        platformLinks: { ...(song.platformLinks || {}), ...(details.platformLinks || {}) },
        sourceKinds: [...new Set([...(song.sourceKinds || []), 'musicbrainz-canonical'])],
      }));
    } catch (error) {
      failures.push(`${song.artist} - ${song.title}: ${error.message}`);
    }
  }

  return { enrichment, failures };
}

function applyEnrichment(songs, enrichment) {
  return songs.map((song) => enrichment.get(song.id) || song);
}

function coverageFor(latestSongs, popularSongs, sourceHealth, enrichmentFailures) {
  const all = dedupe([...latestSongs, ...popularSongs]);
  return {
    keywordSearch: {
      successful: SEARCH_TERMS.length - sourceHealth.discoveryFailures.length,
      total: SEARCH_TERMS.length,
    },
    releaseIndex: sourceHealth.musicBrainzRecentOk ? 'ok' : 'failed',
    previewAvailable: all.filter((song) => song.previewUrl).length,
    canonicalRecording: all.filter((song) => song.recordingId).length,
    isrc: all.filter((song) => song.isrc).length,
    exactNonAppleLink: all.filter((song) => song.platformLinks?.spotify || song.platformLinks?.youtubeMusic || song.platformLinks?.youtube).length,
    enrichmentFailures: enrichmentFailures.length,
  };
}

function makePayload({ popularSongs, latestSongs, latestWindowDays, sourceHealth, enrichmentFailures }) {
  const updatedAt = new Date().toISOString();
  const allSongs = dedupe([...latestSongs, ...popularSongs]);
  const degraded = sourceHealth.discoveryFailures.length > 0 || !sourceHealth.musicBrainzRecentOk;
  return {
    schemaVersion: 3,
    status: degraded ? 'degraded' : 'fresh',
    updatedAt,
    lastCheckedAt: updatedAt,
    latestWindowDays,
    sources: {
      popular: {
        label: 'Apple Music Japan 인기 차트',
        url: POPULAR_FEED_URL,
      },
      discovery: {
        label: '최근 발매 통합 후보',
        components: [
          {
            label: 'MusicBrainz 일본 발매일 인덱스',
            url: MUSICBRAINZ_RECORDING_URL,
            status: sourceHealth.musicBrainzRecentOk ? 'ok' : 'failed',
          },
          {
            label: 'iTunes Japan 카탈로그 검색',
            url: SEARCH_API_URL,
            status: sourceHealth.discoveryFailures.length ? 'partial' : 'ok',
            successful: SEARCH_TERMS.length - sourceHealth.discoveryFailures.length,
            total: SEARCH_TERMS.length,
          },
        ],
      },
      canonical: {
        label: 'MusicBrainz recording / ISRC / URL 관계',
        url: MUSICBRAINZ_RECORDING_URL,
        note: enrichmentFailures.length ? `일부 매칭 확인 실패 ${enrichmentFailures.length}건` : '점진적 누적 매칭',
      },
    },
    coverage: coverageFor(latestSongs, popularSongs, sourceHealth, enrichmentFailures),
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
  const existing = normalizeExisting(await readExisting());
  const existingIndexes = buildExistingIndexes(existing);
  const popularSongs = await fetchPopular(existingIndexes);
  const discovery = await fetchDiscoveryCandidates(existingIndexes);

  let musicBrainzRecent = [];
  let musicBrainzRecentOk = true;
  try {
    musicBrainzRecent = await fetchMusicBrainzRecent(existingIndexes);
  } catch (error) {
    musicBrainzRecentOk = false;
    console.warn(`MusicBrainz recent-release coverage unavailable: ${error.message}`);
  }

  const latest = buildLatest(discovery.songs, musicBrainzRecent, popularSongs);
  if (latest.songs.length < MIN_LATEST) {
    throw new Error(`Latest-song pool returned only ${latest.songs.length} songs`);
  }

  const canonical = await enrichCanonical([...latest.songs, ...popularSongs]);
  const enrichedLatest = applyEnrichment(latest.songs, canonical.enrichment);
  const enrichedPopular = applyEnrichment(popularSongs, canonical.enrichment);
  const sourceHealth = {
    discoveryFailures: discovery.failures,
    musicBrainzRecentOk,
  };
  const payload = makePayload({
    popularSongs: enrichedPopular,
    latestSongs: enrichedLatest,
    latestWindowDays: latest.windowDays,
    sourceHealth,
    enrichmentFailures: canonical.failures,
  });
  await writePayload(payload);
  console.log(`Saved ${payload.counts.latest} recent + ${payload.counts.popular} popular Japanese songs.`);
  console.log(`Coverage: release-index=${payload.coverage.releaseIndex}, canonical=${payload.coverage.canonicalRecording}, ISRC=${payload.coverage.isrc}, exact-non-Apple=${payload.coverage.exactNonAppleLink}.`);
  if (discovery.failures.length) console.warn(`Discovery partial failures: ${discovery.failures.join(' | ')}`);
  if (canonical.failures.length) console.warn(`Canonical enrichment partial failures: ${canonical.failures.join(' | ')}`);
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
    schemaVersion: 3,
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
