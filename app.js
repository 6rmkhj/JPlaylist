import {
  cleanSearchQuery,
  diversifyRecent,
  genreSortIndex,
  getGenreTags,
  getPrimaryGenre,
  hasShareableDiscoveryState,
  languageForText,
  matchesGenre,
  normalizeSearchText,
  parseFavorites,
  parseViewParams,
  releaseAgeDays,
  serializeFavorites,
  serializeViewParams,
  snapshotSong,
  sortSearchResults,
} from './core.mjs';

const APP_VERSION = '3.0.0';
const DATA_URL = './data/songs.json';
const FAVORITES_STORAGE_KEY = 'jplaylist-favorites-v2';
const LEGACY_LIKES_STORAGE_KEY = 'jplaylist-likes-v1';
const PLATFORM_STORAGE_KEY = 'jplaylist-listen-platform-v1';
const DATA_CACHE_KEY = 'jplaylist-data-cache-v2';
const PAGE_SIZE = 24;
const RECOMMENDATION_HISTORY_SIZE = 8;
const SEARCH_ANNOUNCE_DELAY = 380;
const SEARCH_APPLY_DELAY = 120;
const DATA_TIMEOUT_MS = 12_000;
const FAVORITE_UNDO_MS = 6_000;

const PLATFORM_LABELS = {
  youtubeMusic: 'YouTube Music',
  spotify: 'Spotify',
  youtube: 'YouTube',
  apple: 'Apple Music',
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

function storageWrite(key, value) {
  try {
    const storage = storageObject();
    if (!storage) return { ok: false, error: 'unavailable' };
    storage.setItem(key, value);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error?.name || 'write-failed' };
  }
}

