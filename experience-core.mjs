import { getGenreTags, normalizeSearchText, releaseAgeDays, snapshotSong } from './core.mjs';

export const DAILY_ROLES = [
  { key: 'safe', label: '안전픽', eyebrow: '지금 취향 안쪽', description: '좋아하는 결에 가장 가까운 한 곡' },
  { key: 'step', label: '한 발 밖', eyebrow: '취향 경계', description: '익숙함을 남기고 아티스트나 장르를 한 칸 넓히는 곡' },
  { key: 'deep', label: '딥 다이브', eyebrow: '오늘의 모험', description: '평소 검색으로는 만나기 어려운 발견 후보' },
];

export const RABBIT_DIRECTIONS = {
  deeper: { label: '더 깊게', description: '결은 이어가되 차트 밖과 숨은 곡 쪽으로 이동' },
  newer: { label: '더 새롭게', description: '지금 결에서 더 최근 발매와 새 아티스트 쪽으로 이동' },
  stranger: { label: '더 낯설게', description: '장르와 아티스트를 바꿔 취향 경계 밖으로 이동' },
};

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function stableUnit(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function dedupeSongs(items = []) {
  const map = new Map();
  for (const raw of items || []) {
    const song = snapshotSong(raw);
    if (!song.id || map.has(song.id)) continue;
    map.set(song.id, song);
  }
  return [...map.values()];
}

function normalizedArtist(song) {
  return normalizeSearchText(song?.artist || '');
}

export function popularityScore(song) {
  if (!song?.chartRank) return 0.38;
  return 1 - Math.min(Math.max(Number(song.chartRank) - 1, 0) / 100, 1);
}

export function recencyScore(song, now = new Date()) {
  const days = releaseAgeDays(song?.releaseDate, now);
  if (days <= 14) return 1;
  if (days <= 30) return 0.9;
  if (days <= 90) return 0.72;
  if (days <= 180) return 0.56;
  if (days <= 365) return 0.36;
  return 0.16;
}

function weightedSignals({ favorites = [], activity = [], catalog = [] } = {}) {
  const catalogById = new Map(catalog.map((song) => [String(song.id), snapshotSong(song)]));
  const result = [];
  for (const favorite of favorites) {
    const song = snapshotSong(favorite);
    if (song.id) result.push({ song, weight: 3 });
  }
  for (const item of activity.slice(-40)) {
    const song = catalogById.get(String(item?.id));
    if (!song) continue;
    const weight = item.kind === 'listen' ? 1.45 : item.kind === 'preview' ? 1.2 : 0.85;
    result.push({ song, weight });
  }
  return result;
}

function weightedAverage(items, selector, fallback = 0.5) {
  if (!items.length) return fallback;
  let value = 0;
  let total = 0;
  for (const item of items) {
    value += selector(item.song) * item.weight;
    total += item.weight;
  }
  return total ? value / total : fallback;
}

function normalizedEntropy(counts) {
  const values = [...counts.values()].filter((value) => value > 0);
  if (values.length <= 1) return values.length ? 0.15 : 0.5;
  const total = values.reduce((sum, value) => sum + value, 0);
  const entropy = values.reduce((sum, value) => {
    const p = value / total;
    return sum - p * Math.log(p);
  }, 0);
  return Math.min(1, entropy / Math.log(Math.min(6, values.length)));
}

export function buildTasteProfile({ favorites = [], activity = [], catalog = [], now = new Date() } = {}) {
  const normalizedFavorites = dedupeSongs(favorites);
  const favoriteIds = new Set(normalizedFavorites.map((song) => song.id));
  const genreCounts = new Map();
  const artistCounts = new Map();

  for (const song of normalizedFavorites) {
    const artist = normalizedArtist(song);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    for (const genre of getGenreTags(song)) {
      if (!genre || genre === 'Music' || genre === 'K-Pop') continue;
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }

  const signals = weightedSignals({ favorites: normalizedFavorites, activity, catalog });
  const signalArtists = signals.map(({ song }) => normalizedArtist(song)).filter(Boolean);
  const uniqueSignalArtists = new Set(signalArtists);
  const unfamiliarCount = signals.filter(({ song }) => !artistCounts.has(normalizedArtist(song))).length;
  const unfamiliarRatio = signals.length ? unfamiliarCount / signals.length : 0.52;
  const uniqueRatio = signals.length ? uniqueSignalArtists.size / signals.length : 0.52;
  const exploration = Math.min(1, unfamiliarRatio * 0.58 + uniqueRatio * 0.42);
  const deepCut = weightedAverage(signals, (song) => 1 - popularityScore(song), 0.52);
  const freshness = weightedAverage(signals, (song) => recencyScore(song, now), 0.58);
  const breadth = normalizedEntropy(genreCounts);
  const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]);

  let mapLabel = '균형 탐험가';
  if (deepCut >= 0.58 && exploration >= 0.58) mapLabel = '딥 다이버';
  else if (deepCut >= 0.58) mapLabel = '숨은 취향 수집가';
  else if (exploration >= 0.58) mapLabel = '신곡 탐험가';
  else if (deepCut < 0.42 && exploration < 0.42) mapLabel = '차트 코어';

  return {
    favorites: normalizedFavorites,
    favoriteIds,
    genreCounts,
    artistCounts,
    topGenres,
    topArtists,
    deepCut,
    exploration,
    freshness,
    breadth,
    mapX: Math.round(deepCut * 100),
    mapY: Math.round(exploration * 100),
    mapLabel,
  };
}

