import {
  getGenreTags,
  getPrimaryGenre,
  matchesGenre,
  normalizeSearchText,
  parseFavorites,
  releaseAgeDays,
  serializeFavorites,
  snapshotSong,
} from './core.mjs';

const DATA_URL = './data/songs.json';
const FAVORITES_STORAGE_KEY = 'jplaylist-favorites-v2';
const LEGACY_LIKES_STORAGE_KEY = 'jplaylist-likes-v1';
const PLATFORM_STORAGE_KEY = 'jplaylist-listen-platform-v1';
const DATA_CACHE_KEY = 'jplaylist-data-cache-v2';
const PAGE_SIZE = 24;
const RECOMMENDATION_HISTORY_SIZE = 8;

const PLATFORMS = {
  youtubeMusic: {
    label: 'YouTube Music',
    url: (song) => `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery(song))}`,
  },
  spotify: {
    label: 'Spotify',
    url: (song) => `https://open.spotify.com/search/${encodeURIComponent(searchQuery(song))}`,
  },
  youtube: {
    label: 'YouTube',
    url: (song) => `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery(song))}`,
  },
  apple: {
    label: 'Apple Music',
    url: (song) => song.appleUrl || song.url || `https://music.apple.com/kr/search?term=${encodeURIComponent(searchQuery(song))}`,
  },
};

