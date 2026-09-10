import {
  diversifyByArtist,
  getGenreTags,
  getPrimaryGenre,
  languageForText,
  matchesGenre,
  normalizeSearchText,
  parseFavorites,
  parseViewParams,
  releaseAgeDays,
  serializeFavorites,
  serializeViewParams,
  snapshotSong,
} from './core.mjs';

const DATA_URL = './data/songs.json';
const FAVORITES_STORAGE_KEY = 'jplaylist-favorites-v2';
const LEGACY_LIKES_STORAGE_KEY = 'jplaylist-likes-v1';
const PLATFORM_STORAGE_KEY = 'jplaylist-listen-platform-v1';
const DATA_CACHE_KEY = 'jplaylist-data-cache-v2';
const PAGE_SIZE = 24;
const RECOMMENDATION_HISTORY_SIZE = 8;
const SEARCH_ANNOUNCE_DELAY = 380;

const PLATFORMS = {
  youtubeMusic: {
    label: 'YouTube Music',
    mode: 'search',
    url: (song) => `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery(song))}`,
  },
  spotify: {
    label: 'Spotify',
    mode: 'search',
    url: (song) => `https://open.spotify.com/search/${encodeURIComponent(searchQuery(song))}`,
  },
  youtube: {
    label: 'YouTube',
    mode: 'search',
    url: (song) => `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery(song))}`,
  },
  apple: {
    label: 'Apple Music',
    mode: 'direct-or-search',
    url: (song) => song.appleUrl || song.url || `https://music.apple.com/kr/search?term=${encodeURIComponent(searchQuery(song))}`,
  },
};