export function affinityScore(song, profile) {
  if (!profile?.favorites?.length) return 0.25;
  const artistAffinity = profile.artistCounts.has(normalizedArtist(song)) ? 1 : 0;
  const maxGenreCount = Math.max(1, ...profile.genreCounts.values());
  const genreAffinity = Math.max(0, ...getGenreTags(song).map((genre) => (profile.genreCounts.get(genre) || 0) / maxGenreCount));
  return Math.min(1, genreAffinity * 0.74 + artistAffinity * 0.4);
}

export function discoveryScore(song, profile) {
  const unseenArtist = profile?.artistCounts?.has(normalizedArtist(song)) ? 0 : 1;
  const uncommon = song?.chartRank && song.chartRank <= 20 ? 0.28 : 0.82;
  return Math.min(1, unseenArtist * 0.7 + uncommon * 0.3);
}

function roleScore(role, song, profile, { dayKey, offset = 0, now = new Date() } = {}) {
  const affinity = affinityScore(song, profile);
  const popularity = popularityScore(song);
  const recency = recencyScore(song, now);
  const discovery = discoveryScore(song, profile);
  const jitter = stableUnit(`${dayKey}:${offset}:${role}:${song.id}`) * 0.07;

  if (role === 'safe') return affinity * 0.58 + popularity * 0.2 + recency * 0.15 + jitter;
  if (role === 'step') {
    const edgeAffinity = 1 - Math.abs(affinity - 0.42) * 1.3;
    return edgeAffinity * 0.29 + discovery * 0.31 + recency * 0.23 + popularity * 0.1 + jitter;
  }
  return discovery * 0.47 + (1 - popularity) * 0.25 + recency * 0.13 + affinity * 0.08 + jitter;
}

function roleReason(role, song, profile, now = new Date()) {
  const matchedGenre = getGenreTags(song).find((genre) => profile.genreCounts.has(genre));
  const familiarArtist = profile.artistCounts.has(normalizedArtist(song));
  const days = releaseAgeDays(song.releaseDate, now);

  if (role === 'safe') {
    if (familiarArtist) return '좋아한 아티스트의 다른 결을 이어가요';
    if (matchedGenre) return `좋아한 ${matchedGenre} 안에서 고른 안정적인 발견`;
    if (song.chartRank && song.chartRank <= 20) return `일본 차트 흐름에서 가장 가까운 안전픽`;
    return '현재 취향 신호와 가장 가까운 한 곡';
  }
  if (role === 'step') {
    if (matchedGenre) return `${matchedGenre}의 익숙함은 남기고 새 아티스트로 한 발`;
    if (days <= 30) return '최근 발매의 에너지로 취향 경계를 한 칸 넓혀요';
    return '익숙함과 낯섦이 반반인 경계선 추천';
  }
  if (!song.chartRank || song.chartRank > 40) return '차트 중심 탐색에서 놓치기 쉬운 딥컷 후보';
  if (!matchedGenre) return '평소 저장한 장르 밖에서 찾은 오늘의 모험';
  return `${matchedGenre} 안에서도 덜 뻔한 방향으로 더 깊게`;
}

function pickBest(candidates, role, profile, used, options) {
  return candidates
    .filter((song) => !used.ids.has(song.id))
    .filter((song) => !used.artists.has(normalizedArtist(song)))
    .filter((song) => !song.collectionId || !used.releases.has(String(song.collectionId)))
    .sort((a, b) => roleScore(role, b, profile, options) - roleScore(role, a, profile, options))[0]
    || candidates
      .filter((song) => !used.ids.has(song.id))
      .sort((a, b) => roleScore(role, b, profile, options) - roleScore(role, a, profile, options))[0]
    || null;
}

