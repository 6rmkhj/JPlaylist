const KANA = /[\u3040-\u30ff]/u;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const HANGUL = /[\uac00-\ud7a3]/u;
const LATIN = /[A-Za-z]/u;

export const GENRE_ORDER = [
  'J-Pop',
  'J-Rock',
  'Anime',
  'Vocaloid',
  'Hip-Hop',
  'R&B',
  'Electronic',
  'Alternative',
  'Kayokyoku',
  'Pop',
];

const KNOWN_ARTIST_ALIASES = new Map([
  ['米津玄師', ['Kenshi Yonezu', 'Yonezu Kenshi', '요네즈 켄시', '요네즈켄시']],
  ['あいみょん', ['Aimyon', '아이묭']],
  ['宇多田ヒカル', ['Hikaru Utada', 'Utada Hikaru', '우타다 히카루']],
  ['藤井風', ['Fujii Kaze', 'Kaze Fujii', '후지이 카제']],
  ['ヨルシカ', ['Yorushika', '요루시카']],
  ['YOASOBI', ['요아소비']],
  ['Ado', ['아도']],
  ['Mrs. GREEN APPLE', ['미세스 그린 애플', '미세스그린애플']],
  ['Official髭男dism', ['Official Hige Dandism', 'Higedan', '오피셜히게단디즘', '히게단']],
  ['King Gnu', ['킹누']],
  ['Vaundy', ['바운디']],
  ['Creepy Nuts', ['크리피 넛츠', '크리피넛츠']],
  ['back number', ['백 넘버', '백넘버']],
  ['優里', ['Yuuri', 'Yuri', '유우리']],
  ['LiSA', ['리사']],
  ['Eve', ['이브']],
  ['ずっと真夜中でいいのに。', ['ZUTOMAYO', '즛토마요']],
]);

function text(value = '') {
  return String(value).normalize('NFKC').trim();
}

export function cleanSearchQuery(value = '') {
  return text(value).replace(/\s+/g, ' ');
}