function localStorageSafe() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeReadStorage(key, fallback = null) {
  try {
    const storage = localStorageSafe();
    if (!storage) return fallback;
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeWriteStorage(key, value) {
  try {
    const storage = localStorageSafe();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveStorage(key) {
  try {
    localStorageSafe()?.removeItem(key);
  } catch {
    // Storage is optional. The app remains usable without it.
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

const state = {
  latestSongs: [],
  popularSongs: [],
  currentSongs: [],
  favorites: parseFavorites(safeReadStorage(FAVORITES_STORAGE_KEY, '')),
  legacyLikeIds: loadLegacyLikeIds(),
  activeMode: 'latest',
  activeGenre: '전체',
  artistFilter: null,
  query: '',
  favoritesOnly: false,
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
};

const els = {
  statusDot: document.querySelector('#statusDot'),
  updatedAt: document.querySelector('#updatedAt'),
  featuredCard: document.querySelector('#featuredCard'),
  featuredArtwork: document.querySelector('#featuredArtwork'),
  featuredRank: document.querySelector('#featuredRank'),
  featuredLabel: document.querySelector('#featuredLabel'),
  featuredTitle: document.querySelector('#featuredTitle'),
  featuredArtist: document.querySelector('#featuredArtist'),
  featuredReason: document.querySelector('#featuredReason'),
  featuredGenres: document.querySelector('#featuredGenres'),
  featuredListen: document.querySelector('#featuredListen'),
  featuredLike: document.querySelector('#featuredLike'),
  recommendAgain: document.querySelector('#recommendAgain'),
  platformHint: document.querySelector('#platformHint'),
  platformSettings: document.querySelector('#platformSettings'),
  modeTabs: document.querySelector('#modeTabs'),
  modeDescription: document.querySelector('#modeDescription'),
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
  platformDialogClose: document.querySelector('#platformDialogClose'),
  platformOptions: document.querySelector('#platformOptions'),
  backupDialog: document.querySelector('#backupDialog'),
  backupDialogClose: document.querySelector('#backupDialogClose'),
  exportBackup: document.querySelector('#exportBackup'),
  importBackup: document.querySelector('#importBackup'),
  backupStatus: document.querySelector('#backupStatus'),
  liveStatus: document.querySelector('#liveStatus'),
};

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

function saveFavorites() {
  safeWriteStorage(FAVORITES_STORAGE_KEY, serializeFavorites(state.favorites));
  safeWriteStorage(LEGACY_LIKES_STORAGE_KEY, JSON.stringify([...state.legacyLikeIds]));
}

function favoriteCount() {
  return state.favorites.size;
}

function isFavorite(id) {
  const key = String(id);
  return state.favorites.has(key) || state.legacyLikeIds.has(key);
}

function findCurrentSong(id) {
  return state.currentSongs.find((song) => song.id === String(id)) || state.favorites.get(String(id)) || null;
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

function favoriteSongs() {
  return [...state.favorites.values()].map(snapshotSong);
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
  saveFavorites();

  if (state.favoritesOnly) {
    state.displayLimit = PAGE_SIZE;
    renderFilters();
    renderGrid();
  } else {
    updateFavoriteButtons(key);
  }
  renderRecommendationContext();
  renderFavoritesButton();
  renderBackupStatus();
  announce(`${song.title}을(를) 좋아요에서 ${removing ? '삭제했습니다' : '추가했습니다'}.`);
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
      .map((id) => state.currentSongs.find((song) => song.id === id)?.artist)
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

function renderListeningPreference() {
  const label = platformLabel();
  els.platformHint.textContent = label
    ? `기본 듣기: ${label} · 모든 곡에 적용돼요.`
    : 'YouTube Music · Spotify · YouTube · Apple Music 중 선택할 수 있어요.';
  els.platformSettings.textContent = label ? '플랫폼 변경' : '플랫폼 선택';
  els.featuredListen.textContent = label ? `${label}에서 듣기 ↗` : '듣기 플랫폼 선택';
  document.querySelectorAll('[data-listen-id]').forEach((button) => {
    button.textContent = label ? `${label} ↗` : '듣기 선택';
  });
}

function renderRecommendationContext() {
  const count = favoriteCount();
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
  if (state.activeMode === 'popular' && song.chartRank) return `Apple JP #${song.chartRank}`;
  if (state.favoritesOnly && song.chartRank) return `Apple JP #${song.chartRank}`;
  if (song.releaseDate) return `발매 ${shortDate(song.releaseDate)}`;
  return '추천';
}

function renderFeatured() {
  if (state.dataState !== 'ready' || !recommendationPool().length) {
    els.featuredCard.hidden = true;
    els.featuredCard.classList.remove('loading');
    return;
  }

  let current = recommendationPool().find((song) => song.id === state.featuredId);
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
  els.featuredArtwork.src = artwork(current.artwork, 1000);
  els.featuredArtwork.alt = `${current.artist} - ${current.title} 앨범 아트`;
  els.featuredRank.textContent = badgeText(current);
  els.featuredTitle.textContent = current.title;
  els.featuredArtist.textContent = current.artist;
  els.featuredArtist.disabled = false;
  els.featuredArtist.dataset.artist = current.artist;
  els.featuredGenres.innerHTML = getGenreTags(current).slice(0, 3)
    .map((genre) => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join('');
  els.featuredListen.disabled = false;
  els.featuredListen.classList.remove('disabled');
  els.featuredLike.disabled = false;
  els.recommendAgain.disabled = false;
  setLikeButton(els.featuredLike, current);
  renderRecommendationContext();
  renderListeningPreference();
}

function basePool() {
  if (state.favoritesOnly) return favoriteSongs();
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
  return basePool().filter((song) =>
    matchesText(song) &&
    matchesArtist(song) &&
    (ignoreGenre || matchesGenre(song, state.activeGenre)),
  );
}

function renderModeControls() {
  els.modeTabs.querySelectorAll('[data-mode]').forEach((button) => {
    const active = !state.favoritesOnly && button.dataset.mode === state.activeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  if (state.favoritesOnly) {
    els.modeDescription.textContent = '차트 포함 여부와 관계없이 이 브라우저에 저장한 좋아요를 보여드려요.';
    els.sourceNote.textContent = '내 브라우저의 좋아요 컬렉션';
  } else if (state.activeMode === 'latest') {
    els.modeDescription.textContent = `최근 ${state.latestWindowDays}일 안에 발매된 일본 음악 후보를 최신순으로 보여드려요.`;
    els.sourceNote.textContent = 'iTunes Search API + 일본 인기 차트의 최근 발매곡';
  } else {
    els.modeDescription.textContent = 'Apple Music Japan 전체 인기 차트에서 일본 음악으로 분류한 곡을 보여드려요.';
    els.sourceNote.textContent = '순위 표시는 Apple Music Japan 전체 차트 기준';
  }
}

function renderSearchControls() {
  if (els.searchInput.value !== state.query) els.searchInput.value = state.query;
  els.searchClear.classList.toggle('hidden', !state.query);
  els.activeArtistFilter.classList.toggle('hidden', !state.artistFilter);
  els.activeArtistName.textContent = state.artistFilter || '';
}

function renderFilters() {
  const counts = new Map();
  for (const song of filteredSongs({ ignoreGenre: true })) {
    for (const genre of getGenreTags(song)) {
      if (genre === 'Music' || genre === 'K-Pop') continue;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }

  const genres = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([genre]) => genre);
  if (state.activeGenre !== '전체' && !genres.includes(state.activeGenre)) genres.unshift(state.activeGenre);
  const options = ['전체', ...genres];

  els.genreFilters.innerHTML = options.map((genre) => `
    <button class="filter-button ${state.activeGenre === genre ? 'active' : ''}" type="button" data-genre="${escapeHtml(genre)}" aria-pressed="${state.activeGenre === genre}">
      ${escapeHtml(genre)}${genre !== '전체' && counts.has(genre) ? `<span>${counts.get(genre)}</span>` : ''}
    </button>
  `).join('');
}

function renderFavoritesButton() {
  els.favoritesFilter.classList.toggle('active', state.favoritesOnly);
  els.favoritesFilter.setAttribute('aria-pressed', String(state.favoritesOnly));
  els.favoritesFilter.textContent = state.favoritesOnly ? `♥ 좋아요 ${favoriteCount()}` : `♡ 좋아요 ${favoriteCount() || ''}`.trim();
}

function cardMarkup(song) {
  const genres = getGenreTags(song);
  const liked = isFavorite(song.id);
  return `
    <article class="song-card" data-song-id="${escapeHtml(song.id)}">
      <div class="song-artwork-wrap">
        ${song.artwork ? `<img class="song-artwork" src="${escapeHtml(artwork(song.artwork, 500))}" alt="${escapeHtml(`${song.artist} - ${song.title} 앨범 아트`)}" loading="lazy" />` : '<div class="song-artwork artwork-placeholder" aria-hidden="true">♫</div>'}
        <span class="card-rank">${escapeHtml(badgeText(song))}</span>
        <button class="card-like ${liked ? 'liked' : ''}" type="button" data-like-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${liked ? '좋아요 취소' : '좋아요'}`)}" aria-pressed="${liked}">${liked ? '♥' : '♡'}</button>
      </div>
      <div class="song-info">
        <h3 class="song-title">${escapeHtml(song.title)}</h3>
        <button class="song-artist artist-action" type="button" data-artist="${escapeHtml(song.artist)}" aria-label="${escapeHtml(`${song.artist}의 곡 보기`)}">${escapeHtml(song.artist)}</button>
        <div class="song-meta">
          <span>${escapeHtml(genres[0] || getPrimaryGenre(song))} · ${escapeHtml(formatDate(song.releaseDate))}</span>
          <button class="card-listen" type="button" data-listen-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} ${platformLabel() || '음악 서비스'}에서 듣기`)}">${escapeHtml(platformLabel() ? `${platformLabel()} ↗` : '듣기 선택')}</button>
        </div>
      </div>
    </article>
  `;
}

function renderGrid() {
  if (state.dataState !== 'ready') return;
  const songs = filteredSongs();
  const shown = songs.slice(0, state.displayLimit);

  els.songGrid.innerHTML = shown.map(cardMarkup).join('');
  els.resultSummary.textContent = songs.length
    ? `${songs.length}곡 중 ${shown.length}곡 표시`
    : '검색 결과 0곡';

  const hasMore = shown.length < songs.length;
  els.loadMoreWrap.classList.toggle('hidden', !hasMore);
  if (hasMore) els.loadMore.textContent = `더 보기 (${songs.length - shown.length}곡 남음)`;

  if (songs.length) {
    els.emptyState.classList.add('hidden');
  } else {
    renderEmptyState();
  }
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
      ? '좋아요는 있지만 현재 검색·장르 조건과 겹치는 곡이 없습니다.'
      : '검색어나 장르 필터를 바꿔보세요.';
    setVisibility(els.emptyResetFilters, true);
    return;
  }

  els.emptyTitle.textContent = state.activeMode === 'latest' ? '최근 발매곡이 충분하지 않아요' : '표시할 인기곡이 없어요';
  els.emptyMessage.textContent = '데이터를 다시 확인해 주세요.';
  setVisibility(els.retryData, true);
}

function renderBackupStatus(message = null) {
  els.backupStatus.textContent = message || `현재 좋아요 ${favoriteCount()}곡 · 기본 플랫폼 ${platformLabel() || '미선택'}`;
}

function renderAll() {
  renderModeControls();
  renderSearchControls();
  renderFilters();
  renderFavoritesButton();
  renderGrid();
  renderFeatured();
  renderBackupStatus();
}

function announce(message) {
  els.liveStatus.textContent = '';
  window.requestAnimationFrame(() => { els.liveStatus.textContent = message; });
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
  if (!state.featuredId || !recommendationPool().some((song) => song.id === state.featuredId)) {
    const recommended = pickRecommendation();
    state.featuredId = recommended?.id || null;
    recordRecommendation(recommended);
  }

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
  els.loadMoreWrap.classList.add('hidden');

  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    applyPayload(payload);
    safeWriteStorage(DATA_CACHE_KEY, JSON.stringify(payload));
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
    els.resultSummary.textContent = '데이터를 불러오지 못했습니다';
    els.sourceNote.textContent = '재시도 가능';
    setDataStatus('error', '데이터 연결 오류');
    renderEmptyState();
  }
}

function resetFilters({ exitFavorites = true } = {}) {
  state.query = '';
  state.activeGenre = '전체';
  state.artistFilter = null;
  if (exitFavorites) state.favoritesOnly = false;
  state.displayLimit = PAGE_SIZE;
  renderModeControls();
  renderSearchControls();
  renderFilters();
  renderFavoritesButton();
  renderGrid();
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
  document.querySelector('.discovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  announce(`${artist}의 곡을 모아 보여드립니다.`);
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
    ? `“${song.title}”을 들을 서비스를 골라 주세요. 선택은 다음 곡에도 기본으로 적용됩니다.`
    : '기본 듣기 서비스를 골라 주세요. 다음 곡부터 같은 서비스로 바로 열립니다.';
  openDialog(els.platformDialog);
}

function savePreferredPlatform(platform) {
  if (!PLATFORMS[platform]) return;
  state.preferredPlatform = platform;
  safeWriteStorage(PLATFORM_STORAGE_KEY, platform);
  renderListeningPreference();
  renderBackupStatus();
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
      safeWriteStorage(PLATFORM_STORAGE_KEY, state.preferredPlatform);
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

function bindEvents() {
  els.modeTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || !['latest', 'popular'].includes(button.dataset.mode)) return;
    state.activeMode = button.dataset.mode;
    state.favoritesOnly = false;
    state.activeGenre = '전체';
    state.artistFilter = null;
    state.displayLimit = PAGE_SIZE;
    const next = pickRecommendation(state.featuredId);
    state.featuredId = next?.id || null;
    recordRecommendation(next);
    renderAll();
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    state.displayLimit = PAGE_SIZE;
    renderSearchControls();
    renderFilters();
    renderGrid();
  });
  els.searchClear.addEventListener('click', () => {
    state.query = '';
    state.displayLimit = PAGE_SIZE;
    renderSearchControls();
    renderFilters();
    renderGrid();
    els.searchInput.focus();
  });
  els.resetFilters.addEventListener('click', () => resetFilters());
  els.emptyResetFilters.addEventListener('click', () => resetFilters());
  els.clearArtistFilter.addEventListener('click', () => {
    state.artistFilter = null;
    state.displayLimit = PAGE_SIZE;
    renderSearchControls();
    renderFilters();
    renderGrid();
  });

  els.genreFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    state.activeGenre = button.dataset.genre;
    state.displayLimit = PAGE_SIZE;
    renderFilters();
    renderGrid();
  });

  els.favoritesFilter.addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    state.activeGenre = '전체';
    state.artistFilter = null;
    state.query = '';
    state.displayLimit = PAGE_SIZE;
    renderModeControls();
    renderSearchControls();
    renderFilters();
    renderFavoritesButton();
    renderGrid();
  });

  els.loadMore.addEventListener('click', () => {
    state.displayLimit += PAGE_SIZE;
    renderGrid();
  });

  els.songGrid.addEventListener('click', (event) => {
    const likeButton = event.target.closest('[data-like-id]');
    if (likeButton) {
      toggleFavorite(likeButton.dataset.likeId);
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

  els.featuredLike.addEventListener('click', () => state.featuredId && toggleFavorite(state.featuredId));
  els.featuredListen.addEventListener('click', () => listenToSong(findCurrentSong(state.featuredId)));
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
  els.platformOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-platform]');
    if (!button || !PLATFORMS[button.dataset.platform]) return;
    const platform = button.dataset.platform;
    const pendingSong = state.pendingListenId ? findCurrentSong(state.pendingListenId) : null;
    const shouldPlay = state.playAfterPlatformSelection;
    savePreferredPlatform(platform);
    state.pendingListenId = null;
    state.playAfterPlatformSelection = false;
    closeDialog(els.platformDialog);
    if (shouldPlay && pendingSong) openOnPlatform(pendingSong, platform);
  });

  els.backupButton.addEventListener('click', () => {
    renderBackupStatus();
    openDialog(els.backupDialog);
  });
  els.backupDialogClose.addEventListener('click', () => closeDialog(els.backupDialog));
  els.exportBackup.addEventListener('click', exportBackup);
  els.importBackup.addEventListener('change', () => importBackup(els.importBackup.files?.[0]));

  els.retryData.addEventListener('click', loadData);
}

bindEvents();
renderListeningPreference();
renderFavoritesButton();
renderBackupStatus();
loadData();