function storageObject() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function probeStorage() {
  try {
    const storage = storageObject();
    if (!storage) return false;
    const key = '__jplaylist_storage_probe__';
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeReadStorage(key, fallback = null) {
  try {
    const storage = storageObject();
    if (!storage) return fallback;
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeWriteStorage(key, value) {
  try {
    const storage = storageObject();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveStorage(key) {
  try {
    storageObject()?.removeItem(key);
  } catch {
    // Persistence is optional; the current session remains usable.
  }
}

function loadLegacyLikeIds() {
  try {
    const parsed = JSON.parse(safeReadStorage(LEGACY_LIKES_STORAGE_KEY, '[]'));
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function loadPreferredPlatform() {
  const saved = safeReadStorage(PLATFORM_STORAGE_KEY, null);
  return saved && PLATFORMS[saved] ? saved : null;
}

const initialView = parseViewParams(window.location.search);

const state = {
  latestSongs: [],
  popularSongs: [],
  currentSongs: [],
  favorites: parseFavorites(safeReadStorage(FAVORITES_STORAGE_KEY, '')),
  legacyLikeIds: loadLegacyLikeIds(),
  activeMode: initialView.activeMode,
  activeGenre: initialView.activeGenre,
  artistFilter: initialView.artistFilter,
  query: initialView.query,
  favoritesOnly: initialView.favoritesOnly,
  displayLimit: PAGE_SIZE,
  latestWindowDays: 180,
  payloadStatus: 'fresh',
  dataState: 'loading',
  featuredId: null,
  recommendationHistory: [],
  skippedIds: new Set(),
  preferredPlatform: loadPreferredPlatform(),
  pendingListenId: null,
  playAfterPlatformSelection: false,
  storageAvailable: probeStorage(),
  previewSongId: null,
  previewPlaying: false,
};

const els = {
  statusDot: document.querySelector('#statusDot'),
  updatedAt: document.querySelector('#updatedAt'),
  persistenceNotice: document.querySelector('#persistenceNotice'),
  featuredCard: document.querySelector('#featuredCard'),
  featuredArtwork: document.querySelector('#featuredArtwork'),
  featuredRank: document.querySelector('#featuredRank'),
  featuredLabel: document.querySelector('#featuredLabel'),
  featuredTitle: document.querySelector('#featuredTitle'),
  featuredArtist: document.querySelector('#featuredArtist'),
  featuredReason: document.querySelector('#featuredReason'),
  featuredGenres: document.querySelector('#featuredGenres'),
  featuredListen: document.querySelector('#featuredListen'),
  featuredPreview: document.querySelector('#featuredPreview'),
  featuredLike: document.querySelector('#featuredLike'),
  recommendAgain: document.querySelector('#recommendAgain'),
  platformHint: document.querySelector('#platformHint'),
  platformSettings: document.querySelector('#platformSettings'),
  modeTabs: document.querySelector('#modeTabs'),
  modeDescription: document.querySelector('#modeDescription'),
  discovery: document.querySelector('#discovery'),
  discoveryToolbar: document.querySelector('#discoveryToolbar'),
  searchInput: document.querySelector('#searchInput'),
  searchClear: document.querySelector('#searchClear'),
  resetFilters: document.querySelector('#resetFilters'),
  activeArtistFilter: document.querySelector('#activeArtistFilter'),
  activeArtistName: document.querySelector('#activeArtistName'),
  clearArtistFilter: document.querySelector('#clearArtistFilter'),
  genreFilters: document.querySelector('#genreFilters'),
  resultSummary: document.querySelector('#resultSummary'),
  sourceNote: document.querySelector('#sourceNote'),
  songGrid: document.querySelector('#songGrid'),
  loadMoreWrap: document.querySelector('#loadMoreWrap'),
  loadMore: document.querySelector('#loadMore'),
  emptyState: document.querySelector('#emptyState'),
  emptyTitle: document.querySelector('#emptyTitle'),
  emptyMessage: document.querySelector('#emptyMessage'),
  retryData: document.querySelector('#retryData'),
  emptyResetFilters: document.querySelector('#emptyResetFilters'),
  reportIssue: document.querySelector('#reportIssue'),
  favoritesFilter: document.querySelector('#favoritesFilter'),
  backupButton: document.querySelector('#backupButton'),
  platformDialog: document.querySelector('#platformDialog'),
  platformDialogCopy: document.querySelector('#platformDialogCopy'),
  platformDialogNote: document.querySelector('#platformDialogNote'),
  platformDialogClose: document.querySelector('#platformDialogClose'),
  platformDialogCancel: document.querySelector('#platformDialogCancel'),
  platformOptions: document.querySelector('#platformOptions'),
  backupDialog: document.querySelector('#backupDialog'),
  backupDialogClose: document.querySelector('#backupDialogClose'),
  exportBackup: document.querySelector('#exportBackup'),
  importBackupButton: document.querySelector('#importBackupButton'),
  importBackup: document.querySelector('#importBackup'),
  backupStatus: document.querySelector('#backupStatus'),
  jumpToDiscovery: document.querySelector('#jumpToDiscovery'),
  previewPlayer: document.querySelector('#previewPlayer'),
  previewTitle: document.querySelector('#previewTitle'),
  previewArtist: document.querySelector('#previewArtist'),
  previewProgress: document.querySelector('#previewProgress'),
  previewToggle: document.querySelector('#previewToggle'),
  previewClose: document.querySelector('#previewClose'),
  liveStatus: document.querySelector('#liveStatus'),
};

const previewAudio = new Audio();
previewAudio.preload = 'none';
let resultAnnouncementTimer = null;

function searchQuery(song) {
  return `${song.artist || ''} ${song.title || ''}`.trim();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function mergeSong(base, incoming) {
  if (!base) return snapshotSong(incoming);
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

function dedupeSongs(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const song of group || []) {
      const normalized = snapshotSong(song);
      if (!normalized.id) continue;
      map.set(normalized.id, mergeSong(map.get(normalized.id), normalized));
    }
  }
  return [...map.values()];
}

function persist(key, value) {
  const ok = state.storageAvailable && safeWriteStorage(key, value);
  if (!ok) {
    state.storageAvailable = false;
    renderPersistenceNotice();
    renderBackupStatus();
  }
  return ok;
}

function saveFavorites() {
  const primary = persist(FAVORITES_STORAGE_KEY, serializeFavorites(state.favorites));
  const legacy = persist(LEGACY_LIKES_STORAGE_KEY, JSON.stringify([...state.legacyLikeIds]));
  return primary && legacy;
}

function favoriteCount() {
  return state.favorites.size;
}

function isFavorite(id) {
  const key = String(id);
  return state.favorites.has(key) || state.legacyLikeIds.has(key);
}

function favoriteSongs() {
  return [...state.favorites.values()].map(snapshotSong);
}

function findCurrentSong(id) {
  const key = String(id ?? '');
  return state.currentSongs.find((song) => song.id === key) || state.favorites.get(key) || null;
}

function hydrateFavoritesFromCurrentSongs() {
  let changed = false;
  for (const song of state.currentSongs) {
    if (state.legacyLikeIds.has(song.id)) {
      state.favorites.set(song.id, snapshotSong(song));
      state.legacyLikeIds.delete(song.id);
      changed = true;
    } else if (state.favorites.has(song.id)) {
      state.favorites.set(song.id, mergeSong(state.favorites.get(song.id), song));
      changed = true;
    }
  }
  if (changed) saveFavorites();
}

function toggleFavorite(id) {
  const key = String(id);
  const song = findCurrentSong(key);
  if (!song) return;

  const removing = isFavorite(key);
  if (removing) {
    state.favorites.delete(key);
    state.legacyLikeIds.delete(key);
  } else {
    state.favorites.set(key, snapshotSong(song));
  }
  const persisted = saveFavorites();

  if (state.favoritesOnly) {
    state.displayLimit = PAGE_SIZE;
    renderFilters();
    renderGrid();
    renderFeatured();
  } else {
    updateFavoriteButtons(key);
  }
  renderRecommendationContext();
  renderFavoritesButton();
  renderBackupStatus();
  announce(`${song.title}을(를) 좋아요에서 ${removing ? '삭제했습니다' : '추가했습니다'}.${persisted ? '' : ' 이번 방문에만 유지됩니다.'}`);
}

function topFavoriteGenre() {
  const counts = new Map();
  for (const song of favoriteSongs()) {
    for (const genre of getGenreTags(song)) {
      if (genre === 'Music') continue;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function ageScore(releaseDate) {
  const days = releaseAgeDays(releaseDate);
  if (days <= 14) return 1;
  if (days <= 60) return 0.9;
  if (days <= 180) return 0.72;
  if (days <= 365) return 0.52;
  return 0.25;
}

function recommendationScore(song) {
  const likes = favoriteSongs();
  const likedGenres = new Map();
  const likedArtists = new Set(likes.map((item) => normalizeSearchText(item.artist)));

  for (const item of likes) {
    for (const genre of getGenreTags(item)) {
      likedGenres.set(genre, (likedGenres.get(genre) || 0) + 1);
    }
  }

  const genreAffinity = getGenreTags(song).reduce((sum, genre) => sum + (likedGenres.get(genre) || 0), 0);
  const artistAffinity = likedArtists.has(normalizeSearchText(song.artist)) ? 1 : 0;
  const popularity = song.chartRank ? 1 - Math.min((song.chartRank - 1) / 100, 1) : 0.45;
  const novelty = isFavorite(song.id) ? -0.22 : 0.08;
  const skippedPenalty = state.skippedIds.has(song.id) ? -0.35 : 0;
  const jitter = Math.random() * 0.06;

  return ageScore(song.releaseDate) * 0.38 + popularity * 0.22 + Math.min(genreAffinity / 3, 1) * 0.24 + artistAffinity * 0.1 + novelty + skippedPenalty + jitter;
}

function recommendationPool() {
  if (state.favoritesOnly) return favoriteSongs();
  const primary = state.activeMode === 'popular' ? state.popularSongs : state.latestSongs;
  return primary.length ? primary : state.popularSongs;
}

function pickRecommendation(excludeId = null) {
  const base = recommendationPool().filter((song) => song.id !== excludeId);
  if (!base.length) return null;

  const recentIds = new Set(state.recommendationHistory.slice(-RECOMMENDATION_HISTORY_SIZE));
  let candidates = base.filter((song) => !recentIds.has(song.id));
  if (candidates.length < 3) candidates = base;

  const recentArtists = new Set(
    state.recommendationHistory.slice(-3)
      .map((id) => state.currentSongs.find((song) => song.id === id)?.artist || state.favorites.get(id)?.artist)
      .filter(Boolean)
      .map(normalizeSearchText),
  );
  const diverse = candidates.filter((song) => !recentArtists.has(normalizeSearchText(song.artist)));
  if (diverse.length >= 3) candidates = diverse;

  return [...candidates].sort((a, b) => recommendationScore(b) - recommendationScore(a))[0] || base[0];
}

function recordRecommendation(song) {
  if (!song) return;
  state.recommendationHistory.push(song.id);
  if (state.recommendationHistory.length > 16) state.recommendationHistory.shift();
}

function formatDate(dateString) {
  if (!dateString) return '발매일 미상';
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function shortDate(dateString) {
  if (!dateString) return '발매일 미상';
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
}

function artwork(url, size = 600) {
  if (!url) return '';
  return String(url).replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function artworkSrcSet(url, sizes) {
  if (!url || !/\/\d+x\d+bb\.(jpg|png)$/i.test(String(url))) return '';
  return sizes.map((size) => `${artwork(url, size)} ${size}w`).join(', ');
}

function setLanguage(element, value) {
  const lang = languageForText(value);
  if (lang) element.setAttribute('lang', lang);
  else element.removeAttribute('lang');
}

function setLikeButton(button, song) {
  const liked = isFavorite(song.id);
  button.textContent = liked ? '♥' : '♡';
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
  button.setAttribute('aria-label', `${song.title} ${liked ? '좋아요 취소' : '좋아요'}`);
}

function updateFavoriteButtons(id) {
  document.querySelectorAll('[data-like-id]').forEach((button) => {
    if (button.dataset.likeId === String(id)) {
      const song = findCurrentSong(id);
      if (song) setLikeButton(button, song);
    }
  });
  if (state.featuredId === String(id)) {
    const song = findCurrentSong(id);
    if (song) setLikeButton(els.featuredLike, song);
  }
}

function platformLabel() {
  return state.preferredPlatform ? PLATFORMS[state.preferredPlatform].label : null;
}

function platformAction(song, platform = state.preferredPlatform) {
  if (!platform || !PLATFORMS[platform]) {
    return { short: '듣기 선택', long: '듣기 플랫폼 선택', aria: `${song?.title || '곡'} 듣기 플랫폼 선택` };
  }
  const config = PLATFORMS[platform];
  const hasAppleDirect = platform === 'apple' && Boolean(song?.appleUrl || song?.url);
  const isDirect = config.mode !== 'search' && hasAppleDirect;
  return {
    short: isDirect ? `${config.label} ↗` : `${config.label} 검색 ↗`,
    long: isDirect ? `${config.label}에서 듣기 ↗` : `${config.label}에서 검색 ↗`,
    aria: `${song?.title || '곡'} ${config.label}에서 ${isDirect ? '듣기' : '검색'}`,
  };
}

function setListenButton(button, song, long = false) {
  const action = platformAction(song);
  button.textContent = long ? action.long : action.short;
  button.setAttribute('aria-label', action.aria);
}

function renderPlatformSelection() {
  els.platformOptions.querySelectorAll('[data-platform]').forEach((button) => {
    const selected = button.dataset.platform === state.preferredPlatform;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

function renderListeningPreference() {
  const label = platformLabel();
  els.platformHint.textContent = label
    ? `기본 듣기: ${label} · 검색형 플랫폼은 결과 페이지가 열려요.`
    : 'YouTube Music · Spotify · YouTube는 검색, Apple Music은 직접 링크를 우선 사용해요.';
  els.platformSettings.textContent = label ? '플랫폼 변경' : '플랫폼 선택';

  const featured = findCurrentSong(state.featuredId);
  if (featured) setListenButton(els.featuredListen, featured, true);
  else els.featuredListen.textContent = label ? `${label} 열기` : '듣기 플랫폼 선택';

  document.querySelectorAll('[data-listen-id]').forEach((button) => {
    const song = findCurrentSong(button.dataset.listenId);
    if (song) setListenButton(button, song, false);
  });
  renderPlatformSelection();
}

function renderPersistenceNotice() {
  const unavailable = !state.storageAvailable;
  els.persistenceNotice.classList.toggle('hidden', !unavailable);
  if (unavailable) {
    els.persistenceNotice.textContent = '이 브라우저에서는 저장 기능을 사용할 수 없어 좋아요와 기본 플랫폼이 이번 방문에만 유지됩니다. 백업 파일 저장은 계속 사용할 수 있어요.';
  }
  els.platformDialogNote.textContent = unavailable
    ? '이 브라우저에서는 설정 저장이 차단되어 이번 방문에만 적용됩니다.'
    : '선택은 이 브라우저에 저장되며 ‘플랫폼 변경’에서 언제든 바꿀 수 있어요.';
}

function renderRecommendationContext() {
  const count = favoriteCount();
  if (state.favoritesOnly) {
    els.featuredLabel.textContent = count ? '좋아요에서 한 곡' : '좋아요';
    els.featuredReason.textContent = count ? '내가 저장한 곡 중 다시 들어볼 한 곡을 골랐어요.' : '좋아요한 곡이 생기면 여기서 다시 골라드려요.';
    return;
  }
  if (count === 0) {
    els.featuredLabel.textContent = '오늘의 추천';
    els.featuredReason.textContent = state.activeMode === 'latest'
      ? '최근 발매일과 일본 인기 흐름을 바탕으로 골랐어요.'
      : '일본 인기 차트 흐름과 발매일을 바탕으로 골랐어요.';
  } else if (count < 3) {
    els.featuredLabel.textContent = '취향 학습 중';
    els.featuredReason.textContent = `좋아요 ${count}곡을 반영하고 있어요. 조금 더 모으면 추천이 정교해져요.`;
  } else {
    els.featuredLabel.textContent = 'FOR YOU';
    const genre = topFavoriteGenre();
    els.featuredReason.textContent = genre
      ? `좋아한 ${genre} 취향과 아티스트, 최신성을 함께 반영했어요.`
      : '좋아한 곡의 아티스트와 최신성을 함께 반영했어요.';
  }
}

function badgeText(song) {
  if ((state.activeMode === 'popular' || state.query || state.favoritesOnly) && song.chartRank) return `Apple JP #${song.chartRank}`;
  if (song.releaseDate) return `발매 ${shortDate(song.releaseDate)}`;
  return '추천';
}

function setFeaturedArtwork(song) {
  const wrap = els.featuredArtwork.closest('.featured-artwork-wrap');
  wrap?.classList.remove('artwork-failed');
  els.featuredArtwork.hidden = false;
  els.featuredArtwork.alt = '';
  if (!song.artwork) {
    els.featuredArtwork.hidden = true;
    wrap?.classList.add('artwork-failed');
    els.featuredArtwork.removeAttribute('src');
    els.featuredArtwork.removeAttribute('srcset');
    return;
  }
  els.featuredArtwork.src = artwork(song.artwork, 720);
  const srcset = artworkSrcSet(song.artwork, [480, 720, 1000]);
  if (srcset) els.featuredArtwork.srcset = srcset;
  else els.featuredArtwork.removeAttribute('srcset');
  els.featuredArtwork.sizes = '(max-width: 720px) 120px, (max-width: 960px) calc(100vw - 40px), 520px';
}

function renderFeatured() {
  const pool = recommendationPool();
  if (state.dataState !== 'ready' || !pool.length) {
    els.featuredCard.hidden = true;
    els.featuredCard.classList.remove('loading');
    return;
  }

  let current = pool.find((song) => song.id === state.featuredId);
  if (!current) {
    current = pickRecommendation();
    state.featuredId = current?.id || null;
    recordRecommendation(current);
  }
  if (!current) {
    els.featuredCard.hidden = true;
    return;
  }

  els.featuredCard.hidden = false;
  els.featuredCard.classList.remove('loading');
  setFeaturedArtwork(current);
  els.featuredRank.textContent = badgeText(current);
  els.featuredTitle.textContent = current.title;
  els.featuredTitle.title = current.title;
  setLanguage(els.featuredTitle, current.title);
  els.featuredArtist.innerHTML = `<span>${escapeHtml(current.artist)}</span><span class="artist-chevron" aria-hidden="true">›</span>`;
  setLanguage(els.featuredArtist, current.artist);
  els.featuredArtist.disabled = false;
  els.featuredArtist.dataset.artist = current.artist;
  els.featuredArtist.setAttribute('aria-label', `${current.artist}의 곡 보기`);
  els.featuredGenres.innerHTML = getGenreTags(current).slice(0, 3)
    .map((genre) => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join('');
  els.featuredListen.disabled = false;
  els.featuredListen.classList.remove('disabled');
  els.featuredLike.disabled = false;
  els.recommendAgain.disabled = pool.length < 2;
  setLikeButton(els.featuredLike, current);

  const hasPreview = Boolean(current.previewUrl);
  els.featuredPreview.classList.toggle('hidden', !hasPreview);
  els.featuredPreview.disabled = !hasPreview;
  if (hasPreview) {
    els.featuredPreview.dataset.previewId = current.id;
  } else {
    delete els.featuredPreview.dataset.previewId;
  }

  renderRecommendationContext();
  renderListeningPreference();
  renderPreviewButtons();
}

function basePool() {
  if (state.favoritesOnly) return favoriteSongs();
  if (state.query) return state.currentSongs;
  return state.activeMode === 'popular' ? state.popularSongs : state.latestSongs;
}

function matchesText(song) {
  if (!state.query) return true;
  const haystack = normalizeSearchText(`${song.title} ${song.artist}`);
  return haystack.includes(normalizeSearchText(state.query));
}

function matchesArtist(song) {
  if (!state.artistFilter) return true;
  return normalizeSearchText(song.artist) === normalizeSearchText(state.artistFilter);
}

function filteredSongs({ ignoreGenre = false } = {}) {
  const filtered = basePool().filter((song) =>
    matchesText(song) &&
    matchesArtist(song) &&
    (ignoreGenre || matchesGenre(song, state.activeGenre)),
  );
  if (!state.favoritesOnly && !state.query && state.activeMode === 'latest') return diversifyByArtist(filtered);
  return filtered;
}

function renderModeControls() {
  els.modeTabs.querySelectorAll('[data-mode]').forEach((button) => {
    const active = !state.favoritesOnly && button.dataset.mode === state.activeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  if (state.favoritesOnly) {
    els.modeDescription.textContent = '차트 포함 여부와 관계없이 이 브라우저에 저장한 좋아요를 보여드려요. 검색과 장르 필터도 그대로 사용할 수 있어요.';
    els.sourceNote.textContent = '내 좋아요 컬렉션';
  } else if (state.query) {
    els.modeDescription.textContent = `“${state.query}”을 최근 발매와 인기 차트 전체에서 찾고 있어요.`;
    els.sourceNote.textContent = '검색 범위: 최근 발매 + 인기 차트';
  } else if (state.activeMode === 'latest') {
    els.modeDescription.textContent = `최근 ${state.latestWindowDays}일 안에 발매된 일본 음악을 다양한 아티스트 순으로 보여드려요.`;
    els.sourceNote.textContent = 'iTunes Search API + 일본 인기 차트 최근 발매곡';
  } else {
    els.modeDescription.textContent = 'Apple Music Japan 전체 인기 차트에서 일본 음악으로 분류한 곡을 보여드려요.';
    els.sourceNote.textContent = '순위: Apple Music Japan 전체 차트 기준';
  }
}

function renderSearchControls() {
  if (els.searchInput.value !== state.query) els.searchInput.value = state.query;
  els.searchClear.classList.toggle('hidden', !state.query);
  els.activeArtistFilter.classList.toggle('hidden', !state.artistFilter);
  els.activeArtistName.textContent = state.artistFilter || '';
  setLanguage(els.activeArtistName, state.artistFilter || '');
}

function genreCounts() {
  const counts = new Map();
  for (const song of filteredSongs({ ignoreGenre: true })) {
    for (const genre of getGenreTags(song)) {
      if (genre === 'Music' || genre === 'K-Pop') continue;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return counts;
}

function renderFilters() {
  const counts = genreCounts();
  const genres = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([genre]) => genre);
  if (state.activeGenre !== '전체' && !genres.includes(state.activeGenre)) genres.unshift(state.activeGenre);
  const options = ['전체', ...genres];
  const total = filteredSongs({ ignoreGenre: true }).length;

  els.genreFilters.innerHTML = options.map((genre) => {
    const count = genre === '전체' ? total : (counts.get(genre) || 0);
    return `
      <button class="filter-button ${state.activeGenre === genre ? 'active' : ''}" type="button" data-genre="${escapeHtml(genre)}" aria-pressed="${state.activeGenre === genre}" aria-label="${escapeHtml(`${genre}, ${count}곡`)}">
        ${escapeHtml(genre)}${genre !== '전체' ? `<span aria-hidden="true">${count}</span>` : ''}
      </button>
    `;
  }).join('');
}

function updateGenreSelection() {
  els.genreFilters.querySelectorAll('[data-genre]').forEach((button) => {
    const active = button.dataset.genre === state.activeGenre;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderFavoritesButton() {
  els.favoritesFilter.classList.toggle('active', state.favoritesOnly);
  els.favoritesFilter.setAttribute('aria-pressed', String(state.favoritesOnly));
  els.favoritesFilter.textContent = state.favoritesOnly ? `♥ 좋아요 ${favoriteCount()}` : `♡ 좋아요 ${favoriteCount() || ''}`.trim();
}

function textLangAttr(value) {
  const lang = languageForText(value);
  return lang ? ` lang="${lang}"` : '';
}

function responsiveArtworkMarkup(song) {
  if (!song.artwork) return '<div class="artwork-fallback" aria-hidden="true">♫</div>';
  const src = artwork(song.artwork, 240);
  const srcset = artworkSrcSet(song.artwork, [160, 240, 360, 500]);
  const sizes = '(max-width: 340px) 96px, (max-width: 720px) calc((100vw - 38px) / 2), (max-width: 960px) calc((100vw - 58px) / 3), 280px';
  return `
    <div class="artwork-fallback" aria-hidden="true">♫</div>
    <img class="song-artwork" data-artwork-image src="${escapeHtml(src)}"${srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(sizes)}"` : ''} alt="" loading="lazy" decoding="async" />
  `;
}

function cardMarkup(song) {
  const genres = getGenreTags(song);
  const liked = isFavorite(song.id);
  const action = platformAction(song);
  const previewing = state.previewSongId === song.id && state.previewPlaying;
  return `
    <article class="song-card" data-song-id="${escapeHtml(song.id)}">
      <div class="song-artwork-wrap">
        ${responsiveArtworkMarkup(song)}
        <span class="card-rank">${escapeHtml(badgeText(song))}</span>
        <button class="card-like ${liked ? 'liked' : ''}" type="button" data-like-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${liked ? '좋아요 취소' : '좋아요'}`)}" aria-pressed="${liked}">${liked ? '♥' : '♡'}</button>
      </div>
      <div class="song-info">
        <h3 class="song-title"${textLangAttr(song.title)} title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h3>
        <button class="song-artist artist-action" type="button" data-artist="${escapeHtml(song.artist)}" aria-label="${escapeHtml(`${song.artist}의 곡 보기`)}"${textLangAttr(song.artist)}><span>${escapeHtml(song.artist)}</span><span class="artist-chevron" aria-hidden="true">›</span></button>
        <div class="song-meta">
          <span>${escapeHtml(genres[0] || getPrimaryGenre(song))} · ${escapeHtml(formatDate(song.releaseDate))}</span>
          <div class="card-actions">
            ${song.previewUrl ? `<button class="card-preview" type="button" data-preview-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${previewing ? '미리듣기 일시정지' : '미리듣기'}`)}">${previewing ? '일시정지' : '미리듣기'}</button>` : ''}
            <button class="card-listen" type="button" data-listen-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(action.aria)}">${escapeHtml(action.short)}</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function resultSummaryText(total, shown) {
  let prefix = '';
  if (state.favoritesOnly) prefix = '좋아요 · ';
  else if (state.query) prefix = '전체 검색 · ';
  else prefix = state.activeMode === 'latest' ? '최근 발매 · ' : '인기 차트 · ';
  return total ? `${prefix}${total}곡 중 ${shown}곡 표시` : `${prefix}결과 0곡`;
}

function renderGrid() {
  if (state.dataState !== 'ready') return { total: 0, shown: 0 };
  const songs = filteredSongs();
  const shownSongs = songs.slice(0, state.displayLimit);

  els.songGrid.innerHTML = shownSongs.map(cardMarkup).join('');
  els.songGrid.setAttribute('aria-busy', 'false');
  els.resultSummary.textContent = resultSummaryText(songs.length, shownSongs.length);

  const hasMore = shownSongs.length < songs.length;
  els.loadMoreWrap.classList.toggle('hidden', !hasMore);
  if (hasMore) els.loadMore.textContent = `더 보기 (${songs.length - shownSongs.length}곡 남음)`;

  if (songs.length) els.emptyState.classList.add('hidden');
  else renderEmptyState();

  renderListeningPreference();
  renderPreviewButtons();
  return { total: songs.length, shown: shownSongs.length };
}

function hasActiveFilters() {
  return Boolean(state.query || state.artistFilter || state.activeGenre !== '전체');
}

function setVisibility(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function renderEmptyState() {
  els.emptyState.classList.remove('hidden');
  setVisibility(els.retryData, false);
  setVisibility(els.emptyResetFilters, false);
  setVisibility(els.reportIssue, false);

  if (state.dataState === 'error') {
    els.emptyTitle.textContent = '곡 데이터를 불러오지 못했어요';
    els.emptyMessage.textContent = '네트워크 상태를 확인하고 다시 시도해 주세요. 문제가 계속되면 제보할 수 있어요.';
    setVisibility(els.retryData, true);
    setVisibility(els.reportIssue, true);
    return;
  }

  if (state.favoritesOnly && favoriteCount() === 0) {
    els.emptyTitle.textContent = '아직 좋아요한 곡이 없어요';
    els.emptyMessage.textContent = '마음에 드는 곡의 ♡를 누르면 차트에서 빠진 뒤에도 좋아요 컬렉션에 남아요.';
    return;
  }

  if (hasActiveFilters()) {
    els.emptyTitle.textContent = state.artistFilter
      ? `${state.artistFilter}에서 조건에 맞는 곡이 없어요`
      : '조건에 맞는 곡이 없어요';
    els.emptyMessage.textContent = state.favoritesOnly
      ? '좋아요는 있지만 현재 검색·장르·아티스트 조건과 겹치는 곡이 없습니다.'
      : state.query
        ? '최근 발매와 인기 차트 전체를 검색했지만 일치하는 곡이 없습니다.'
        : '검색어나 장르 필터를 바꿔보세요.';
    setVisibility(els.emptyResetFilters, true);
    return;
  }

  els.emptyTitle.textContent = state.activeMode === 'latest' ? '최근 발매곡이 충분하지 않아요' : '표시할 인기곡이 없어요';
  els.emptyMessage.textContent = '데이터를 다시 확인해 주세요.';
  setVisibility(els.retryData, true);
}

function renderBackupStatus(message = null) {
  const persistence = state.storageAvailable ? '' : ' · 저장 불가(이번 방문만)';
  els.backupStatus.textContent = message || `현재 좋아요 ${favoriteCount()}곡 · 기본 플랫폼 ${platformLabel() || '미선택'}${persistence}`;
}

function renderAll() {
  renderModeControls();
  renderSearchControls();
  renderFilters();
  renderFavoritesButton();
  renderGrid();
  renderFeatured();
  renderBackupStatus();
  renderPersistenceNotice();
}

function announce(message) {
  els.liveStatus.textContent = '';
  window.requestAnimationFrame(() => { els.liveStatus.textContent = message; });
}

function scheduleResultAnnouncement(message, delay = 0) {
  window.clearTimeout(resultAnnouncementTimer);
  resultAnnouncementTimer = window.setTimeout(() => announce(message), delay);
}

function announceCurrentResults(prefix = '') {
  const total = filteredSongs().length;
  const context = state.favoritesOnly ? '좋아요' : state.query ? `전체 검색 “${state.query}”` : state.activeGenre !== '전체' ? `${state.activeGenre} 필터` : state.activeMode === 'latest' ? '최근 발매' : '인기 차트';
  scheduleResultAnnouncement(`${prefix ? `${prefix}, ` : ''}${context}, ${total}곡.`, 0);
}

function setDataStatus(kind, text) {
  els.statusDot.className = `status-dot status-${kind}`;
  els.updatedAt.textContent = text;
}

function formatUpdateStatus(payload, fromCache = false) {
  const updated = payload?.updatedAt ? new Date(payload.updatedAt) : null;
  const valid = updated && !Number.isNaN(updated.getTime());
  const when = valid
    ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(updated)
    : '시간 미상';
  const ageHours = valid ? Math.max(0, (Date.now() - updated.getTime()) / 3_600_000) : Number.POSITIVE_INFINITY;

  if (fromCache) return { kind: 'stale', text: `오프라인 · 마지막 저장 데이터 ${when}` };
  if (payload?.status === 'stale') return { kind: 'stale', text: `업데이트 지연 · 마지막 정상 데이터 ${when}` };
  if (ageHours > 12) return { kind: 'stale', text: `데이터가 오래됨 · 마지막 업데이트 ${when}` };
  return { kind: 'fresh', text: `최신 데이터 · ${when} 업데이트` };
}

function payloadToSections(payload) {
  if (Array.isArray(payload?.latestSongs) && Array.isArray(payload?.popularSongs)) {
    return {
      latest: payload.latestSongs.map(snapshotSong),
      popular: payload.popularSongs.map(snapshotSong),
      latestWindowDays: Number(payload.latestWindowDays || 180),
    };
  }

  if (Array.isArray(payload?.songs) && payload.songs.length) {
    const popular = payload.songs.map(snapshotSong);
    const latest = popular
      .filter((song) => releaseAgeDays(song.releaseDate) <= 365)
      .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
    return { latest, popular, latestWindowDays: 365 };
  }
  throw new Error('곡 목록이 비어 있습니다.');
}

function ensureFeaturedForCurrentView() {
  if (!recommendationPool().some((song) => song.id === state.featuredId)) {
    const recommended = pickRecommendation();
    state.featuredId = recommended?.id || null;
    recordRecommendation(recommended);
  }
}

function applyPayload(payload, { fromCache = false } = {}) {
  const sections = payloadToSections(payload);
  state.latestSongs = sections.latest.filter((song) => !getGenreTags(song).includes('K-Pop'));
  state.popularSongs = sections.popular.filter((song) => !getGenreTags(song).includes('K-Pop'));
  state.currentSongs = dedupeSongs(state.latestSongs, state.popularSongs);
  state.latestWindowDays = sections.latestWindowDays;
  state.payloadStatus = fromCache ? 'stale' : (payload.status || 'fresh');
  state.dataState = 'ready';

  hydrateFavoritesFromCurrentSongs();
  if (!state.latestSongs.length && state.popularSongs.length) state.activeMode = 'popular';
  ensureFeaturedForCurrentView();

  const status = formatUpdateStatus(payload, fromCache);
  setDataStatus(status.kind, status.text);
  renderAll();
}

async function loadData() {
  state.dataState = 'loading';
  setDataStatus('loading', '데이터를 불러오는 중...');
  els.featuredCard.hidden = false;
  els.featuredCard.classList.add('loading');
  els.emptyState.classList.add('hidden');
  els.songGrid.innerHTML = '';
  els.songGrid.setAttribute('aria-busy', 'true');
  els.loadMoreWrap.classList.add('hidden');

  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    applyPayload(payload);
    persist(DATA_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to load song data:', error);
    const cachedRaw = safeReadStorage(DATA_CACHE_KEY, null);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        applyPayload(cached, { fromCache: true });
        announce('네트워크 대신 마지막 저장 데이터를 표시합니다.');
        return;
      } catch {
        safeRemoveStorage(DATA_CACHE_KEY);
      }
    }

    state.dataState = 'error';
    state.latestSongs = [];
    state.popularSongs = [];
    state.currentSongs = [];
    els.featuredCard.hidden = true;
    els.featuredCard.classList.remove('loading');
    els.songGrid.innerHTML = '';
    els.songGrid.setAttribute('aria-busy', 'false');
    els.resultSummary.textContent = '데이터를 불러오지 못했습니다';
    els.sourceNote.textContent = '재시도 가능';
    setDataStatus('error', '데이터 연결 오류');
    renderEmptyState();
  }
}

function currentView() {
  return {
    activeMode: state.activeMode,
    query: state.query,
    activeGenre: state.activeGenre,
    artistFilter: state.artistFilter,
    favoritesOnly: state.favoritesOnly,
  };
}

function hydrateViewFromLocation() {
  const view = parseViewParams(window.location.search);
  state.activeMode = view.activeMode;
  state.query = view.query;
  state.activeGenre = view.activeGenre;
  state.artistFilter = view.artistFilter;
  state.favoritesOnly = view.favoritesOnly;
  state.displayLimit = PAGE_SIZE;
}

function syncUrl({ push = true } = {}) {
  try {
    const search = serializeViewParams(currentView());
    const hash = window.location.hash === '#discovery' ? '#discovery' : '';
    const nextUrl = `${window.location.pathname}${search}${hash}`;
    const scrollY = window.scrollY;
    if (push) {
      window.history.replaceState({ ...(window.history.state || {}), jplaylist: true, scrollY }, '', `${window.location.pathname}${window.location.search}${window.location.hash}`);
      window.history.pushState({ jplaylist: true, scrollY }, '', nextUrl);
    } else {
      window.history.replaceState({ ...(window.history.state || {}), jplaylist: true, scrollY }, '', nextUrl);
    }
  } catch {
    // URL state is an enhancement; interaction still works if history is unavailable.
  }
}

function resetFilters({ exitFavorites = true, sync = true } = {}) {
  state.query = '';
  state.activeGenre = '전체';
  state.artistFilter = null;
  if (exitFavorites) state.favoritesOnly = false;
  state.displayLimit = PAGE_SIZE;
  ensureFeaturedForCurrentView();
  renderAll();
  if (sync) syncUrl({ push: true });
  announceCurrentResults('필터를 초기화했습니다');
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function scrollToElement(element, { focus = null } = {}) {
  if (!element) return;
  focus?.focus?.({ preventScroll: true });
  element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function applyArtistFilter(artist) {
  if (!artist) return;
  state.artistFilter = artist;
  state.activeGenre = '전체';
  state.query = '';
  state.displayLimit = PAGE_SIZE;
  renderModeControls();
  renderSearchControls();
  renderFilters();
  renderGrid();
  syncUrl({ push: true });
  scrollToElement(els.discovery, { focus: els.clearArtistFilter });
  announce(`${artist}의 곡을 모아 보여드립니다. ${filteredSongs().length}곡입니다.`);
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openOnPlatform(song, platform) {
  const config = PLATFORMS[platform];
  if (!song || !config) return;
  openExternal(config.url(song));
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function openPlatformDialog(song = null, playAfterSelection = false) {
  state.pendingListenId = song?.id || null;
  state.playAfterPlatformSelection = playAfterSelection;
  els.platformDialogCopy.textContent = song
    ? `“${song.title}”을 들을 서비스를 골라 주세요. YouTube Music·Spotify·YouTube는 검색 결과를, Apple Music은 직접 곡 링크를 우선 엽니다.`
    : '기본 듣기 서비스를 골라 주세요. YouTube Music·Spotify·YouTube는 검색 결과를, Apple Music은 직접 곡 링크를 우선 엽니다.';
  renderPlatformSelection();
  renderPersistenceNotice();
  openDialog(els.platformDialog);
}

function savePreferredPlatform(platform) {
  if (!PLATFORMS[platform]) return false;
  state.preferredPlatform = platform;
  const persisted = persist(PLATFORM_STORAGE_KEY, platform);
  renderListeningPreference();
  renderBackupStatus();
  return persisted;
}

function listenToSong(song) {
  if (!song) return;
  if (!state.preferredPlatform) {
    openPlatformDialog(song, true);
    return;
  }
  openOnPlatform(song, state.preferredPlatform);
}

function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    preferredPlatform: state.preferredPlatform,
    favorites: favoriteSongs(),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jplaylist-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  renderBackupStatus(`좋아요 ${state.favorites.size}곡을 백업 파일로 저장했습니다.`);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed?.favorites)) throw new Error('favorites 배열이 없습니다.');

    let imported = 0;
    for (const item of parsed.favorites) {
      const song = snapshotSong(item);
      if (!song.id) continue;
      state.favorites.set(song.id, song);
      state.legacyLikeIds.delete(song.id);
      imported += 1;
    }
    if (parsed.preferredPlatform && PLATFORMS[parsed.preferredPlatform]) {
      state.preferredPlatform = parsed.preferredPlatform;
      persist(PLATFORM_STORAGE_KEY, state.preferredPlatform);
    }
    saveFavorites();
    renderAll();
    renderBackupStatus(`${imported}곡을 가져왔습니다. 기존 좋아요와 합쳤어요.`);
    announce(`백업에서 좋아요 ${imported}곡을 가져왔습니다.`);
  } catch (error) {
    renderBackupStatus(`가져오지 못했습니다: ${error.message}`);
  } finally {
    els.importBackup.value = '';
  }
}

function artworkFailed(img) {
  if (!(img instanceof HTMLImageElement)) return;
  img.hidden = true;
  img.removeAttribute('src');
  img.removeAttribute('srcset');
  img.closest('.song-artwork-wrap, .featured-artwork-wrap')?.classList.add('artwork-failed');
}

function currentPreviewSong() {
  return findCurrentSong(state.previewSongId);
}

function renderPreviewButtons() {
  document.querySelectorAll('[data-preview-id]').forEach((button) => {
    const song = findCurrentSong(button.dataset.previewId);
    if (!song) return;
    const playing = state.previewSongId === song.id && state.previewPlaying;
    button.textContent = playing ? '일시정지' : '미리듣기';
    button.setAttribute('aria-label', `${song.title} ${playing ? '미리듣기 일시정지' : '미리듣기'}`);
  });

  const featured = findCurrentSong(state.featuredId);
  if (featured?.previewUrl) {
    const playing = state.previewSongId === featured.id && state.previewPlaying;
    els.featuredPreview.textContent = playing ? '미리듣기 일시정지' : '미리듣기';
    els.featuredPreview.setAttribute('aria-label', `${featured.title} ${playing ? '미리듣기 일시정지' : '미리듣기'}`);
  }

  const song = currentPreviewSong();
  const visible = Boolean(song);
  els.previewPlayer.classList.toggle('hidden', !visible);
  if (!visible) return;
  els.previewTitle.textContent = song.title;
  els.previewArtist.textContent = song.artist;
  setLanguage(els.previewTitle, song.title);
  setLanguage(els.previewArtist, song.artist);
  els.previewToggle.textContent = state.previewPlaying ? '일시정지' : '재생';
  els.previewToggle.setAttribute('aria-label', `${song.title} 미리듣기 ${state.previewPlaying ? '일시정지' : '재생'}`);
}

async function togglePreview(song) {
  if (!song?.previewUrl) return;
  if (state.previewSongId === song.id) {
    if (state.previewPlaying) previewAudio.pause();
    else {
      try { await previewAudio.play(); } catch { announce('미리듣기를 재생하지 못했습니다.'); }
    }
    return;
  }

  previewAudio.pause();
  previewAudio.src = song.previewUrl;
  previewAudio.currentTime = 0;
  state.previewSongId = song.id;
  state.previewPlaying = false;
  els.previewProgress.value = 0;
  renderPreviewButtons();
  try {
    await previewAudio.play();
    announce(`${song.artist}의 ${song.title} 미리듣기를 재생합니다.`);
  } catch {
    state.previewSongId = null;
    renderPreviewButtons();
    announce('이 곡의 미리듣기를 재생하지 못했습니다. 음악 서비스에서 검색해 주세요.');
  }
}

function stopPreview() {
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewAudio.load();
  state.previewSongId = null;
  state.previewPlaying = false;
  els.previewProgress.value = 0;
  renderPreviewButtons();
}

function bindBackdropDismiss(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeDialog(dialog);
  });
}

function updateJumpControl() {
  const rect = els.discoveryToolbar.getBoundingClientRect();
  const controlsVisible = rect.bottom > 72 && rect.top < window.innerHeight;
  const shouldShow = window.scrollY > 500 && !controlsVisible;
  els.jumpToDiscovery.classList.toggle('hidden', !shouldShow);
}

function setupJumpControl() {
  updateJumpControl();
  window.addEventListener('scroll', updateJumpControl, { passive: true });
  window.addEventListener('resize', updateJumpControl);
}

function bindEvents() {
  els.modeTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || !['latest', 'popular'].includes(button.dataset.mode)) return;
    state.activeMode = button.dataset.mode;
    state.favoritesOnly = false;
    state.displayLimit = PAGE_SIZE;
    const next = pickRecommendation(state.featuredId);
    state.featuredId = next?.id || null;
    recordRecommendation(next);
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults(button.dataset.mode === 'latest' ? '최근 발매로 전환했습니다' : '인기 차트로 전환했습니다');
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    state.displayLimit = PAGE_SIZE;
    renderModeControls();
    renderSearchControls();
    renderFilters();
    renderGrid();
    syncUrl({ push: false });
    window.clearTimeout(resultAnnouncementTimer);
    resultAnnouncementTimer = window.setTimeout(() => announceCurrentResults(), SEARCH_ANNOUNCE_DELAY);
  });

  els.searchClear.addEventListener('click', () => {
    state.query = '';
    state.displayLimit = PAGE_SIZE;
    renderModeControls();
    renderSearchControls();
    renderFilters();
    renderGrid();
    syncUrl({ push: true });
    els.searchInput.focus();
    announceCurrentResults('검색어를 지웠습니다');
  });

  els.resetFilters.addEventListener('click', () => resetFilters());
  els.emptyResetFilters.addEventListener('click', () => resetFilters());

  els.clearArtistFilter.addEventListener('click', () => {
    state.artistFilter = null;
    state.displayLimit = PAGE_SIZE;
    renderSearchControls();
    renderFilters();
    renderGrid();
    syncUrl({ push: true });
    els.searchInput.focus({ preventScroll: true });
    announceCurrentResults('아티스트 필터를 해제했습니다');
  });

  els.genreFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    state.activeGenre = button.dataset.genre;
    state.displayLimit = PAGE_SIZE;
    updateGenreSelection();
    renderGrid();
    syncUrl({ push: true });
    button.focus({ preventScroll: true });
    announceCurrentResults();
  });

  els.favoritesFilter.addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults(state.favoritesOnly ? '좋아요를 엽니다' : '좋아요에서 이전 탐색으로 돌아갑니다');
  });

  els.loadMore.addEventListener('click', () => {
    const before = Math.min(state.displayLimit, filteredSongs().length);
    state.displayLimit += PAGE_SIZE;
    const { shown, total } = renderGrid();
    const added = Math.max(0, shown - before);
    scheduleResultAnnouncement(`${added}곡을 추가했습니다. 현재 ${shown}곡 표시, 전체 ${total}곡.`);
  });

  els.songGrid.addEventListener('click', (event) => {
    const likeButton = event.target.closest('[data-like-id]');
    if (likeButton) {
      toggleFavorite(likeButton.dataset.likeId);
      return;
    }
    const previewButton = event.target.closest('[data-preview-id]');
    if (previewButton) {
      togglePreview(findCurrentSong(previewButton.dataset.previewId));
      return;
    }
    const listenButton = event.target.closest('[data-listen-id]');
    if (listenButton) {
      listenToSong(findCurrentSong(listenButton.dataset.listenId));
      return;
    }
    const artistButton = event.target.closest('[data-artist]');
    if (artistButton) applyArtistFilter(artistButton.dataset.artist);
  });

  els.songGrid.addEventListener('error', (event) => {
    if (event.target.matches?.('[data-artwork-image]')) artworkFailed(event.target);
  }, true);
  els.featuredArtwork.addEventListener('error', () => artworkFailed(els.featuredArtwork));

  els.featuredLike.addEventListener('click', () => state.featuredId && toggleFavorite(state.featuredId));
  els.featuredListen.addEventListener('click', () => listenToSong(findCurrentSong(state.featuredId)));
  els.featuredPreview.addEventListener('click', () => togglePreview(findCurrentSong(state.featuredId)));
  els.featuredArtist.addEventListener('click', () => applyArtistFilter(els.featuredArtist.dataset.artist));
  els.recommendAgain.addEventListener('click', () => {
    if (state.featuredId) state.skippedIds.add(state.featuredId);
    const next = pickRecommendation(state.featuredId);
    if (!next) return;
    state.featuredId = next.id;
    recordRecommendation(next);
    renderFeatured();
    announce(`${next.artist}의 ${next.title}을(를) 추천합니다.`);
  });

  els.platformSettings.addEventListener('click', () => openPlatformDialog());
  els.platformDialogClose.addEventListener('click', () => closeDialog(els.platformDialog));
  els.platformDialogCancel.addEventListener('click', () => closeDialog(els.platformDialog));
  els.platformOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-platform]');
    if (!button || !PLATFORMS[button.dataset.platform]) return;
    const platform = button.dataset.platform;
    const pendingSong = state.pendingListenId ? findCurrentSong(state.pendingListenId) : null;
    const shouldPlay = state.playAfterPlatformSelection;
    const persisted = savePreferredPlatform(platform);
    state.pendingListenId = null;
    state.playAfterPlatformSelection = false;
    closeDialog(els.platformDialog);
    announce(`${PLATFORMS[platform].label}을 기본 플랫폼으로 선택했습니다.${persisted ? '' : ' 이번 방문에만 적용됩니다.'}`);
    if (shouldPlay && pendingSong) openOnPlatform(pendingSong, platform);
  });

  els.backupButton.addEventListener('click', () => {
    renderBackupStatus();
    openDialog(els.backupDialog);
  });
  els.backupDialogClose.addEventListener('click', () => closeDialog(els.backupDialog));
  els.exportBackup.addEventListener('click', exportBackup);
  els.importBackupButton.addEventListener('click', () => els.importBackup.click());
  els.importBackup.addEventListener('change', () => importBackup(els.importBackup.files?.[0]));

  els.previewToggle.addEventListener('click', () => {
    const song = currentPreviewSong();
    if (song) togglePreview(song);
  });
  els.previewClose.addEventListener('click', stopPreview);

  previewAudio.addEventListener('play', () => {
    state.previewPlaying = true;
    renderPreviewButtons();
  });
  previewAudio.addEventListener('pause', () => {
    state.previewPlaying = false;
    renderPreviewButtons();
  });
  previewAudio.addEventListener('timeupdate', () => {
    const duration = Number.isFinite(previewAudio.duration) && previewAudio.duration > 0 ? previewAudio.duration : 0;
    els.previewProgress.value = duration ? Math.min(100, (previewAudio.currentTime / duration) * 100) : 0;
  });
  previewAudio.addEventListener('ended', () => {
    state.previewPlaying = false;
    els.previewProgress.value = 100;
    renderPreviewButtons();
  });
  previewAudio.addEventListener('error', () => {
    const song = currentPreviewSong();
    stopPreview();
    if (song) announce(`${song.title} 미리듣기를 재생하지 못했습니다.`);
  });

  els.retryData.addEventListener('click', loadData);
  els.jumpToDiscovery.addEventListener('click', () => scrollToElement(els.discovery, { focus: els.searchInput }));

  window.addEventListener('popstate', (event) => {
    hydrateViewFromLocation();
    ensureFeaturedForCurrentView();
    renderAll();
    window.requestAnimationFrame(() => window.scrollTo({ top: Number(event.state?.scrollY || 0), behavior: 'auto' }));
    announceCurrentResults('이전 탐색 상태로 돌아왔습니다');
  });

  bindBackdropDismiss(els.platformDialog);
  bindBackdropDismiss(els.backupDialog);
}

bindEvents();
setupJumpControl();
renderListeningPreference();
renderFavoritesButton();
renderBackupStatus();
renderPersistenceNotice();
loadData();