export function normalizeSearchText(value = '') {
  return cleanSearchQuery(value).toLocaleLowerCase('ja-JP');
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function knownAliasesForArtist(artist = '') {
  const normalized = normalizeSearchText(artist);
  for (const [name, aliases] of KNOWN_ARTIST_ALIASES.entries()) {
    if (normalizeSearchText(name) === normalized) return aliases;
  }
  return [];
}

export function normalizeGenre(value = '') {
  const original = text(value);
  const genre = original.toLocaleLowerCase('en-US').replace(/[‐‑‒–—]/g, '-');

  if (!genre) return 'Music';
  if (genre.includes('k-pop') || genre.includes('kpop') || genre.includes('케이팝')) return 'K-Pop';
  if (genre.includes('j-pop') || genre.includes('jpop')) return 'J-Pop';
  if (genre.includes('anime') || genre.includes('animation') || genre.includes('アニメ')) return 'Anime';
  if (genre.includes('vocaloid') || genre.includes('ボーカロイド')) return 'Vocaloid';
  if (genre.includes('j-rock') || genre.includes('rock') || genre.includes('ロック')) return 'J-Rock';
  if (genre.includes('hip-hop') || genre.includes('hip hop') || genre.includes('rap') || genre.includes('ヒップホップ') || genre.includes('ラップ')) return 'Hip-Hop';
  if (genre.includes('r&b') || genre.includes('r＆b') || genre.includes('soul') || genre.includes('ソウル')) return 'R&B';
  if (genre.includes('electronic') || genre.includes('dance') || genre.includes('エレクトロ') || genre.includes('ダンス')) return 'Electronic';
  if (genre.includes('alternative') || genre.includes('オルタナティブ')) return 'Alternative';
  if (genre.includes('歌謡曲')) return 'Kayokyoku';
  if (genre === 'pop' || genre.includes('ポップ')) return 'Pop';
  if (genre === 'music' || genre.includes('ミュージック')) return 'Music';
  return original;
}

export function getGenreTags(song = {}) {
  const values = Array.isArray(song.genres) ? song.genres : [];
  const tags = [...new Set(values.map(normalizeGenre).filter(Boolean))];
  const meaningful = tags.filter((tag) => tag !== 'Music');
  return meaningful.length ? meaningful : (tags.length ? tags : ['Music']);
}

export function getPrimaryGenre(song = {}) {
  return getGenreTags(song)[0] || 'Music';
}

export function matchesGenre(song, genre) {
  return genre === '전체' || getGenreTags(song).includes(genre);
}

export function genreSortIndex(genre) {
  const index = GENRE_ORDER.indexOf(genre);
  return index === -1 ? GENRE_ORDER.length : index;
}

export function rawGenreNames(track = {}) {
  if (Array.isArray(track.genres)) {
    return track.genres.map((genre) => text(typeof genre === 'string' ? genre : genre?.name)).filter(Boolean);
  }
  return [track.primaryGenreName, track.genre].map(text).filter(Boolean);
}

export function isLikelyJapaneseTrack(track = {}) {
  const genres = rawGenreNames(track);
  const normalized = genres.map(normalizeGenre);
  if (normalized.includes('K-Pop')) return false;

  const raw = genres.map((genre) => normalizeSearchText(genre));
  const japaneseGenreHint = raw.some((genre) =>
    ['j-pop', 'jpop', 'j-rock', 'anime', 'アニメ', '歌謡曲', '邦楽', 'ボーカロイド'].some((hint) => genre.includes(hint)),
  );
  if (japaneseGenreHint) return true;

  const title = text(track.name ?? track.trackName ?? track.title ?? '');
  const artist = text(track.artistName ?? track.artist ?? '');
  if (KANA.test(title)) return true;
  if ((KANA.test(artist) || CJK.test(artist)) && (KANA.test(title) || CJK.test(title))) return true;

  const broadJapaneseStoreGenre = normalized.some((genre) => ['J-Rock', 'Hip-Hop', 'Alternative', 'Pop', 'Electronic', 'R&B'].includes(genre));
  return broadJapaneseStoreGenre && (KANA.test(artist) || CJK.test(artist));
}

export function releaseAgeDays(releaseDate, now = new Date()) {
  if (!releaseDate) return Number.POSITIVE_INFINITY;
  const value = String(releaseDate).slice(0, 10);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

function normalizePlatformLinks(value = {}) {
  if (!value || typeof value !== 'object') return {};
  const allowed = ['spotify', 'youtubeMusic', 'youtube', 'apple', 'deezer'];
  return Object.fromEntries(
    allowed
      .map((key) => [key, typeof value[key] === 'string' ? value[key] : null])
      .filter(([, url]) => /^https:\/\//i.test(url || '')),
  );
}

export function snapshotSong(song = {}) {
  const artist = text(song.artist ?? 'Unknown artist');
  const providedAliases = Array.isArray(song.searchAliases) ? song.searchAliases : [];
  return {
    id: String(song.id ?? ''),
    title: text(song.title ?? 'Unknown title'),
    artist,
    artistId: song.artistId ? String(song.artistId) : null,
    releaseDate: song.releaseDate ? String(song.releaseDate).slice(0, 10) : null,
    artwork: song.artwork ?? null,
    genres: Array.isArray(song.genres) ? song.genres.filter(Boolean).map(String) : [],
    appleUrl: song.appleUrl ?? song.url ?? null,
    previewUrl: song.previewUrl ?? null,
    chartRank: finiteNumber(song.chartRank ?? song.rank),
    collectionId: song.collectionId === undefined || song.collectionId === null ? null : String(song.collectionId),
    collectionName: song.collectionName ? text(song.collectionName) : null,
    trackNumber: finiteNumber(song.trackNumber),
    trackCount: finiteNumber(song.trackCount),
    discNumber: finiteNumber(song.discNumber),
    discCount: finiteNumber(song.discCount),
    recordingId: song.recordingId ? String(song.recordingId) : null,
    isrc: song.isrc ? String(song.isrc).replace(/-/g, '').toUpperCase() : null,
    searchAliases: uniqueStrings([...providedAliases, ...knownAliasesForArtist(artist)]),
    platformLinks: normalizePlatformLinks(song.platformLinks),
    sourceKinds: uniqueStrings(Array.isArray(song.sourceKinds) ? song.sourceKinds : []),
    likedAt: song.likedAt ? String(song.likedAt) : null,
  };
}

export function songIdentity(song = {}) {
  const normalized = snapshotSong(song);
  if (normalized.isrc) return `isrc:${normalized.isrc}`;
  return `text:${normalizeSearchText(normalized.artist)}::${normalizeSearchText(normalized.title)}`;
}

export function parseFavorites(raw) {
  const result = new Map();
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) return result;
    for (const item of items) {
      if (!item || item.id === undefined || item.id === null) continue;
      const song = snapshotSong(item);
      if (song.id) result.set(song.id, song);
    }
  } catch {
    return result;
  }
  return result;
}

export function serializeFavorites(favorites) {
  const items = favorites instanceof Map ? [...favorites.values()] : [];
  return JSON.stringify({ version: 3, items: items.map(snapshotSong) });
}

export function languageForText(value = '') {
  const valueText = text(value);
  if (!valueText) return null;
  if (KANA.test(valueText) || CJK.test(valueText)) return 'ja';
  if (HANGUL.test(valueText)) return 'ko';
  if (LATIN.test(valueText)) return 'en';
  return null;
}

export function diversifyByArtist(songs = []) {
  const queues = new Map();
  const order = [];
  for (const song of songs) {
    const key = normalizeSearchText(song?.artist || 'unknown');
    if (!queues.has(key)) {
      queues.set(key, []);
      order.push(key);
    }
    queues.get(key).push(song);
  }

  const result = [];
  let remaining = songs.length;
  while (remaining > 0) {
    for (const key of order) {
      const queue = queues.get(key);
      if (!queue?.length) continue;
      result.push(queue.shift());
      remaining -= 1;
    }
  }
  return result;
}

function diversifyReleaseAndArtist(songs = []) {
  const queues = new Map();
  const order = [];
  for (const song of songs) {
    const normalized = snapshotSong(song);
    const releaseKey = normalized.collectionId ? `release:${normalized.collectionId}` : `artist:${normalizeSearchText(normalized.artist)}`;
    if (!queues.has(releaseKey)) {
      queues.set(releaseKey, []);
      order.push(releaseKey);
    }
    queues.get(releaseKey).push(song);
  }

  const result = [];
  let remaining = songs.length;
  while (remaining > 0) {
    for (const key of order) {
      const queue = queues.get(key);
      if (!queue?.length) continue;
      result.push(queue.shift());
      remaining -= 1;
    }
  }
  return result;
}

export function diversifyRecent(songs = [], now = new Date()) {
  const sorted = [...songs].sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  const buckets = [[], [], [], []];
  for (const song of sorted) {
    const age = releaseAgeDays(song.releaseDate, now);
    if (age <= 7) buckets[0].push(song);
    else if (age <= 30) buckets[1].push(song);
    else if (age <= 90) buckets[2].push(song);
    else buckets[3].push(song);
  }
  return buckets.flatMap(diversifyReleaseAndArtist);
}

export function searchableValues(song = {}) {
  const normalized = snapshotSong(song);
  return {
    title: normalizeSearchText(normalized.title),
    artist: normalizeSearchText(normalized.artist),
    collection: normalizeSearchText(normalized.collectionName || ''),
    aliases: normalized.searchAliases.map(normalizeSearchText),
  };
}

export function searchScore(song, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return -1;
  const values = searchableValues(song);
  if (values.title === needle) return 100;
  if (values.artist === needle) return 96;
  if (values.aliases.includes(needle)) return 92;
  if (values.title.startsWith(needle)) return 82;
  if (values.artist.startsWith(needle)) return 78;
  if (values.aliases.some((value) => value.startsWith(needle))) return 74;
  if (values.title.includes(needle)) return 64;
  if (values.artist.includes(needle)) return 60;
  if (values.aliases.some((value) => value.includes(needle))) return 56;
  if (values.collection.includes(needle)) return 38;
  return -1;
}

export function sortSearchResults(songs = [], query = '') {
  return [...songs]
    .map((song, index) => ({ song, index, score: searchScore(song, query) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ song }) => song);
}

export function parseViewParams(search = '') {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));
  const mode = params.get('mode') === 'popular' ? 'popular' : 'latest';
  const query = cleanSearchQuery(params.get('q') || '');
  return {
    activeMode: mode,
    query,
    activeGenre: text(params.get('genre') || '전체') || '전체',
    artistFilter: text(params.get('artist') || '') || null,
    releaseFilter: text(params.get('release') || '') || null,
    favoritesOnly: params.get('view') === 'favorites',
    latestSort: params.get('sort') === 'newest' ? 'newest' : 'diverse',
  };
}

export function hasShareableDiscoveryState(view = {}) {
  return Boolean(
    cleanSearchQuery(view.query || '') ||
    (view.activeGenre && view.activeGenre !== '전체') ||
    view.artistFilter ||
    view.releaseFilter ||
    view.activeMode === 'popular' ||
    view.latestSort === 'newest',
  );
}

export function serializeViewParams(view = {}) {
  const params = new URLSearchParams();
  if (view.activeMode === 'popular') params.set('mode', 'popular');
  const query = cleanSearchQuery(view.query || '');
  if (query) params.set('q', query);
  if (view.activeGenre && view.activeGenre !== '전체') params.set('genre', text(view.activeGenre));
  if (view.artistFilter) params.set('artist', text(view.artistFilter));
  if (view.releaseFilter) params.set('release', text(view.releaseFilter));
  if (view.activeMode === 'latest' && view.latestSort === 'newest') params.set('sort', 'newest');
  // favoritesOnly is intentionally local-only and is preserved in history state, not shareable URLs.
  const value = params.toString();
  return value ? `?${value}` : '';
}
