import {
  getGenreTags,
  languageForText,
  normalizeSearchText,
  releaseAgeDays,
  snapshotSong,
} from './core.mjs';

const DATA_URL = './data/songs.json';
const FAVORITES_STORAGE_KEY = 'jplaylist-favorites-v2';
const PLATFORM_STORAGE_KEY = 'jplaylist-listen-platform-v1';
const EXPERIENCE_STORAGE_KEY = 'jplaylist-experience-v1';
const MIX_SIZE = 8;
const MAX_HIDDEN = 200;
const MAX_ACTIVITY = 80;
const MAX_RECENT = 6;
const PLATFORM_LABELS = {
  youtubeMusic: 'YouTube Music',
  spotify: 'Spotify',
  youtube: 'YouTube',
  apple: 'Apple Music',
};
const EXPLORATION_OPTIONS = {
  steady: { label: '취향 중심', affinity: 0.46, popularity: 0.28, recency: 0.18, discovery: 0.08 },
  balanced: { label: '균형', affinity: 0.34, popularity: 0.22, recency: 0.28, discovery: 0.16 },
  adventurous: { label: '새로움 우선', affinity: 0.22, popularity: 0.12, recency: 0.38, discovery: 0.28 },
};

const selectors = {
  badges: '.card-rank, #featuredRank',
  listen: '[data-listen-id], #featuredListen',
  favorites: '#favoritesFilter',
};