export function buildDailyThree({ catalog = [], profile, hiddenIds = [], dayKey = localDateKey(), offset = 0, now = new Date() } = {}) {
  const hidden = new Set(hiddenIds.map(String));
  const candidates = dedupeSongs(catalog).filter((song) => !profile.favoriteIds.has(song.id) && !hidden.has(song.id));
  const used = { ids: new Set(), artists: new Set(), releases: new Set() };
  const picks = [];

  for (const role of DAILY_ROLES) {
    const song = pickBest(candidates, role.key, profile, used, { dayKey, offset, now });
    if (!song) continue;
    used.ids.add(song.id);
    used.artists.add(normalizedArtist(song));
    if (song.collectionId) used.releases.add(String(song.collectionId));
    picks.push({ ...role, song, reason: roleReason(role.key, song, profile, now) });
  }
  return picks;
}

function sharedGenreScore(a, b) {
  const aGenres = new Set(getGenreTags(a));
  const bGenres = getGenreTags(b);
  return bGenres.some((genre) => aGenres.has(genre)) ? 1 : 0;
}

function rabbitScore(candidate, current, profile, direction, { dayKey, offset = 0, step = 0, now = new Date() } = {}) {
  const shared = sharedGenreScore(current, candidate);
  const unseenArtist = profile.artistCounts.has(normalizedArtist(candidate)) ? 0 : 1;
  const deep = 1 - popularityScore(candidate);
  const fresh = recencyScore(candidate, now);
  const differentGenre = 1 - shared;
  const jitter = stableUnit(`${dayKey}:${offset}:${direction}:${step}:${current.id}:${candidate.id}`) * 0.08;

  if (direction === 'newer') return fresh * 0.44 + shared * 0.24 + unseenArtist * 0.19 + deep * 0.05 + jitter;
  if (direction === 'stranger') return differentGenre * 0.4 + unseenArtist * 0.31 + deep * 0.16 + fresh * 0.05 + jitter;
  return shared * 0.4 + deep * 0.28 + unseenArtist * 0.17 + fresh * 0.07 + jitter;
}

function transitionReason(from, to, direction) {
  const shared = getGenreTags(to).find((genre) => getGenreTags(from).includes(genre));
  if (direction === 'newer') {
    if (shared) return `${shared} 결은 유지하고 더 최근 발매로 이동`;
    return '현재 에너지에서 더 최근의 새 아티스트로 이동';
  }
  if (direction === 'stranger') {
    if (!shared) return '장르와 아티스트를 모두 바꿔 취향 경계 밖으로 이동';
    return `${shared} 한 가지만 남기고 나머지는 낯선 방향으로 이동`;
  }
  if (shared) return `${shared} 결을 이어가며 더 깊은 곡으로 이동`;
  return '분위기의 연결고리만 남기고 차트 밖으로 더 깊게 이동';
}

export function buildRabbitHole({ start, catalog = [], profile, hiddenIds = [], direction = 'deeper', dayKey = localDateKey(), offset = 0, steps = 5, now = new Date() } = {}) {
  if (!start?.id) return [];
  const hidden = new Set(hiddenIds.map(String));
  const pool = dedupeSongs(catalog).filter((song) => !hidden.has(song.id));
  const startSong = snapshotSong(start);
  const path = [{ song: startSong, reason: '여기서 시작' }];
  const usedIds = new Set([startSong.id]);
  const usedArtists = new Set([normalizedArtist(startSong)]);

  while (path.length < steps) {
    const current = path[path.length - 1].song;
    const candidates = pool
      .filter((song) => !usedIds.has(song.id))
      .filter((song) => !profile.favoriteIds.has(song.id))
      .filter((song) => !usedArtists.has(normalizedArtist(song)));
    const fallback = pool.filter((song) => !usedIds.has(song.id) && !profile.favoriteIds.has(song.id));
    const source = candidates.length ? candidates : fallback;
    const next = source.sort((a, b) => rabbitScore(b, current, profile, direction, { dayKey, offset, step: path.length, now }) - rabbitScore(a, current, profile, direction, { dayKey, offset, step: path.length, now }))[0];
    if (!next) break;
    path.push({ song: next, reason: transitionReason(current, next, direction) });
    usedIds.add(next.id);
    usedArtists.add(normalizedArtist(next));
  }
  return path;
}

export function tasteNarrative(profile) {
  const deep = Math.round(profile.deepCut * 100);
  const explore = Math.round(profile.exploration * 100);
  const fresh = Math.round(profile.freshness * 100);
  if (!profile.favorites.length) return '아직 취향 지도가 비어 있어요. 좋아요와 탐색이 쌓일수록 점의 위치가 당신 쪽으로 움직입니다.';
  return `${profile.mapLabel}. 차트 밖 성향 ${deep}%, 새 아티스트 탐험 ${explore}%, 최근 발매 선호 ${fresh}%의 신호가 잡혔어요.`;
}
