const KANA = /[\u3040-\u30ff]/u;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

function text(value = '') {
  return String(value).normalize('NFKC').trim();
}

export function normalizeSearchText(value = '') {
  return text(value).toLocaleLowerCase('ja-JP').replace(/\s+/g, ' ');
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

export function snapshotSong(song = {}) {
  return {
    id: String(song.id ?? ''),
    title: text(song.title ?? 'Unknown title'),
    artist: text(song.artist ?? 'Unknown artist'),
    artistId: song.artistId ? String(song.artistId) : null,
    releaseDate: song.releaseDate ? String(song.releaseDate).slice(0, 10) : null,
    artwork: song.artwork ?? null,
    genres: Array.isArray(song.genres) ? song.genres.filter(Boolean).map(String) : [],
    appleUrl: song.appleUrl ?? song.url ?? null,
    previewUrl: song.previewUrl ?? null,
    chartRank: Number.isFinite(Number(song.chartRank ?? song.rank)) ? Number(song.chartRank ?? song.rank) : null,
  };
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
  return JSON.stringify({ version: 2, items: items.map(snapshotSong) });
}