function safeRemoveStorage(key) {
  try {
    storageObject()?.removeItem(key);
  } catch {
    // Cache/persistence is an enhancement; the current session remains usable.
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
  return saved && PLATFORM_LABELS[saved] ? saved : null;
}

const initialView = parseViewParams(window.location.search);
const storageAvailable = probeStorage();

const state = {
  latestSongs: [],
  popularSongs: [],
  currentSongs: [],
  favorites: parseFavorites(safeReadStorage(FAVORITES_STORAGE_KEY, '')),
  legacyLikeIds: loadLegacyLikeIds(),
  activeMode: initialView.activeMode,
  activeGenre: initialView.activeGenre,
  artistFilter: initialView.artistFilter,
  releaseFilter: initialView.releaseFilter,
  query: initialView.query,
  favoritesOnly: initialView.favoritesOnly,
  latestSort: initialView.latestSort,
  favoritesSort: 'recent',
  displayLimit: PAGE_SIZE,
  latestWindowDays: 180,
  payloadStatus: 'fresh',
  dataState: 'loading',
  dataPayload: null,
  lastLoadError: null,
  featuredId: null,
  recommendationHistory: [],
  skippedIds: new Set(),
  preferredPlatform: loadPreferredPlatform(),
  dialogPlatformSelection: null,
  pendingListenId: null,
  playAfterPlatformSelection: false,
  persistence: {
    favorites: storageAvailable,
    platform: storageAvailable,
    cache: storageAvailable,
  },
  previewSongId: null,
  previewPlaying: false,
  pendingBackup: null,
  backupBeforeImport: null,
  favoriteUndo: null,
  composing: false,
  searchHistoryActive: Boolean(initialView.query),
  initialDeepLinkPending: hasShareableDiscoveryState(initialView),
};

const els = {
  appFailure: document.querySelector('#appFailure'),
  appFailureReload: document.querySelector('#appFailureReload'),
  statusDot: document.querySelector('#statusDot'),
  updatedAt: document.querySelector('#updatedAt'),
  statusDetails: document.querySelector('#statusDetails'),
  statusDetailText: document.querySelector('#statusDetailText'),
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
  localViewNotice: document.querySelector('#localViewNotice'),
  latestSortWrap: document.querySelector('#latestSortWrap'),
  latestSort: document.querySelector('#latestSort'),
  favoritesSortWrap: document.querySelector('#favoritesSortWrap'),
  favoritesSort: document.querySelector('#favoritesSort'),
  discovery: document.querySelector('#discovery'),
  discoveryToolbar: document.querySelector('#discoveryToolbar'),
  searchInput: document.querySelector('#searchInput'),
  searchClear: document.querySelector('#searchClear'),
  resetFilters: document.querySelector('#resetFilters'),
  activeArtistFilter: document.querySelector('#activeArtistFilter'),
  activeArtistName: document.querySelector('#activeArtistName'),
  clearArtistFilter: document.querySelector('#clearArtistFilter'),
  activeReleaseFilter: document.querySelector('#activeReleaseFilter'),
  activeReleaseName: document.querySelector('#activeReleaseName'),
  clearReleaseFilter: document.querySelector('#clearReleaseFilter'),
  genreFilters: document.querySelector('#genreFilters'),
  resultSummary: document.querySelector('#resultSummary'),
  previewCoverageNote: document.querySelector('#previewCoverageNote'),
  sourceNote: document.querySelector('#sourceNote'),
  songGrid: document.querySelector('#songGrid'),
  loadMoreWrap: document.querySelector('#loadMoreWrap'),
  loadMore: document.querySelector('#loadMore'),
  emptyState: document.querySelector('#emptyState'),
  emptyTitle: document.querySelector('#emptyTitle'),
  emptyMessage: document.querySelector('#emptyMessage'),
  retryData: document.querySelector('#retryData'),
  emptyResetFilters: document.querySelector('#emptyResetFilters'),
  diagnosticCopy: document.querySelector('#diagnosticCopy'),
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
  backupReview: document.querySelector('#backupReview'),
  backupReviewSummary: document.querySelector('#backupReviewSummary'),
  backupMerge: document.querySelector('#backupMerge'),
  backupReplace: document.querySelector('#backupReplace'),
  backupReviewCancel: document.querySelector('#backupReviewCancel'),
  undoImport: document.querySelector('#undoImport'),
  backupStatus: document.querySelector('#backupStatus'),
  jumpToDiscovery: document.querySelector('#jumpToDiscovery'),
  favoriteUndo: document.querySelector('#favoriteUndo'),
  favoriteUndoText: document.querySelector('#favoriteUndoText'),
  favoriteUndoButton: document.querySelector('#favoriteUndoButton'),
  previewPlayer: document.querySelector('#previewPlayer'),
  previewTitle: document.querySelector('#previewTitle'),
  previewArtist: document.querySelector('#previewArtist'),
  previewProgress: document.querySelector('#previewProgress'),
  previewTime: document.querySelector('#previewTime'),
  previewToggle: document.querySelector('#previewToggle'),
  previewClose: document.querySelector('#previewClose'),
  liveStatus: document.querySelector('#liveStatus'),
};

const previewAudio = new Audio();
previewAudio.preload = 'none';
let resultAnnouncementTimer = null;
let searchApplyTimer = null;
let favoriteUndoTimer = null;
let scrollSaveFrame = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function mergeSong(base, incoming) {
  if (!base) return snapshotSong(incoming);
  const a = snapshotSong(base);
  const b = snapshotSong(incoming);
  return snapshotSong({
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

function dedupeSongs(...groups) {
  const map = new Map();
  const textMap = new Map();
  for (const group of groups) {
    for (const raw of group || []) {
      const song = snapshotSong(raw);
      if (!song.id) continue;
      const textKey = `${normalizeSearchText(song.artist)}::${normalizeSearchText(song.title)}`;
      const existingId = map.has(song.id) ? song.id : textMap.get(textKey);
      if (existingId) {
        const merged = mergeSong(map.get(existingId), song);
        if (merged.id !== existingId) map.delete(existingId);
        map.set(merged.id, merged);
        textMap.set(textKey, merged.id);
      } else {
        map.set(song.id, song);
        textMap.set(textKey, song.id);
      }
    }
  }
  return [...map.values()];
}

function persist(kind, key, value) {
  if (!state.persistence[kind]) return false;
  const result = storageWrite(key, value);
  if (!result.ok) {
    state.persistence[kind] = false;
    renderPersistenceNotice();
    renderBackupStatus();
    return false;
  }
  return true;
}

function saveFavorites() {
  const primary = persist('favorites', FAVORITES_STORAGE_KEY, serializeFavorites(state.favorites));
  if (state.persistence.favorites) {
    storageWrite(LEGACY_LIKES_STORAGE_KEY, JSON.stringify([...state.legacyLikeIds]));
  }
  return primary;
}

function favoriteCount() {
  return state.favorites.size;
}

function isFavorite(id) {
  const key = String(id);
  return state.favorites.has(key) || state.legacyLikeIds.has(key);
}

function favoriteSongs() {
  const songs = [...state.favorites.values()].map(snapshotSong);
  if (state.favoritesSort === 'artist') {
    return songs.sort((a, b) => a.artist.localeCompare(b.artist, 'ja') || a.title.localeCompare(b.title, 'ja'));
  }
  if (state.favoritesSort === 'release') {
    return songs.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')) || a.title.localeCompare(b.title, 'ja'));
  }
  return songs.sort((a, b) => String(b.likedAt || '').localeCompare(String(a.likedAt || '')));
}

function findCurrentSong(id) {
  const key = String(id ?? '');
  return state.currentSongs.find((song) => song.id === key) || state.favorites.get(key) || null;
}

function hydrateFavoritesFromCurrentSongs() {
  let changed = false;
  for (const song of state.currentSongs) {
    if (state.legacyLikeIds.has(song.id)) {
      state.favorites.set(song.id, snapshotSong({ ...song, likedAt: null }));
      state.legacyLikeIds.delete(song.id);
      changed = true;
    } else if (state.favorites.has(song.id)) {
      const old = state.favorites.get(song.id);
      state.favorites.set(song.id, mergeSong(song, { ...old, likedAt: old.likedAt }));
      changed = true;
    }
  }
  if (changed) saveFavorites();
}

function hideFavoriteUndo() {
  window.clearTimeout(favoriteUndoTimer);
  state.favoriteUndo = null;
  els.favoriteUndo.classList.add('hidden');
}

function showFavoriteUndo(song) {
  window.clearTimeout(favoriteUndoTimer);
  state.favoriteUndo = snapshotSong(song);
  els.favoriteUndoText.textContent = `“${song.title}”을 좋아요에서 삭제했습니다.`;
  els.favoriteUndo.classList.remove('hidden');
  favoriteUndoTimer = window.setTimeout(hideFavoriteUndo, FAVORITE_UNDO_MS);
}

function undoFavoriteRemoval() {
  const song = state.favoriteUndo;
  if (!song) return;
  state.favorites.set(song.id, snapshotSong(song));
  saveFavorites();
  hideFavoriteUndo();
  renderAll();
  announce(`${song.title}을(를) 좋아요에 다시 추가했습니다.`);
}

function toggleFavorite(id) {
  const key = String(id);
  const song = findCurrentSong(key);
  if (!song) return;
  const removing = isFavorite(key);

  if (removing) {
    const saved = state.favorites.get(key) || snapshotSong(song);
    state.favorites.delete(key);
    state.legacyLikeIds.delete(key);
    showFavoriteUndo(saved);
  } else {
    hideFavoriteUndo();
    state.favorites.set(key, snapshotSong({ ...song, likedAt: new Date().toISOString() }));
  }
  const persisted = saveFavorites();

  if (state.favoritesOnly) {
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
  } else {
    updateFavoriteButtons(key);
    renderRecommendationContext();
    renderFavoritesButton();
    renderBackupStatus();
  }
  announce(`${song.title}을(를) 좋아요에서 ${removing ? '삭제했습니다. 되돌릴 수 있습니다' : '추가했습니다'}.${persisted ? '' : ' 좋아요 저장은 이번 방문에만 유지됩니다.'}`);
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
    for (const genre of getGenreTags(item)) likedGenres.set(genre, (likedGenres.get(genre) || 0) + 1);
  }
  const genreAffinity = getGenreTags(song).reduce((sum, genre) => sum + (likedGenres.get(genre) || 0), 0);
  const artistAffinity = likedArtists.has(normalizeSearchText(song.artist)) ? 1 : 0;
  const popularity = song.chartRank ? 1 - Math.min((song.chartRank - 1) / 100, 1) : 0.45;
  const novelty = isFavorite(song.id) ? -0.22 : 0.08;
  const skippedPenalty = state.skippedIds.has(song.id) ? -0.35 : 0;
  const jitter = Math.random() * 0.06;
  return ageScore(song.releaseDate) * 0.38 + popularity * 0.22 + Math.min(genreAffinity / 3, 1) * 0.24 + artistAffinity * 0.1 + novelty + skippedPenalty + jitter;
}

function basePool() {
  if (state.favoritesOnly) return favoriteSongs();
  if (state.query || state.artistFilter || state.releaseFilter) return state.currentSongs;
  return state.activeMode === 'popular' ? state.popularSongs : state.latestSongs;
}

function matchesArtist(song) {
  return !state.artistFilter || normalizeSearchText(song.artist) === normalizeSearchText(state.artistFilter);
}

function matchesRelease(song) {
  return !state.releaseFilter || String(song.collectionId || '') === String(state.releaseFilter);
}

function filteredSongs({ ignoreGenre = false } = {}) {
  let songs = basePool().filter((song) => matchesArtist(song) && matchesRelease(song));
  if (state.query) songs = sortSearchResults(songs, state.query);
  if (!ignoreGenre) songs = songs.filter((song) => matchesGenre(song, state.activeGenre));

  if (state.favoritesOnly) return songs;
  if (!state.query && !state.artistFilter && !state.releaseFilter && state.activeMode === 'latest') {
    if (state.latestSort === 'newest') {
      return [...songs].sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
    }
    return diversifyRecent(songs);
  }
  return songs;
}

function recommendationPool() {
  return filteredSongs();
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

function formatWhen(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '시간 미상';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
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

function textLangAttr(value) {
  const lang = languageForText(value);
  return lang ? ` lang="${lang}"` : '';
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

function userStorefront() {
  try {
    return (new Intl.Locale(navigator.language || 'ko-KR').region || 'KR').toLowerCase();
  } catch {
    return 'kr';
  }
}

function searchQuery(song) {
  return `${song.artist || ''} ${song.title || ''}`.trim();
}

function exactPlatformUrl(song, platform) {
  if (!song || !platform) return null;
  const links = song.platformLinks || {};
  if (platform !== 'apple') return links[platform] || null;
  const candidate = links.apple || song.appleUrl || null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.hostname !== 'music.apple.com') return null;
    const storefront = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (!storefront || storefront === userStorefront()) return candidate;
  } catch {
    return null;
  }
  return null;
}

function platformSearchUrl(song, platform) {
  const query = searchQuery(song);
  if (platform === 'youtubeMusic') return `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
  if (platform === 'spotify') {
    const spotifyQuery = song?.isrc ? `isrc:${song.isrc}` : query;
    return `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`;
  }
  if (platform === 'youtube') return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (platform === 'apple') return `https://music.apple.com/${userStorefront()}/search?term=${encodeURIComponent(query)}`;
  return null;
}

function platformLabel() {
  return state.preferredPlatform ? PLATFORM_LABELS[state.preferredPlatform] : null;
}

function platformAction(song, platform = state.preferredPlatform) {
  if (!platform || !PLATFORM_LABELS[platform]) {
    return { short: '듣기 선택', long: '듣기 플랫폼 선택', aria: `${song?.title || '곡'} 듣기 플랫폼 선택`, url: null, exact: false };
  }
  const exact = exactPlatformUrl(song, platform);
  const label = PLATFORM_LABELS[platform];
  return {
    short: exact ? `${label} ↗` : `${label} 검색 ↗`,
    long: exact ? `${label}에서 듣기 ↗` : `${label}에서 검색 ↗`,
    aria: `${song?.title || '곡'} ${label}에서 ${exact ? '정확한 곡 열기' : '검색'}`,
    url: exact || platformSearchUrl(song, platform),
    exact: Boolean(exact),
  };
}

function setListenButton(button, song, long = false) {
  const action = platformAction(song);
  button.textContent = long ? action.long : action.short;
  button.setAttribute('aria-label', action.aria);
  button.dataset.linkMode = action.exact ? 'exact' : 'search';
}

function renderPlatformSelection() {
  const options = [...els.platformOptions.querySelectorAll('[data-platform]')];
  const selectedPlatform = state.dialogPlatformSelection || state.preferredPlatform || options[0]?.dataset.platform;
  options.forEach((button, index) => {
    const selected = button.dataset.platform === selectedPlatform;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected || (!selectedPlatform && index === 0) ? 0 : -1;
  });
}

function renderListeningPreference() {
  const label = platformLabel();
  els.platformHint.textContent = label
    ? `기본 듣기: ${label} · 정확한 링크가 있는 곡은 바로 열고, 없으면 검색합니다.`
    : '원하는 음악 서비스를 고르면 정확한 링크가 있는 곡은 바로 열고, 없으면 검색합니다.';
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
  const failed = Object.entries(state.persistence).filter(([, available]) => !available).map(([kind]) => kind);
  els.persistenceNotice.classList.toggle('hidden', failed.length === 0);
  if (!failed.length) return;
  const labels = {
    favorites: '좋아요 저장',
    platform: '플랫폼 설정 저장',
    cache: '빠른 재방문용 데이터 캐시',
  };
  els.persistenceNotice.textContent = `${failed.map((kind) => labels[kind]).join('·')}을(를) 이 브라우저에 저장할 수 없습니다. 다른 저장 기능은 가능한 경우 계속 동작합니다.`;
  els.platformDialogNote.textContent = state.persistence.platform
    ? '선택은 이 브라우저에 저장되며 header의 ‘플랫폼 변경’에서 언제든 바꿀 수 있어요.'
    : '플랫폼 설정 저장이 차단되어 이번 방문에만 적용됩니다.';
}

function renderRecommendationContext() {
  const count = favoriteCount();
  if (state.query) {
    els.featuredLabel.textContent = '검색 결과에서 추천';
    els.featuredReason.textContent = `“${state.query}” 검색 결과 안에서 취향과 최신성을 반영했어요.`;
    return;
  }
  if (state.artistFilter) {
    els.featuredLabel.textContent = '아티스트에서 추천';
    els.featuredReason.textContent = `${state.artistFilter}의 현재 결과 안에서 한 곡을 골랐어요.`;
    return;
  }
  if (state.releaseFilter) {
    els.featuredLabel.textContent = '이 발매에서 추천';
    els.featuredReason.textContent = '선택한 앨범·싱글의 트랙 안에서 한 곡을 골랐어요.';
    return;
  }
  if (state.activeGenre !== '전체') {
    els.featuredLabel.textContent = `${state.activeGenre} 추천`;
    els.featuredReason.textContent = `현재 ${state.activeGenre} 필터 결과 안에서 골랐어요.`;
    return;
  }
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
  if ((state.activeMode === 'popular' || state.query || state.artistFilter || state.releaseFilter || state.favoritesOnly) && song.chartRank) return `Apple JP #${song.chartRank}`;
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
  els.featuredArtist.innerHTML = `<span${textLangAttr(current.artist)}>${escapeHtml(current.artist)}</span><span class="artist-chevron" aria-hidden="true">›</span>`;
  els.featuredArtist.disabled = false;
  els.featuredArtist.dataset.artist = current.artist;
  els.featuredArtist.setAttribute('aria-label', `${current.artist}의 곡 보기`);
  els.featuredGenres.innerHTML = getGenreTags(current).slice(0, 3).map((genre) => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join('');
  els.featuredListen.disabled = false;
  els.featuredListen.classList.remove('disabled');
  els.featuredLike.disabled = false;
  els.recommendAgain.disabled = pool.length < 2;
  setLikeButton(els.featuredLike, current);
  const hasPreview = Boolean(current.previewUrl);
  els.featuredPreview.classList.toggle('hidden', !hasPreview);
  els.featuredPreview.disabled = !hasPreview;
  if (hasPreview) els.featuredPreview.dataset.previewId = current.id;
  else delete els.featuredPreview.dataset.previewId;
  renderRecommendationContext();
  renderListeningPreference();
  renderPreviewButtons();
}

function globalContextActive() {
  return Boolean(state.query || state.artistFilter || state.releaseFilter);
}

function releaseNameForFilter() {
  if (!state.releaseFilter) return '';
  return state.currentSongs.find((song) => String(song.collectionId || '') === String(state.releaseFilter))?.collectionName || '선택한 발매';
}

function renderModeControls() {
  const global = globalContextActive();
  els.modeTabs.querySelectorAll('[data-mode]').forEach((button) => {
    const active = !state.favoritesOnly && !global && button.dataset.mode === state.activeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = state.favoritesOnly || global;
    button.setAttribute('aria-disabled', String(button.disabled));
  });

  if (state.favoritesOnly) {
    els.modeDescription.textContent = '이 브라우저에 저장한 좋아요를 보여드려요. 검색과 장르 필터를 사용할 수 있습니다.';
    els.sourceNote.textContent = '내 브라우저의 로컬 좋아요 컬렉션';
  } else if (state.query) {
    els.modeDescription.textContent = `“${state.query}”을 최근 발매와 인기 차트 전체에서 relevance 순으로 찾고 있어요.`;
    els.sourceNote.textContent = '검색 범위: 통합 카탈로그 · 제목/아티스트/별칭/발매명';
  } else if (state.artistFilter) {
    els.modeDescription.textContent = `${state.artistFilter}의 곡을 최근 발매와 인기 차트 전체에서 모아 보여드려요.`;
    els.sourceNote.textContent = '아티스트 범위: 통합 카탈로그';
  } else if (state.releaseFilter) {
    els.modeDescription.textContent = `“${releaseNameForFilter()}”에 속한 곡을 한데 모아 보여드려요.`;
    els.sourceNote.textContent = '같은 발매 ID를 기준으로 그룹화';
  } else if (state.activeMode === 'latest') {
    els.modeDescription.textContent = state.latestSort === 'newest'
      ? `최근 ${state.latestWindowDays}일 안의 일본 음악을 발매일 최신순으로 보여드려요.`
      : `최근 ${state.latestWindowDays}일 안의 일본 음악을 최신성 구간을 지키면서 발매·아티스트가 다양하게 보이도록 정리해요.`;
    els.sourceNote.textContent = '최근 발매: 공개 발매일 인덱스 + 일본 카탈로그 검색 + 인기 차트 보완';
  } else {
    els.modeDescription.textContent = 'Apple Music Japan 전체 인기 차트에서 일본 음악으로 분류한 곡을 보여드려요.';
    els.sourceNote.textContent = '순위: Apple Music Japan 전체 차트 기준';
  }
  els.localViewNotice.classList.toggle('hidden', !state.favoritesOnly);
  els.latestSortWrap.classList.toggle('hidden', state.favoritesOnly || global || state.activeMode !== 'latest');
  els.favoritesSortWrap.classList.toggle('hidden', !state.favoritesOnly);
  els.latestSort.value = state.latestSort;
  els.favoritesSort.value = state.favoritesSort;
}

function renderSearchControls() {
  if (!state.composing && els.searchInput.value !== state.query) els.searchInput.value = state.query;
  els.searchClear.classList.toggle('hidden', !state.query && !els.searchInput.value);
  els.activeArtistFilter.classList.toggle('hidden', !state.artistFilter);
  els.activeArtistName.textContent = state.artistFilter || '';
  setLanguage(els.activeArtistName, state.artistFilter || '');
  els.activeReleaseFilter.classList.toggle('hidden', !state.releaseFilter);
  els.activeReleaseName.textContent = releaseNameForFilter();
  const hasFilters = Boolean(state.query || state.artistFilter || state.releaseFilter || state.activeGenre !== '전체');
  els.resetFilters.classList.toggle('hidden', !hasFilters);
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
  const genres = [...counts.keys()].sort((a, b) => genreSortIndex(a) - genreSortIndex(b) || a.localeCompare(b));
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

function responsiveArtworkMarkup(song) {
  if (!song.artwork) return '<div class="artwork-fallback" aria-hidden="true"></div>';
  const src = artwork(song.artwork, 240);
  const srcset = artworkSrcSet(song.artwork, [160, 240, 360, 500]);
  const sizes = '(max-width: 340px) 96px, (max-width: 720px) calc((100vw - 38px) / 2), (max-width: 960px) calc((100vw - 58px) / 3), 280px';
  return `
    <div class="artwork-fallback" aria-hidden="true"></div>
    <img class="song-artwork" data-artwork-image src="${escapeHtml(src)}"${srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(sizes)}"` : ''} alt="" loading="lazy" decoding="async" />
  `;
}

function releaseTrackCount(song) {
  if (!song.collectionId) return 0;
  return state.currentSongs.filter((item) => String(item.collectionId || '') === String(song.collectionId)).length;
}

function cardMarkup(song) {
  const genres = getGenreTags(song);
  const liked = isFavorite(song.id);
  const action = platformAction(song);
  const previewing = state.previewSongId === song.id && state.previewPlaying;
  const releaseCount = releaseTrackCount(song);
  const collectionMeta = song.collectionName
    ? `<span class="release-meta">${escapeHtml(song.collectionName)}${song.trackNumber ? ` · ${song.trackNumber}${song.trackCount ? `/${song.trackCount}` : ''} 트랙` : ''}</span>`
    : '';
  const releaseAction = song.collectionId && releaseCount > 1
    ? `<button class="release-action" type="button" data-release-id="${escapeHtml(song.collectionId)}" data-release-name="${escapeHtml(song.collectionName || '이 발매')}" aria-label="${escapeHtml(`${song.collectionName || '이 발매'}의 ${releaseCount}곡 보기`)}">이 발매 ${releaseCount}곡</button>`
    : '';
  return `
    <article class="song-card" data-song-id="${escapeHtml(song.id)}">
      <div class="song-artwork-wrap">
        ${responsiveArtworkMarkup(song)}
        <span class="card-rank">${escapeHtml(badgeText(song))}</span>
        <button class="card-like ${liked ? 'liked' : ''}" type="button" data-like-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${liked ? '좋아요 취소' : '좋아요'}`)}" aria-pressed="${liked}">${liked ? '♥' : '♡'}</button>
      </div>
      <div class="song-info">
        <h3 class="song-title"${textLangAttr(song.title)} title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h3>
        <button class="song-artist artist-action" type="button" data-artist="${escapeHtml(song.artist)}" aria-label="${escapeHtml(`${song.artist}의 곡 보기`)}"><span${textLangAttr(song.artist)}>${escapeHtml(song.artist)}</span><span class="artist-chevron" aria-hidden="true">›</span></button>
        <div class="song-context">
          <span>${escapeHtml(genres[0] || getPrimaryGenre(song))} · ${escapeHtml(formatDate(song.releaseDate))}</span>
          ${collectionMeta}
          ${releaseAction}
        </div>
        <div class="song-meta">
          <div class="card-actions">
            ${song.previewUrl ? `<button class="card-preview" type="button" data-preview-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${previewing ? '미리듣기 일시정지' : '미리듣기'}`)}">${previewing ? '일시정지' : '미리듣기'}</button>` : '<span class="preview-unavailable">미리듣기 없음</span>'}
            <button class="card-listen" type="button" data-listen-id="${escapeHtml(song.id)}" data-link-mode="${action.exact ? 'exact' : 'search'}" aria-label="${escapeHtml(action.aria)}">${escapeHtml(action.short)}</button>
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
  else if (state.artistFilter) prefix = '아티스트 · ';
  else if (state.releaseFilter) prefix = '이 발매 · ';
  else prefix = state.activeMode === 'latest' ? '최근 발매 · ' : '인기 차트 · ';
  return total ? `${prefix}${total}곡 중 ${shown}곡 표시` : `${prefix}결과 0곡`;
}

function renderGrid() {
  if (state.dataState !== 'ready') return { total: 0, shown: 0, ids: [] };
  const songs = filteredSongs();
  const shownSongs = songs.slice(0, state.displayLimit);
  els.songGrid.classList.remove('loading-grid');
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
  return { total: songs.length, shown: shownSongs.length, ids: shownSongs.map((song) => song.id) };
}

function hasActiveFilters() {
  return Boolean(state.query || state.artistFilter || state.releaseFilter || state.activeGenre !== '전체');
}

function setVisibility(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function renderEmptyState() {
  els.emptyState.classList.remove('hidden');
  setVisibility(els.retryData, false);
  setVisibility(els.emptyResetFilters, false);
  setVisibility(els.reportIssue, false);
  setVisibility(els.diagnosticCopy, false);
  if (state.dataState === 'error') {
    els.emptyTitle.textContent = '곡 데이터를 불러오지 못했어요';
    els.emptyMessage.textContent = `${friendlyErrorLabel(state.lastLoadError)}. 다시 시도해 주세요. 문제가 계속되면 진단 정보를 복사하거나 GitHub에 제보할 수 있어요.`;
    setVisibility(els.retryData, true);
    setVisibility(els.reportIssue, true);
    setVisibility(els.diagnosticCopy, true);
    updateIssueReportLink();
    return;
  }
  if (state.favoritesOnly && favoriteCount() === 0) {
    els.emptyTitle.textContent = '아직 좋아요한 곡이 없어요';
    els.emptyMessage.textContent = '마음에 드는 곡의 좋아요를 누르면 차트에서 빠진 뒤에도 이 브라우저의 컬렉션에 남아요.';
    return;
  }
  if (hasActiveFilters()) {
    els.emptyTitle.textContent = state.artistFilter
      ? `${state.artistFilter}에서 조건에 맞는 곡이 없어요`
      : state.releaseFilter
        ? `${releaseNameForFilter()}에서 조건에 맞는 곡이 없어요`
        : '조건에 맞는 곡이 없어요';
    els.emptyMessage.textContent = state.favoritesOnly
      ? '좋아요는 있지만 현재 검색·장르·아티스트 조건과 겹치는 곡이 없습니다.'
      : '통합 카탈로그에서 현재 조건과 일치하는 곡을 찾지 못했습니다.';
    setVisibility(els.emptyResetFilters, true);
    return;
  }
  els.emptyTitle.textContent = state.activeMode === 'latest' ? '최근 발매곡이 충분하지 않아요' : '표시할 인기곡이 없어요';
  els.emptyMessage.textContent = '데이터를 다시 확인해 주세요.';
  setVisibility(els.retryData, true);
}

function renderBackupStatus(message = null) {
  const unavailable = [];
  if (!state.persistence.favorites) unavailable.push('좋아요 저장 불가');
  if (!state.persistence.platform) unavailable.push('플랫폼 설정 저장 불가');
  els.backupStatus.textContent = message || `현재 좋아요 ${favoriteCount()}곡 · 기본 플랫폼 ${platformLabel() || '미선택'}${unavailable.length ? ` · ${unavailable.join(' · ')}` : ''}`;
}

function updateDocumentMetadata() {
  let title = 'JPlaylist — 오늘 발견할 일본 음악';
  let description = '최근 발매 일본 음악과 인기 차트를 탐색하고 취향에 맞는 곡을 발견하세요.';
  if (state.favoritesOnly) {
    title = `좋아요 ${favoriteCount()}곡 — JPlaylist`;
    description = '이 브라우저에 저장한 JPlaylist 좋아요 컬렉션입니다.';
  } else if (state.query) {
    title = `“${state.query}” 검색 — JPlaylist`;
    description = `JPlaylist 통합 카탈로그에서 “${state.query}” 검색 결과를 확인하세요.`;
  } else if (state.artistFilter) {
    title = `${state.artistFilter} 곡 — JPlaylist`;
    description = `${state.artistFilter}의 일본 음악을 JPlaylist 통합 카탈로그에서 탐색하세요.`;
  } else if (state.releaseFilter) {
    title = `${releaseNameForFilter()} — JPlaylist`;
    description = `${releaseNameForFilter()}의 수록곡을 한데 모아 봅니다.`;
  } else if (state.activeGenre !== '전체') {
    title = `${state.activeGenre} ${state.activeMode === 'popular' ? '인기 차트' : '최근 발매'} — JPlaylist`;
  } else if (state.activeMode === 'popular') {
    title = '일본 음악 인기 차트 — JPlaylist';
  }
  document.title = title;
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
}

function renderPreviewCoverage() {
  const total = Number(state.dataPayload?.counts?.total || state.currentSongs.length || 0);
  const available = Number(state.dataPayload?.coverage?.previewAvailable ?? state.currentSongs.filter((song) => song.previewUrl).length);
  els.previewCoverageNote.textContent = total
    ? `미리듣기 ${available}/${total}곡 제공 · 없는 곡은 선택한 서비스에서 검색할 수 있어요.`
    : '미리듣기는 제공되는 곡에만 표시됩니다.';
}

function renderAll() {
  renderModeControls();
  renderSearchControls();
  renderFilters();
  renderFavoritesButton();
  renderGrid();
  ensureFeaturedForCurrentView();
  renderFeatured();
  renderBackupStatus();
  renderPersistenceNotice();
  renderPreviewCoverage();
  updateDocumentMetadata();
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
  const context = state.favoritesOnly
    ? '좋아요'
    : state.query
      ? `전체 검색 “${state.query}”`
      : state.artistFilter
        ? `${state.artistFilter} 아티스트`
        : state.releaseFilter
          ? `${releaseNameForFilter()} 발매`
          : state.activeGenre !== '전체'
            ? `${state.activeGenre} 필터`
            : state.activeMode === 'latest' ? '최근 발매' : '인기 차트';
  scheduleResultAnnouncement(`${prefix ? `${prefix}, ` : ''}${context}, ${total}곡.`, 0);
}

function setDataStatus(kind, message) {
  els.statusDot.className = `status-dot status-${kind}`;
  els.updatedAt.textContent = message;
}

function friendlyReason(raw = '') {
  const value = String(raw).toLowerCase();
  if (!value) return '원본 데이터 갱신이 지연되고 있습니다.';
  if (value.includes('timeout') || value.includes('abort')) return '데이터 원본의 응답이 늦어 마지막 정상 데이터를 사용하고 있습니다.';
  if (value.includes('http')) return '데이터 원본이 일시적으로 오류 응답을 반환했습니다.';
  if (value.includes('json') || value.includes('invalid')) return '데이터 형식을 확인하는 과정에서 문제가 발생했습니다.';
  return '데이터 원본을 모두 확인하지 못해 마지막 정상 데이터를 사용하고 있습니다.';
}

function formatUpdateStatus(payload, context = {}) {
  const updated = payload?.updatedAt ? new Date(payload.updatedAt) : null;
  const valid = updated && !Number.isNaN(updated.getTime());
  const when = valid ? formatWhen(payload.updatedAt) : '시간 미상';
  const ageHours = valid ? Math.max(0, (Date.now() - updated.getTime()) / 3_600_000) : Number.POSITIVE_INFINITY;
  if (context.cachedRefreshing) return { kind: 'stale', text: `저장 데이터 표시 중 · 최신 데이터 확인 중 · ${when}` };
  if (context.cachedError) return { kind: 'stale', text: `${friendlyErrorLabel(context.cachedError)} · 마지막 저장 데이터 표시 중 · ${when}` };
  if (payload?.status === 'degraded') return { kind: 'stale', text: `일부 데이터 원본 지연 · ${when} 갱신` };
  if (payload?.status === 'stale') return { kind: 'stale', text: `업데이트 지연 · 마지막 정상 데이터 ${when}` };
  if (ageHours > 12) return { kind: 'stale', text: `데이터가 오래됨 · 마지막 업데이트 ${when}` };
  return { kind: 'fresh', text: `최신 데이터 · ${when} 업데이트` };
}

function renderStatusDetails(payload, context = {}) {
  if (!payload) {
    els.statusDetails.classList.add('hidden');
    els.statusDetailText.textContent = '';
    return;
  }
  const lines = [
    `마지막 정상 갱신: ${formatWhen(payload.updatedAt)}`,
    `마지막 확인: ${formatWhen(payload.lastCheckedAt || payload.updatedAt)}`,
  ];
  if (payload.status === 'degraded') lines.push('현재 상태: 일부 수집 원본이 지연되어 가능한 범위의 최신 데이터를 표시 중');
  if (payload.status === 'stale') lines.push(`현재 상태: ${friendlyReason(payload.staleReason)}`);
  if (context.cachedError) lines.push(`이번 확인 결과: ${friendlyErrorLabel(context.cachedError)}`);
  const components = payload.sources?.discovery?.components;
  if (Array.isArray(components)) {
    const sourceSummary = components.map((source) => `${source.label}: ${source.status === 'ok' ? '정상' : source.status === 'partial' ? '일부 성공' : '확인 지연'}`).join(' · ');
    lines.push(`최근 발매 원본: ${sourceSummary}`);
  }
  if (payload.coverage) {
    const coverage = payload.coverage;
    lines.push(`미리듣기 ${coverage.previewAvailable ?? 0}곡 · canonical ${coverage.canonicalRecording ?? 0}곡 · ISRC ${coverage.isrc ?? 0}곡 · Apple 외 정확한 링크 ${coverage.exactNonAppleLink ?? 0}곡`);
  }
  els.statusDetailText.innerHTML = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const shouldShow = payload.status !== 'fresh' || context.cachedRefreshing || context.cachedError;
  els.statusDetails.classList.toggle('hidden', !shouldShow);
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
  const error = new Error('곡 목록이 비어 있습니다.');
  error.code = 'invalid-data';
  throw error;
}

function ensureFeaturedForCurrentView() {
  const pool = recommendationPool();
  if (!pool.some((song) => song.id === state.featuredId)) {
    const recommended = pickRecommendation();
    state.featuredId = recommended?.id || null;
    recordRecommendation(recommended);
  }
}

function maybeHandleInitialDeepLink() {
  if (!state.initialDeepLinkPending) return;
  state.initialDeepLinkPending = false;
  window.requestAnimationFrame(() => scrollToElement(els.discovery));
}

function applyPayload(payload, { cachedRefreshing = false, cachedError = null } = {}) {
  const sections = payloadToSections(payload);
  state.latestSongs = sections.latest.filter((song) => !getGenreTags(song).includes('K-Pop'));
  state.popularSongs = sections.popular.filter((song) => !getGenreTags(song).includes('K-Pop'));
  state.currentSongs = dedupeSongs(state.latestSongs, state.popularSongs);
  state.latestWindowDays = sections.latestWindowDays;
  state.payloadStatus = cachedRefreshing || cachedError ? 'stale' : (payload.status || 'fresh');
  state.dataPayload = payload;
  state.dataState = 'ready';
  hydrateFavoritesFromCurrentSongs();
  if (!state.latestSongs.length && state.popularSongs.length) state.activeMode = 'popular';
  ensureFeaturedForCurrentView();
  const status = formatUpdateStatus(payload, { cachedRefreshing, cachedError });
  setDataStatus(status.kind, status.text);
  renderStatusDetails(payload, { cachedRefreshing, cachedError });
  renderAll();
  maybeHandleInitialDeepLink();
}

function errorKind(error) {
  if (error?.code) return error.code;
  if (navigator.onLine === false) return 'offline';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  if (String(error?.message || '').startsWith('HTTP ')) return 'http';
  if (error instanceof SyntaxError) return 'invalid-data';
  return 'network';
}

function friendlyErrorLabel(error) {
  const kind = typeof error === 'string' ? error : errorKind(error);
  return {
    offline: '현재 기기가 오프라인입니다',
    timeout: '데이터 응답 시간이 초과됐습니다',
    http: '데이터 서버가 오류 응답을 보냈습니다',
    'invalid-data': '받은 데이터 형식을 확인하지 못했습니다',
    network: '네트워크에서 데이터에 연결하지 못했습니다',
  }[kind] || '데이터를 확인하지 못했습니다';
}

function skeletonMarkup() {
  return Array.from({ length: 8 }, (_, index) => `
    <article class="song-card skeleton-card" aria-hidden="true" data-skeleton="${index}">
      <div class="song-artwork-wrap skeleton-block"></div>
      <div class="song-info"><span class="skeleton-line wide"></span><span class="skeleton-line"></span><span class="skeleton-line short"></span></div>
    </article>
  `).join('');
}

function showLoadingSkeleton() {
  els.songGrid.classList.add('loading-grid');
  els.songGrid.setAttribute('aria-busy', 'true');
  els.songGrid.innerHTML = skeletonMarkup();
  els.resultSummary.textContent = '곡을 불러오는 중...';
}

async function fetchNetworkPayload() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort('timeout'), DATA_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(DATA_URL, { cache: 'no-cache', signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        const timeout = new DOMException('Data request timed out', 'TimeoutError');
        timeout.code = 'timeout';
        throw timeout;
      }
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.code = 'http';
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      error.code = 'invalid-data';
      throw error;
    }
    payloadToSections(payload);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function readCachedPayload() {
  const cachedRaw = safeReadStorage(DATA_CACHE_KEY, null);
  if (!cachedRaw) return null;
  try {
    const cached = JSON.parse(cachedRaw);
    payloadToSections(cached);
    return cached;
  } catch {
    safeRemoveStorage(DATA_CACHE_KEY);
    return null;
  }
}

async function loadData() {
  state.lastLoadError = null;
  const cached = readCachedPayload();
  if (cached) {
    applyPayload(cached, { cachedRefreshing: true });
  } else {
    state.dataState = 'loading';
    setDataStatus('loading', '데이터를 불러오는 중...');
    els.statusDetails.classList.add('hidden');
    els.featuredCard.hidden = false;
    els.featuredCard.classList.add('loading');
    els.emptyState.classList.add('hidden');
    els.loadMoreWrap.classList.add('hidden');
    showLoadingSkeleton();
  }

  try {
    const payload = await fetchNetworkPayload();
    applyPayload(payload);
    persist('cache', DATA_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to load song data:', error);
    state.lastLoadError = errorKind(error);
    if (cached) {
      applyPayload(cached, { cachedError: state.lastLoadError });
      announce(`${friendlyErrorLabel(state.lastLoadError)}. 마지막 저장 데이터를 계속 표시합니다.`);
      return;
    }
    state.dataState = 'error';
    state.latestSongs = [];
    state.popularSongs = [];
    state.currentSongs = [];
    state.dataPayload = null;
    els.featuredCard.hidden = true;
    els.featuredCard.classList.remove('loading');
    els.songGrid.classList.remove('loading-grid');
    els.songGrid.innerHTML = '';
    els.songGrid.setAttribute('aria-busy', 'false');
    els.resultSummary.textContent = '데이터를 불러오지 못했습니다';
    els.sourceNote.textContent = friendlyErrorLabel(state.lastLoadError);
    setDataStatus('error', friendlyErrorLabel(state.lastLoadError));
    renderStatusDetails(null);
    renderEmptyState();
  }
}

function currentView() {
  return {
    activeMode: state.activeMode,
    query: state.query,
    activeGenre: state.activeGenre,
    artistFilter: state.artistFilter,
    releaseFilter: state.releaseFilter,
    favoritesOnly: state.favoritesOnly,
    latestSort: state.latestSort,
  };
}

function applyView(view) {
  state.activeMode = view.activeMode || 'latest';
  state.query = cleanSearchQuery(view.query || '');
  state.activeGenre = view.activeGenre || '전체';
  state.artistFilter = view.artistFilter || null;
  state.releaseFilter = view.releaseFilter || null;
  state.favoritesOnly = Boolean(view.favoritesOnly);
  state.latestSort = view.latestSort === 'newest' ? 'newest' : 'diverse';
  state.displayLimit = PAGE_SIZE;
}

function hydrateViewFromLocation(eventState = null) {
  const view = eventState?.view || parseViewParams(window.location.search);
  applyView(view);
}

function syncUrl({ push = true } = {}) {
  try {
    const view = currentView();
    const search = serializeViewParams(view);
    const hash = hasShareableDiscoveryState(view) || state.favoritesOnly ? '#discovery' : '';
    const nextUrl = `${window.location.pathname}${search}${hash}`;
    const scrollY = window.scrollY;
    if (push) {
      const priorView = window.history.state?.view || parseViewParams(window.location.search);
      window.history.replaceState({ ...(window.history.state || {}), jplaylist: true, scrollY, view: priorView }, '', `${window.location.pathname}${window.location.search}${window.location.hash}`);
      window.history.pushState({ jplaylist: true, scrollY, view }, '', nextUrl);
    } else {
      window.history.replaceState({ ...(window.history.state || {}), jplaylist: true, scrollY, view }, '', nextUrl);
    }
  } catch {
    // URL/history state is an enhancement; interaction remains usable.
  }
  updateDocumentMetadata();
}

function resetFilters({ sync = true } = {}) {
  state.query = '';
  state.activeGenre = '전체';
  state.artistFilter = null;
  state.releaseFilter = null;
  state.displayLimit = PAGE_SIZE;
  state.searchHistoryActive = false;
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

function stopPreviewIfOutsideCurrentView() {
  if (!state.previewSongId) return;
  if (!filteredSongs().some((song) => song.id === state.previewSongId)) stopPreview();
}

function applyArtistFilter(artist) {
  if (!artist) return;
  state.artistFilter = artist;
  state.releaseFilter = null;
  state.query = '';
  state.displayLimit = PAGE_SIZE;
  state.searchHistoryActive = false;
  ensureFeaturedForCurrentView();
  renderAll();
  stopPreviewIfOutsideCurrentView();
  syncUrl({ push: true });
  scrollToElement(els.discovery, { focus: els.clearArtistFilter });
  announce(`${artist}의 곡을 통합 카탈로그에서 모아 보여드립니다. 기존 장르 필터가 있으면 함께 적용됩니다. ${filteredSongs().length}곡입니다.`);
}

function applyReleaseFilter(releaseId, releaseName = '') {
  if (!releaseId) return;
  const hadGenre = state.activeGenre !== '전체';
  state.releaseFilter = String(releaseId);
  state.artistFilter = null;
  state.query = '';
  state.activeGenre = '전체';
  state.displayLimit = PAGE_SIZE;
  state.searchHistoryActive = false;
  ensureFeaturedForCurrentView();
  renderAll();
  stopPreviewIfOutsideCurrentView();
  syncUrl({ push: true });
  scrollToElement(els.discovery, { focus: els.clearReleaseFilter });
  announce(`${releaseName || releaseNameForFilter()}의 곡을 모아 보여드립니다.${hadGenre ? ' 전체 트랙을 보여주기 위해 장르 필터를 해제했습니다.' : ''}`);
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openOnPlatform(song, platform) {
  if (!song || !PLATFORM_LABELS[platform]) return;
  const action = platformAction(song, platform);
  stopPreview();
  openExternal(action.url);
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
  state.dialogPlatformSelection = state.preferredPlatform || 'youtubeMusic';
  els.platformDialogCopy.textContent = song
    ? `“${song.title}”을 들을 서비스를 골라 주세요. 정확한 곡 링크가 있으면 바로 열고, 없으면 검색 결과를 엽니다.`
    : '기본 듣기 서비스를 골라 주세요. 정확한 곡 링크가 있으면 바로 열고, 없으면 검색 결과를 엽니다.';
  renderPlatformSelection();
  renderPersistenceNotice();
  openDialog(els.platformDialog);
  window.requestAnimationFrame(() => els.platformOptions.querySelector('[tabindex="0"]')?.focus());
}

function savePreferredPlatform(platform) {
  if (!PLATFORM_LABELS[platform]) return false;
  state.preferredPlatform = platform;
  const persisted = persist('platform', PLATFORM_STORAGE_KEY, platform);
  renderListeningPreference();
  renderBackupStatus();
  return persisted;
}

function confirmPlatformSelection(platform) {
  if (!PLATFORM_LABELS[platform]) return;
  const pendingSong = state.pendingListenId ? findCurrentSong(state.pendingListenId) : null;
  const shouldPlay = state.playAfterPlatformSelection;
  const persisted = savePreferredPlatform(platform);
  state.dialogPlatformSelection = null;
  state.pendingListenId = null;
  state.playAfterPlatformSelection = false;
  closeDialog(els.platformDialog);
  announce(`${PLATFORM_LABELS[platform]}을 기본 플랫폼으로 선택했습니다.${persisted ? '' : ' 플랫폼 설정은 이번 방문에만 적용됩니다.'}`);
  if (shouldPlay && pendingSong) openOnPlatform(pendingSong, platform);
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
    version: 3,
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

function parseBackupPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('올바른 JSON 백업이 아닙니다.');
  if (parsed.version !== undefined && ![1, 2, 3].includes(Number(parsed.version))) throw new Error('지원하지 않는 백업 버전입니다.');
  if (!Array.isArray(parsed.favorites)) throw new Error('favorites 배열이 없습니다.');
  const favorites = [];
  for (const item of parsed.favorites) {
    if (!item || item.id === undefined || !String(item.title || '').trim() || !String(item.artist || '').trim()) {
      throw new Error('필수 곡 정보가 없는 항목이 있습니다.');
    }
    const song = snapshotSong(item);
    if (!song.id || song.title === 'Unknown title' || song.artist === 'Unknown artist') throw new Error('유효하지 않은 곡 항목이 있습니다.');
    favorites.push(song);
  }
  const preferredPlatform = parsed.preferredPlatform && PLATFORM_LABELS[parsed.preferredPlatform] ? parsed.preferredPlatform : null;
  return { favorites, preferredPlatform };
}

function renderBackupReview() {
  const pending = state.pendingBackup;
  if (!pending) {
    els.backupReview.classList.add('hidden');
    return;
  }
  const existingIds = new Set(state.favorites.keys());
  const newCount = pending.favorites.filter((song) => !existingIds.has(song.id)).length;
  const duplicateCount = pending.favorites.length - newCount;
  const platformChange = pending.preferredPlatform && pending.preferredPlatform !== state.preferredPlatform
    ? `${platformLabel() || '미선택'} → ${PLATFORM_LABELS[pending.preferredPlatform]}`
    : '변경 없음';
  els.backupReviewSummary.textContent = `파일 ${pending.favorites.length}곡 · 신규 ${newCount}곡 · 기존과 중복 ${duplicateCount}곡 · 기본 플랫폼 ${platformChange}`;
  els.backupReview.classList.remove('hidden');
}

async function inspectBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    state.pendingBackup = parseBackupPayload(parsed);
    renderBackupReview();
    renderBackupStatus('파일을 확인했습니다. 적용 방법을 선택해 주세요.');
  } catch (error) {
    state.pendingBackup = null;
    renderBackupReview();
    renderBackupStatus(`가져오지 못했습니다: ${error.message}`);
  } finally {
    els.importBackup.value = '';
  }
}

function cloneFavoritesMap(map) {
  return new Map([...map.entries()].map(([id, song]) => [id, snapshotSong(song)]));
}

function applyBackup(mode) {
  const pending = state.pendingBackup;
  if (!pending) return;
  state.backupBeforeImport = {
    favorites: cloneFavoritesMap(state.favorites),
    preferredPlatform: state.preferredPlatform,
  };
  const beforeIds = new Set(state.favorites.keys());
  if (mode === 'replace') state.favorites.clear();
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();
  for (const item of pending.favorites) {
    const existing = state.favorites.get(item.id);
    const song = snapshotSong({ ...item, likedAt: item.likedAt || existing?.likedAt || now });
    if (existing) {
      state.favorites.set(item.id, mergeSong(existing, song));
      updated += 1;
    } else {
      state.favorites.set(item.id, song);
      if (!beforeIds.has(item.id)) added += 1;
    }
    state.legacyLikeIds.delete(item.id);
  }
  let platformChanged = false;
  if (pending.preferredPlatform && pending.preferredPlatform !== state.preferredPlatform) {
    state.preferredPlatform = pending.preferredPlatform;
    persist('platform', PLATFORM_STORAGE_KEY, state.preferredPlatform);
    platformChanged = true;
  }
  saveFavorites();
  state.pendingBackup = null;
  renderBackupReview();
  els.undoImport.classList.remove('hidden');
  renderAll();
  const modeText = mode === 'replace' ? '교체' : '병합';
  renderBackupStatus(`${modeText} 완료 · 신규 ${added}곡 · 업데이트/중복 ${updated}곡${platformChanged ? ` · 플랫폼 ${platformLabel()} 적용` : ''}`);
  announce(`백업 ${modeText}을 완료했습니다. 신규 ${added}곡입니다.`);
}

function undoLastImport() {
  const before = state.backupBeforeImport;
  if (!before) return;
  state.favorites = cloneFavoritesMap(before.favorites);
  state.preferredPlatform = before.preferredPlatform;
  saveFavorites();
  if (state.preferredPlatform) persist('platform', PLATFORM_STORAGE_KEY, state.preferredPlatform);
  else safeRemoveStorage(PLATFORM_STORAGE_KEY);
  state.backupBeforeImport = null;
  els.undoImport.classList.add('hidden');
  renderAll();
  renderBackupStatus('마지막 가져오기를 되돌렸습니다.');
  announce('마지막 백업 가져오기를 되돌렸습니다.');
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

function formatMediaTime(seconds) {
  const value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function updatePreviewTime() {
  const current = previewAudio.currentTime || 0;
  const duration = Number.isFinite(previewAudio.duration) && previewAudio.duration > 0 ? previewAudio.duration : 0;
  const label = `${formatMediaTime(current)} / ${formatMediaTime(duration)}`;
  els.previewTime.textContent = label;
  els.previewProgress.value = duration ? Math.min(100, (current / duration) * 100) : 0;
  els.previewProgress.setAttribute('aria-valuetext', label);
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
  els.previewTitle.title = song.title;
  els.previewArtist.title = song.artist;
  setLanguage(els.previewTitle, song.title);
  setLanguage(els.previewArtist, song.artist);
  els.previewToggle.textContent = state.previewPlaying ? '일시정지' : '재생';
  els.previewToggle.setAttribute('aria-label', `${song.title} 미리듣기 ${state.previewPlaying ? '일시정지' : '재생'}`);
  updatePreviewTime();
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
  updatePreviewTime();
  renderPreviewButtons();
  try {
    await previewAudio.play();
    announce(`${song.artist}의 ${song.title} 미리듣기를 재생합니다. 일부 곡만 미리듣기를 제공합니다.`);
  } catch {
    state.previewSongId = null;
    renderPreviewButtons();
    announce('이 곡의 미리듣기를 재생하지 못했습니다. 선택한 음악 서비스에서 검색해 주세요.');
  }
}

function stopPreview() {
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewAudio.load();
  state.previewSongId = null;
  state.previewPlaying = false;
  updatePreviewTime();
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

function saveCurrentScroll() {
  try {
    window.history.replaceState({
      ...(window.history.state || {}),
      jplaylist: true,
      scrollY: window.scrollY,
      view: window.history.state?.view || currentView(),
    }, '', `${window.location.pathname}${window.location.search}${window.location.hash}`);
  } catch {
    // Ignore unsupported history state.
  }
}

function setupScrollState() {
  try { window.history.scrollRestoration = 'manual'; } catch { /* optional */ }
  updateJumpControl();
  window.addEventListener('scroll', () => {
    updateJumpControl();
    if (scrollSaveFrame !== null) return;
    scrollSaveFrame = window.requestAnimationFrame(() => {
      scrollSaveFrame = null;
      saveCurrentScroll();
    });
  }, { passive: true });
  window.addEventListener('resize', updateJumpControl);
  window.addEventListener('pagehide', saveCurrentScroll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrentScroll();
  });
}

function buildDiagnosticText() {
  const payload = state.dataPayload;
  return [
    `JPlaylist ${APP_VERSION}`,
    `오류 유형: ${state.lastLoadError || 'unknown'}`,
    `온라인 상태: ${navigator.onLine ? 'online' : 'offline'}`,
    `데이터 마지막 갱신: ${payload?.updatedAt || 'none'}`,
    `뷰포트: ${window.innerWidth}x${window.innerHeight}`,
    `브라우저: ${String(navigator.userAgent || '').slice(0, 160)}`,
  ].join('\n');
}

function updateIssueReportLink() {
  const title = `[Data report] ${friendlyErrorLabel(state.lastLoadError)}`;
  const body = `JPlaylist에서 데이터를 불러오지 못했습니다.\n\n아래 진단 정보는 현재 검색어나 개인 좋아요를 포함하지 않습니다.\n\n\`\`\`\n${buildDiagnosticText()}\n\`\`\``;
  els.reportIssue.href = `https://github.com/6rmkhj/JPlaylist/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

async function copyDiagnostic() {
  const text = buildDiagnosticText();
  try {
    await navigator.clipboard.writeText(text);
    announce('진단 정보를 복사했습니다.');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    announce('진단 정보를 복사했습니다.');
  }
}

function applySearchValue(raw, { immediate = false } = {}) {
  const next = cleanSearchQuery(raw);
  if (next === state.query) {
    renderSearchControls();
    return;
  }
  const wasEmpty = !state.query;
  state.query = next;
  state.artistFilter = null;
  state.releaseFilter = null;
  state.displayLimit = PAGE_SIZE;
  ensureFeaturedForCurrentView();
  renderAll();
  stopPreviewIfOutsideCurrentView();
  const startsSearch = wasEmpty && Boolean(next);
  syncUrl({ push: startsSearch });
  state.searchHistoryActive = Boolean(next);
  window.clearTimeout(resultAnnouncementTimer);
  resultAnnouncementTimer = window.setTimeout(() => announceCurrentResults(), immediate ? 0 : SEARCH_ANNOUNCE_DELAY);
}

function queueSearchValue(value) {
  window.clearTimeout(searchApplyTimer);
  searchApplyTimer = window.setTimeout(() => applySearchValue(value), SEARCH_APPLY_DELAY);
}

function clearSearch() {
  window.clearTimeout(searchApplyTimer);
  const hadSearch = Boolean(state.query || cleanSearchQuery(els.searchInput.value));
  state.query = '';
  state.displayLimit = PAGE_SIZE;
  state.searchHistoryActive = false;
  els.searchInput.value = '';
  ensureFeaturedForCurrentView();
  renderAll();
  syncUrl({ push: hadSearch });
  els.searchInput.focus();
  announceCurrentResults('검색어를 지웠습니다');
}

function focusFirstNewCard(id) {
  if (!id) return;
  const card = [...els.songGrid.querySelectorAll('[data-song-id]')].find((item) => item.dataset.songId === String(id));
  if (!card) return;
  card.tabIndex = -1;
  card.focus({ preventScroll: true });
}

function bindEvents() {
  els.modeTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || button.disabled || !['latest', 'popular'].includes(button.dataset.mode)) return;
    if (state.activeMode === button.dataset.mode && !state.favoritesOnly) return;
    stopPreview();
    state.activeMode = button.dataset.mode;
    state.favoritesOnly = false;
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults(button.dataset.mode === 'latest' ? '최근 발매로 전환했습니다' : '인기 차트로 전환했습니다');
  });

  els.latestSort.addEventListener('change', () => {
    state.latestSort = els.latestSort.value === 'newest' ? 'newest' : 'diverse';
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults(state.latestSort === 'newest' ? '최신순으로 정렬했습니다' : '최신성 구간 안에서 다양하게 정렬했습니다');
  });

  els.favoritesSort.addEventListener('change', () => {
    state.favoritesSort = ['artist', 'release'].includes(els.favoritesSort.value) ? els.favoritesSort.value : 'recent';
    state.displayLimit = PAGE_SIZE;
    renderAll();
    announceCurrentResults('좋아요 정렬을 바꿨습니다');
  });

  els.searchInput.addEventListener('compositionstart', () => {
    state.composing = true;
    window.clearTimeout(searchApplyTimer);
  });
  els.searchInput.addEventListener('compositionend', () => {
    state.composing = false;
    applySearchValue(els.searchInput.value, { immediate: true });
  });
  els.searchInput.addEventListener('input', (event) => {
    if (state.composing || event.isComposing) return;
    queueSearchValue(els.searchInput.value);
  });
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (state.query || els.searchInput.value)) {
      event.preventDefault();
      clearSearch();
    }
  });
  els.searchClear.addEventListener('click', clearSearch);

  els.resetFilters.addEventListener('click', () => resetFilters());
  els.emptyResetFilters.addEventListener('click', () => resetFilters());

  els.clearArtistFilter.addEventListener('click', () => {
    state.artistFilter = null;
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    els.searchInput.focus({ preventScroll: true });
    announceCurrentResults('아티스트 필터를 해제했습니다');
  });

  els.clearReleaseFilter.addEventListener('click', () => {
    state.releaseFilter = null;
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults('발매 필터를 해제했습니다');
  });

  els.genreFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    state.activeGenre = button.dataset.genre;
    state.displayLimit = PAGE_SIZE;
    updateGenreSelection();
    ensureFeaturedForCurrentView();
    renderGrid();
    renderFeatured();
    syncUrl({ push: true });
    button.focus({ preventScroll: true });
    announceCurrentResults();
  });

  els.favoritesFilter.addEventListener('click', () => {
    stopPreview();
    state.favoritesOnly = !state.favoritesOnly;
    state.displayLimit = PAGE_SIZE;
    ensureFeaturedForCurrentView();
    renderAll();
    syncUrl({ push: true });
    announceCurrentResults(state.favoritesOnly ? '이 브라우저의 좋아요를 엽니다' : '좋아요에서 이전 탐색으로 돌아갑니다');
  });

  els.favoriteUndoButton.addEventListener('click', undoFavoriteRemoval);

  els.loadMore.addEventListener('click', () => {
    const allSongs = filteredSongs();
    const before = Math.min(state.displayLimit, allSongs.length);
    const firstNewId = allSongs[before]?.id || null;
    state.displayLimit += PAGE_SIZE;
    const { shown, total } = renderGrid();
    const added = Math.max(0, shown - before);
    focusFirstNewCard(firstNewId);
    scheduleResultAnnouncement(`${added}곡을 추가했습니다. 새로 추가된 첫 곡으로 포커스를 이동했습니다. 현재 ${shown}곡 표시, 전체 ${total}곡.`);
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
    const releaseButton = event.target.closest('[data-release-id]');
    if (releaseButton) {
      applyReleaseFilter(releaseButton.dataset.releaseId, releaseButton.dataset.releaseName);
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
    stopPreview();
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
    if (!button) return;
    state.dialogPlatformSelection = button.dataset.platform;
    confirmPlatformSelection(button.dataset.platform);
  });
  els.platformOptions.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const options = [...els.platformOptions.querySelectorAll('[data-platform]')];
    const currentIndex = Math.max(0, options.findIndex((button) => button === document.activeElement));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    state.dialogPlatformSelection = options[nextIndex].dataset.platform;
    renderPlatformSelection();
    options[nextIndex].focus();
  });

  els.backupButton.addEventListener('click', () => {
    renderBackupStatus();
    openDialog(els.backupDialog);
  });
  els.backupDialogClose.addEventListener('click', () => closeDialog(els.backupDialog));
  els.exportBackup.addEventListener('click', exportBackup);
  els.importBackupButton.addEventListener('click', () => els.importBackup.click());
  els.importBackup.addEventListener('change', () => inspectBackup(els.importBackup.files?.[0]));
  els.backupMerge.addEventListener('click', () => applyBackup('merge'));
  els.backupReplace.addEventListener('click', () => applyBackup('replace'));
  els.backupReviewCancel.addEventListener('click', () => {
    state.pendingBackup = null;
    renderBackupReview();
    renderBackupStatus('가져오기를 취소했습니다.');
  });
  els.undoImport.addEventListener('click', undoLastImport);

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
  previewAudio.addEventListener('timeupdate', updatePreviewTime);
  previewAudio.addEventListener('loadedmetadata', updatePreviewTime);
  previewAudio.addEventListener('ended', () => {
    state.previewPlaying = false;
    updatePreviewTime();
    renderPreviewButtons();
  });
  previewAudio.addEventListener('error', () => {
    const song = currentPreviewSong();
    stopPreview();
    if (song) announce(`${song.title} 미리듣기를 재생하지 못했습니다.`);
  });

  els.retryData.addEventListener('click', loadData);
  els.diagnosticCopy.addEventListener('click', copyDiagnostic);
  els.jumpToDiscovery.addEventListener('click', () => scrollToElement(els.discovery, { focus: els.searchInput }));
  els.appFailureReload.addEventListener('click', () => window.location.reload());

  window.addEventListener('popstate', (event) => {
    hydrateViewFromLocation(event.state);
    ensureFeaturedForCurrentView();
    renderAll();
    state.searchHistoryActive = Boolean(state.query);
    window.requestAnimationFrame(() => {
      const saved = Number(event.state?.scrollY);
      if (Number.isFinite(saved)) window.scrollTo({ top: saved, behavior: 'auto' });
      else if (hasShareableDiscoveryState(currentView()) || state.favoritesOnly) scrollToElement(els.discovery);
    });
    announceCurrentResults('이전 탐색 상태로 돌아왔습니다');
  });

  bindBackdropDismiss(els.platformDialog);
  bindBackdropDismiss(els.backupDialog);
}

function initializeHistory() {
  try {
    const canonicalSearch = serializeViewParams(currentView());
    const hash = hasShareableDiscoveryState(currentView()) || state.favoritesOnly ? '#discovery' : window.location.hash;
    window.history.replaceState({
      ...(window.history.state || {}),
      jplaylist: true,
      scrollY: window.scrollY,
      view: currentView(),
    }, '', `${window.location.pathname}${canonicalSearch}${hash}`);
  } catch {
    // History state is optional.
  }
}

bindEvents();
setupScrollState();
initializeHistory();
renderListeningPreference();
renderFavoritesButton();
renderBackupStatus();
renderPersistenceNotice();
loadData();

window.__JPLAYLIST_READY__ = true;
window.dispatchEvent(new Event('jplaylist:ready'));