let catalog = [];
let payload = null;
let hub = null;
let pendingPremiumListen = null;
let refreshTimer = null;
let experience = loadExperience();

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key, fallback) {
  try {
    const raw = safeStorage()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeExperience() {
  try {
    safeStorage()?.setItem(EXPERIENCE_STORAGE_KEY, JSON.stringify(experience));
    return true;
  } catch {
    return false;
  }
}

function loadExperience() {
  const stored = readJson(EXPERIENCE_STORAGE_KEY, null);
  return {
    version: 1,
    exploration: EXPLORATION_OPTIONS[stored?.exploration] ? stored.exploration : 'balanced',
    hiddenIds: Array.isArray(stored?.hiddenIds) ? stored.hiddenIds.map(String).slice(-MAX_HIDDEN) : [],
    activity: Array.isArray(stored?.activity) ? stored.activity.slice(-MAX_ACTIVITY) : [],
    recent: Array.isArray(stored?.recent) ? stored.recent.slice(0, MAX_RECENT) : [],
    visitDays: Array.isArray(stored?.visitDays) ? stored.visitDays.slice(-30) : [],
    mixOffset: Number.isFinite(stored?.mixOffset) ? stored.mixOffset : 0,
    mixDay: typeof stored?.mixDay === 'string' ? stored.mixDay : null,
  };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function langAttr(value) {
  const lang = languageForText(value);
  return lang ? ` lang="${lang}"` : '';
}

function artwork(url, size = 480) {
  if (!url) return '';
  return String(url).replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stableUnit(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function dedupeSongs(items) {
  const map = new Map();
  for (const raw of items || []) {
    const song = snapshotSong(raw);
    if (!song.id || map.has(song.id)) continue;
    map.set(song.id, song);
  }
  return [...map.values()];
}

function favoriteSongs() {
  const stored = readJson(FAVORITES_STORAGE_KEY, null);
  const items = Array.isArray(stored) ? stored : stored?.items;
  if (!Array.isArray(items)) return [];
  return dedupeSongs(items);
}

function normalizedArtist(song) {
  return normalizeSearchText(song?.artist || '');
}

function buildTasteProfile(favorites) {
  const genreCounts = new Map();
  const artistCounts = new Map();
  for (const song of favorites) {
    const artist = normalizedArtist(song);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    for (const genre of getGenreTags(song)) {
      if (!genre || genre === 'Music' || genre === 'K-Pop') continue;
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    favorites,
    favoriteIds: new Set(favorites.map((song) => song.id)),
    genreCounts,
    artistCounts,
    topGenres,
    topArtists,
  };
}

function recencyScore(song) {
  const days = releaseAgeDays(song.releaseDate);
  if (days <= 14) return 1;
  if (days <= 30) return 0.9;
  if (days <= 90) return 0.72;
  if (days <= 180) return 0.56;
  if (days <= 365) return 0.36;
  return 0.16;
}

function popularityScore(song) {
  if (!song.chartRank) return 0.38;
  return 1 - Math.min(Math.max(song.chartRank - 1, 0) / 100, 1);
}

function affinityScore(song, profile) {
  if (!profile.favorites.length) return 0.25;
  const artistAffinity = profile.artistCounts.has(normalizedArtist(song)) ? 1 : 0;
  const maxGenreCount = Math.max(1, ...profile.genreCounts.values());
  const genreAffinity = Math.max(0, ...getGenreTags(song).map((genre) => (profile.genreCounts.get(genre) || 0) / maxGenreCount));
  return Math.min(1, genreAffinity * 0.74 + artistAffinity * 0.4);
}

function discoveryScore(song, profile) {
  const unseenArtist = profile.artistCounts.has(normalizedArtist(song)) ? 0 : 1;
  const uncommon = song.chartRank && song.chartRank <= 20 ? 0.35 : 0.75;
  return Math.min(1, unseenArtist * 0.72 + uncommon * 0.28);
}

function recommendationScore(song, profile, mode) {
  const weights = EXPLORATION_OPTIONS[mode] || EXPLORATION_OPTIONS.balanced;
  const jitter = stableUnit(`${localDateKey()}::${experience.mixOffset}::${mode}::${song.id}`) * 0.08;
  return affinityScore(song, profile) * weights.affinity
    + popularityScore(song) * weights.popularity
    + recencyScore(song) * weights.recency
    + discoveryScore(song, profile) * weights.discovery
    + jitter;
}

function buildDailyMix(profile) {
  const hidden = new Set(experience.hiddenIds);
  const candidates = catalog
    .filter((song) => !profile.favoriteIds.has(song.id) && !hidden.has(song.id))
    .sort((a, b) => recommendationScore(b, profile, experience.exploration) - recommendationScore(a, profile, experience.exploration));

  const selected = [];
  const artists = new Set();
  const releases = new Set();
  for (const song of candidates) {
    const artist = normalizedArtist(song);
    const release = String(song.collectionId || '');
    if (artists.has(artist)) continue;
    if (release && releases.has(release)) continue;
    selected.push(song);
    artists.add(artist);
    if (release) releases.add(release);
    if (selected.length >= MIX_SIZE) return selected;
  }
  for (const song of candidates) {
    if (selected.some((item) => item.id === song.id)) continue;
    selected.push(song);
    if (selected.length >= MIX_SIZE) break;
  }
  return selected;
}

function reasonFor(song, profile) {
  if (profile.artistCounts.has(normalizedArtist(song))) return '좋아한 아티스트의 다른 곡';
  const matchedGenre = getGenreTags(song).find((genre) => profile.genreCounts.has(genre));
  if (matchedGenre) return `좋아한 ${matchedGenre}와 가까워요`;
  const days = releaseAgeDays(song.releaseDate);
  if (days <= 14) return '2주 안에 나온 신곡';
  if (song.chartRank && song.chartRank <= 20) return `일본 차트 ${song.chartRank}위권`;
  return experience.exploration === 'adventurous' ? '취향 밖에서 한 걸음' : '새 아티스트 발견 후보';
}

function tasteStage(count) {
  if (count >= 12) return '취향이 꽤 선명해요';
  if (count >= 6) return '취향을 잘 따라가고 있어요';
  if (count >= 3) return '취향을 학습하고 있어요';
  if (count > 0) return '조금씩 취향을 알아가는 중';
  return '첫 좋아요부터 더 개인화돼요';
}

function weeklyDiscoveryCount() {
  const cutoff = Date.now() - 7 * 86400000;
  const ids = new Set(experience.activity.filter((item) => new Date(item.at).getTime() >= cutoff).map((item) => String(item.id)));
  return ids.size;
}

function recordVisit() {
  const today = localDateKey();
  if (experience.mixDay !== today) {
    experience.mixDay = today;
    experience.mixOffset = 0;
  }
  if (!experience.visitDays.includes(today)) {
    experience.visitDays.push(today);
    experience.visitDays = experience.visitDays.slice(-30);
  }
  writeExperience();
}

function recordActivity(song, kind = 'open') {
  if (!song?.id) return;
  const at = new Date().toISOString();
  experience.activity.push({ id: String(song.id), at, kind });
  experience.activity = experience.activity.slice(-MAX_ACTIVITY);
  experience.recent = [
    { id: String(song.id), title: song.title, artist: song.artist, at, kind },
    ...experience.recent.filter((item) => String(item.id) !== String(song.id)),
  ].slice(0, MAX_RECENT);
  writeExperience();
  scheduleHubRefresh();
}

function userStorefront() {
  try {
    return (new Intl.Locale(navigator.language || 'ko-KR').region || 'KR').toLowerCase();
  } catch {
    return 'kr';
  }
}

function platformAction(song, platform) {
  const query = `${song.artist || ''} ${song.title || ''}`.trim();
  const links = song.platformLinks || {};
  let exact = null;
  if (platform && platform !== 'apple') exact = links[platform] || null;
  if (platform === 'apple') {
    const candidate = links.apple || song.appleUrl || null;
    try {
      const url = candidate ? new URL(candidate) : null;
      const storefront = url?.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      if (url?.hostname === 'music.apple.com' && (!storefront || storefront === userStorefront())) exact = candidate;
    } catch {
      exact = null;
    }
  }
  if (exact) return { url: exact, exact: true, label: PLATFORM_LABELS[platform] };
  if (platform === 'youtubeMusic') return { url: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`, exact: false, label: PLATFORM_LABELS[platform] };
  if (platform === 'spotify') {
    const spotifyQuery = song.isrc ? `isrc:${song.isrc}` : query;
    return { url: `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`, exact: false, label: PLATFORM_LABELS[platform] };
  }
  if (platform === 'youtube') return { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, exact: false, label: PLATFORM_LABELS[platform] };
  if (platform === 'apple') return { url: `https://music.apple.com/${userStorefront()}/search?term=${encodeURIComponent(query)}`, exact: false, label: PLATFORM_LABELS[platform] };
  return { url: null, exact: false, label: '듣기' };
}

function preferredPlatform() {
  try {
    const value = safeStorage()?.getItem(PLATFORM_STORAGE_KEY);
    return value && PLATFORM_LABELS[value] ? value : null;
  } catch {
    return null;
  }
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function announce(message) {
  const live = document.querySelector('#liveStatus');
  if (live) live.textContent = message;
}

function openPremiumListen(song) {
  if (!song) return;
  const platform = preferredPlatform();
  if (!platform) {
    pendingPremiumListen = song;
    document.querySelector('#platformSettings')?.click();
    announce(`${song.title}을(를) 들을 플랫폼을 먼저 선택해 주세요.`);
    return;
  }
  const action = platformAction(song, platform);
  recordActivity(song, 'listen');
  openExternal(action.url);
}

function continuePendingListen() {
  if (!pendingPremiumListen) return;
  const platform = preferredPlatform();
  if (!platform) {
    pendingPremiumListen = null;
    return;
  }
  const song = pendingPremiumListen;
  pendingPremiumListen = null;
  const action = platformAction(song, platform);
  recordActivity(song, 'listen');
  openExternal(action.url);
}

function openSongInCatalog(song) {
  const input = document.querySelector('#searchInput');
  if (!input || !song) return;
  input.value = song.title;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: song.title }));
  recordActivity(song, 'open');
  window.setTimeout(() => {
    const target = [...document.querySelectorAll('[data-song-id]')].find((node) => node.dataset.songId === String(song.id));
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }, 220);
}

function decorateBadge(node) {
  const text = node.textContent.trim();
  const kind = text.startsWith('Apple JP #')
    ? 'rank'
    : text.startsWith('발매 ')
      ? 'release'
      : 'recommendation';
  if (node.dataset.badgeKind !== kind) node.dataset.badgeKind = kind;
}

function decorateListenButton(node) {
  const text = node.textContent;
  if (!text.includes('↗')) return;
  node.textContent = text.replace(/\s*↗/g, '');
  node.classList.add('external-action');
}

function decorateFavoritesNav() {
  const button = document.querySelector(selectors.favorites);
  if (!button) return;
  const text = button.textContent.trim();
  if (!/^[♡♥]/.test(text)) return;
  const label = text.replace(/^[♡♥]\s*/, '');
  button.textContent = label;
  button.dataset.icon = button.classList.contains('active') ? 'heart-filled' : 'heart';
}

function decorateBaseUi() {
  document.querySelectorAll(selectors.badges).forEach(decorateBadge);
  document.querySelectorAll(selectors.listen).forEach(decorateListenButton);
  decorateFavoritesNav();
}

function injectPremiumStyles() {
  if (document.querySelector('#jplaylist-premium-styles')) return;
  const style = document.createElement('style');
  style.id = 'jplaylist-premium-styles';
  style.textContent = `
    .site-header .github-link { display: none; }
    .jp-source-link { color: var(--subtle); text-decoration: underline; text-underline-offset: 3px; }
    .jp-source-link:hover { color: var(--text); }
    .jp-mix-link { margin-left: 8px; }
    .jp-personalized-hub { margin: 22px 0 72px; scroll-margin-top: 18px; }
    .jp-hub-shell {
      position: relative;
      overflow: hidden;
      padding: clamp(20px, 3vw, 34px);
      border: 1px solid var(--line);
      border-radius: 28px;
      background:
        radial-gradient(circle at 88% 8%, rgba(155,124,255,.16), transparent 28%),
        linear-gradient(145deg, rgba(255,93,158,.08), transparent 42%),
        var(--surface-1);
      box-shadow: var(--shadow-card);
    }
    .jp-hub-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
    .jp-hub-heading h2 { margin: 4px 0 6px; font-size: clamp(28px, 4vw, 44px); line-height: 1.04; letter-spacing: -.045em; }
    .jp-hub-heading p { margin: 0; color: var(--muted); max-width: 680px; line-height: 1.65; }
    .jp-hub-kicker { color: var(--selected) !important; font-size: 12px; font-weight: 850; letter-spacing: .13em; }
    .jp-hub-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .jp-quiet-button, .jp-chip-button, .jp-recent-item, .jp-dismiss, .jp-mix-open, .jp-mix-listen {
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font-weight: 750;
    }
    .jp-quiet-button { padding: 0 14px; }
    .jp-quiet-button:hover, .jp-chip-button:hover, .jp-recent-item:hover, .jp-dismiss:hover { border-color: var(--line-strong); background: var(--surface-3); }
    .jp-taste-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 20px; }
    .jp-taste-card { min-height: 94px; padding: 15px 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; background: rgba(255,255,255,.035); }
    .jp-taste-card > span { display: block; color: var(--subtle); font-size: 12px; font-weight: 700; margin-bottom: 7px; }
    .jp-taste-card > strong { display: block; font-size: 17px; line-height: 1.35; }
    .jp-taste-card small { display: block; margin-top: 5px; color: var(--muted); line-height: 1.4; }
    .jp-exploration { grid-column: span 1; }
    .jp-exploration-options { display: flex; flex-wrap: wrap; gap: 6px; }
    .jp-chip-button { min-height: 44px; padding: 0 10px; border-radius: 999px; font-size: 12px; color: var(--muted); }
    .jp-chip-button[aria-checked="true"] { color: var(--text); border-color: var(--selected); background: rgba(173,149,255,.13); }
    .jp-mix-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .jp-mix-card { min-width: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: rgba(8,8,13,.48); }
    .jp-mix-art { position: relative; aspect-ratio: 1; overflow: hidden; background: linear-gradient(135deg, var(--surface-3), var(--surface-2)); }
    .jp-mix-art img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .jp-mix-reason { position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 20px); padding: 6px 9px; border-radius: 999px; background: rgba(9,9,15,.88); border: 1px solid rgba(255,255,255,.13); font-size: 11px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jp-mix-info { padding: 14px; }
    .jp-mix-title { margin: 0 0 5px; font-size: 15px; line-height: 1.38; min-height: 2.76em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .jp-mix-artist { display: block; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jp-mix-meta { margin-top: 9px; color: var(--subtle); font-size: 11px; }
    .jp-mix-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 12px; }
    .jp-mix-open, .jp-mix-listen { padding: 0 10px; font-size: 12px; }
    .jp-mix-listen { border-color: transparent; background: var(--action-primary-bg); color: var(--action-primary-text); }
    .jp-dismiss { width: 100%; margin-top: 7px; padding: 0 10px; border-color: transparent; background: transparent; color: var(--subtle); font-size: 11px; }
    .jp-recent { margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.09); }
    .jp-recent-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .jp-recent-head h3 { margin: 0; font-size: 14px; }
    .jp-recent-head span { color: var(--subtle); font-size: 12px; }
    .jp-recent-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .jp-recent-item { min-width: 0; padding: 10px 12px; text-align: left; }
    .jp-recent-item strong, .jp-recent-item span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .jp-recent-item strong { font-size: 13px; }
    .jp-recent-item span { margin-top: 3px; color: var(--subtle); font-size: 11px; }
    .jp-empty-mix { padding: 24px; border: 1px dashed var(--line); border-radius: 16px; color: var(--muted); text-align: center; }
    @media (max-width: 900px) {
      .jp-mix-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .jp-recent-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .jp-personalized-hub { margin: 12px 0 48px; }
      .jp-hub-shell { padding: 18px; border-radius: 22px; }
      .jp-hub-heading { align-items: flex-start; flex-direction: column; gap: 14px; }
      .jp-hub-actions { width: 100%; justify-content: stretch; }
      .jp-hub-actions .jp-quiet-button { flex: 1; }
      .jp-taste-strip { grid-template-columns: 1fr 1fr; }
      .jp-exploration { grid-column: 1 / -1; }
      .jp-mix-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .jp-mix-info { padding: 11px; }
      .jp-mix-actions { grid-template-columns: 1fr; }
      .jp-mix-open, .jp-mix-listen { min-height: 44px; }
      .jp-recent-row { grid-template-columns: 1fr; }
      .jp-mix-link { margin-left: 0; }
    }
    @media (max-width: 340px) {
      .jp-mix-grid { grid-template-columns: 1fr; }
      .jp-mix-card { display: grid; grid-template-columns: 112px minmax(0, 1fr); }
      .jp-mix-art { aspect-ratio: auto; min-height: 100%; }
      .jp-mix-actions { grid-template-columns: 1fr; }
      .jp-dismiss { grid-column: 1 / -1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .jp-personalized-hub *, .jp-personalized-hub *::before, .jp-personalized-hub *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
    }
  `;
  document.head.append(style);
}

function addServiceCredit() {
  const footer = document.querySelector('footer p');
  if (!footer || footer.querySelector('.jp-source-link')) return;
  footer.append(document.createTextNode(' · '));
  const link = document.createElement('a');
  link.className = 'jp-source-link';
  link.href = 'https://github.com/6rmkhj/JPlaylist';
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '오픈소스';
  footer.append(link);
}

function addHeroMixLink() {
  const actions = document.querySelector('.hero-copy-actions');
  if (!actions || actions.querySelector('.jp-mix-link')) return;
  const link = document.createElement('a');
  link.className = 'secondary-button jp-mix-link';
  link.href = '#personalized';
  link.textContent = '오늘의 믹스';
  actions.append(link);
}

function formatRelease(song) {
  const days = releaseAgeDays(song.releaseDate);
  if (days <= 0) return '오늘 발매';
  if (days === 1) return '어제 발매';
  if (days <= 30) return `${days}일 전 발매`;
  if (song.chartRank) return `Apple JP #${song.chartRank}`;
  return getGenreTags(song)[0] || '일본 음악';
}

function recentMarkup() {
  const recent = experience.recent.filter((item) => catalog.some((song) => song.id === String(item.id)));
  if (!recent.length) return '';
  return `
    <div class="jp-recent">
      <div class="jp-recent-head">
        <h3>최근에 살펴본 곡</h3>
        <span>최근 7일 ${weeklyDiscoveryCount()}곡 발견</span>
      </div>
      <div class="jp-recent-row">
        ${recent.slice(0, 6).map((item) => `
          <button class="jp-recent-item" type="button" data-jp-recent="${escapeHtml(item.id)}">
            <strong${langAttr(item.title)}>${escapeHtml(item.title)}</strong>
            <span${langAttr(item.artist)}>${escapeHtml(item.artist)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function mixCardMarkup(song, profile) {
  const platform = preferredPlatform();
  const action = platform ? platformAction(song, platform) : null;
  const listenLabel = platform
    ? `${PLATFORM_LABELS[platform]} ${action?.exact ? '열기' : '검색'}`
    : '듣기 선택';
  const image = song.artwork
    ? `<img src="${escapeHtml(artwork(song.artwork))}" alt="" loading="lazy" decoding="async" />`
    : '';
  return `
    <article class="jp-mix-card" data-jp-song="${escapeHtml(song.id)}">
      <div class="jp-mix-art">
        ${image}
        <span class="jp-mix-reason">${escapeHtml(reasonFor(song, profile))}</span>
      </div>
      <div class="jp-mix-info">
        <h3 class="jp-mix-title"${langAttr(song.title)} title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h3>
        <span class="jp-mix-artist"${langAttr(song.artist)} title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</span>
        <div class="jp-mix-meta">${escapeHtml(formatRelease(song))}</div>
        <div class="jp-mix-actions">
          <button class="jp-mix-open" type="button" data-jp-open="${escapeHtml(song.id)}">목록에서 보기</button>
          <button class="jp-mix-listen" type="button" data-jp-listen="${escapeHtml(song.id)}">${escapeHtml(listenLabel)}</button>
        </div>
        <button class="jp-dismiss" type="button" data-jp-dismiss="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} 관심 없음`)}">이 추천은 관심 없어요</button>
      </div>
    </article>
  `;
}

function renderHub({ focusExploration = null } = {}) {
  if (!hub || !catalog.length) return;
  const favorites = favoriteSongs();
  const profile = buildTasteProfile(favorites);
  const mix = buildDailyMix(profile);
  const topGenre = profile.topGenres[0]?.[0] || '아직 없음';
  const topArtistKey = profile.topArtists[0]?.[0];
  const topArtist = topArtistKey
    ? favorites.find((song) => normalizedArtist(song) === topArtistKey)?.artist || '아직 없음'
    : '아직 없음';
  const hiddenCount = experience.hiddenIds.length;
  const stage = tasteStage(favorites.length);
  const intro = favorites.length >= 3
    ? `좋아요 ${favorites.length}곡과 최근 행동을 바탕으로 오늘의 8곡을 골랐어요. 관심 없는 추천을 알려주면 다음 믹스부터 제외합니다.`
    : favorites.length
      ? `좋아요가 ${favorites.length}곡 있어요. 3곡 이상 쌓이면 장르·아티스트 취향을 더 강하게 반영합니다.`
      : '처음에는 최신성과 일본 차트 흐름을 균형 있게 섞습니다. 좋아요를 남길수록 이 믹스가 개인화됩니다.';

  hub.innerHTML = `
    <div class="jp-hub-shell">
      <div class="jp-hub-heading">
        <div>
          <p class="jp-hub-kicker">FOR YOU · ${escapeHtml(localDateKey())}</p>
          <h2 id="jpHubTitle">오늘의 믹스</h2>
          <p>${escapeHtml(intro)}</p>
        </div>
        <div class="jp-hub-actions">
          ${hiddenCount ? `<button class="jp-quiet-button" type="button" data-jp-reset-hidden>숨김 ${hiddenCount}곡 초기화</button>` : ''}
          <button class="jp-quiet-button" type="button" data-jp-remix>다른 8곡</button>
        </div>
      </div>

      <div class="jp-taste-strip" aria-label="취향 요약">
        <div class="jp-taste-card">
          <span>개인화 상태</span>
          <strong>${escapeHtml(stage)}</strong>
          <small>좋아요 ${favorites.length}곡 · 최근 7일 ${weeklyDiscoveryCount()}곡 탐색</small>
        </div>
        <div class="jp-taste-card">
          <span>지금 보이는 취향</span>
          <strong>${escapeHtml(topGenre)}</strong>
          <small>자주 저장한 아티스트 · <span${langAttr(topArtist)}>${escapeHtml(topArtist)}</span></small>
        </div>
        <div class="jp-taste-card jp-exploration">
          <span>추천의 새로움</span>
          <div class="jp-exploration-options" role="radiogroup" aria-label="추천의 새로움">
            ${Object.entries(EXPLORATION_OPTIONS).map(([key, option]) => `
              <button class="jp-chip-button" type="button" role="radio" data-jp-exploration="${key}" aria-checked="${experience.exploration === key}" tabindex="${experience.exploration === key ? '0' : '-1'}">${option.label}</button>
            `).join('')}
          </div>
        </div>
      </div>

      ${mix.length ? `<div class="jp-mix-grid">${mix.map((song) => mixCardMarkup(song, profile)).join('')}</div>` : '<div class="jp-empty-mix">추천 후보를 모두 숨겼어요. 숨김을 초기화하면 다시 추천을 만들 수 있습니다.</div>'}
      ${recentMarkup()}
    </div>
  `;
  if (focusExploration) hub.querySelector(`[data-jp-exploration="${focusExploration}"]`)?.focus({ preventScroll: true });
}

function scheduleHubRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => renderHub(), 120);
}

function catalogSong(id) {
  return catalog.find((song) => song.id === String(id)) || null;
}

function setExploration(mode, { focus = false } = {}) {
  if (!EXPLORATION_OPTIONS[mode]) return;
  experience.exploration = mode;
  experience.mixOffset = 0;
  writeExperience();
  renderHub({ focusExploration: focus ? mode : null });
  announce(`추천의 새로움을 ${EXPLORATION_OPTIONS[mode].label}으로 바꿨습니다.`);
}

function handleExplorationKey(event) {
  const button = event.target.closest('[data-jp-exploration]');
  if (!button) return;
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const modes = Object.keys(EXPLORATION_OPTIONS);
  const current = modes.indexOf(button.dataset.jpExploration);
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % modes.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + modes.length) % modes.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = modes.length - 1;
  setExploration(modes[next], { focus: true });
}

function dismissRecommendation(id) {
  const song = catalogSong(id);
  if (!song || experience.hiddenIds.includes(String(id))) return;
  experience.hiddenIds.push(String(id));
  experience.hiddenIds = experience.hiddenIds.slice(-MAX_HIDDEN);
  writeExperience();
  renderHub();
  announce(`${song.title}은(는) 앞으로 오늘의 믹스에서 제외합니다.`);
}

function resetHidden() {
  experience.hiddenIds = [];
  writeExperience();
  renderHub();
  announce('관심 없음으로 숨긴 추천을 모두 다시 후보에 포함했습니다.');
}

function remix() {
  experience.mixOffset = (experience.mixOffset + 1) % 10000;
  writeExperience();
  renderHub();
  announce('다른 추천 8곡으로 바꿨습니다.');
}

function handleHubClick(event) {
  const exploration = event.target.closest('[data-jp-exploration]');
  if (exploration) {
    setExploration(exploration.dataset.jpExploration, { focus: true });
    return;
  }
  const open = event.target.closest('[data-jp-open]');
  if (open) {
    openSongInCatalog(catalogSong(open.dataset.jpOpen));
    return;
  }
  const listen = event.target.closest('[data-jp-listen]');
  if (listen) {
    openPremiumListen(catalogSong(listen.dataset.jpListen));
    return;
  }
  const dismiss = event.target.closest('[data-jp-dismiss]');
  if (dismiss) {
    dismissRecommendation(dismiss.dataset.jpDismiss);
    return;
  }
  const recent = event.target.closest('[data-jp-recent]');
  if (recent) {
    openSongInCatalog(catalogSong(recent.dataset.jpRecent));
    return;
  }
  if (event.target.closest('[data-jp-remix]')) {
    remix();
    return;
  }
  if (event.target.closest('[data-jp-reset-hidden]')) resetHidden();
}

function captureBaseActivity(event) {
  const listen = event.target.closest?.('[data-listen-id]');
  const preview = event.target.closest?.('[data-preview-id]');
  if (listen) recordActivity(catalogSong(listen.dataset.listenId), 'listen');
  else if (preview) recordActivity(catalogSong(preview.dataset.previewId), 'preview');

  if (event.target.closest?.('[data-like-id], #featuredLike, #favoriteUndoButton, #backupMerge, #backupReplace, #undoImport')) {
    scheduleHubRefresh();
  }
}

async function loadCatalog() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  payload = await response.json();
  catalog = dedupeSongs(Array.isArray(payload?.songs) ? payload.songs : [...(payload?.latestSongs || []), ...(payload?.popularSongs || [])]);
}

function installHub() {
  if (document.querySelector('#personalized')) return;
  const main = document.querySelector('main');
  const hero = document.querySelector('.hero');
  if (!main || !hero) return;
  hub = document.createElement('section');
  hub.id = 'personalized';
  hub.className = 'jp-personalized-hub';
  hub.setAttribute('aria-labelledby', 'jpHubTitle');
  hero.insertAdjacentElement('afterend', hub);
  hub.addEventListener('click', handleHubClick);
  hub.addEventListener('keydown', handleExplorationKey);
  renderHub();
}

function bindPlatformContinuation() {
  document.querySelector('#platformDialog')?.addEventListener('close', () => window.setTimeout(continuePendingListen, 0));
}

function bindExperienceEvents() {
  document.addEventListener('click', captureBaseActivity, true);
  window.addEventListener('focus', scheduleHubRefresh);
}

async function boot() {
  injectPremiumStyles();
  decorateBaseUi();
  addServiceCredit();
  addHeroMixLink();
  recordVisit();
  bindPlatformContinuation();
  bindExperienceEvents();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => !mutation.target.closest?.('#personalized'))) decorateBaseUi();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  try {
    await loadCatalog();
    installHub();
  } catch (error) {
    console.warn('Personalized experience unavailable:', error);
  }
}

boot();
