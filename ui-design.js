import {
  DAILY_ROLES,
  RABBIT_DIRECTIONS,
  buildDailyThree,
  buildRabbitHole,
  buildTasteProfile,
  dedupeSongs,
  localDateKey,
  tasteNarrative,
} from './experience-core.mjs';
import {
  getGenreTags,
  languageForText,
  releaseAgeDays,
} from './core.mjs';

const DATA_URL = './data/songs.json';
const FAVORITES_STORAGE_KEY = 'jplaylist-favorites-v2';
const PLATFORM_STORAGE_KEY = 'jplaylist-listen-platform-v1';
const EXPERIENCE_STORAGE_KEY = 'jplaylist-experience-v1';
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
  steady: { label: '취향 중심' },
  balanced: { label: '균형' },
  adventurous: { label: '새로움 우선' },
};

let catalog = [];
let hub = null;
let pendingListen = null;
let refreshTimer = null;
let experience = loadExperience();

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

function readJson(key, fallback) {
  try {
    const raw = safeStorage()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeExperience() {
  try {
    safeStorage()?.setItem(EXPERIENCE_STORAGE_KEY, JSON.stringify(experience));
    return true;
  } catch { return false; }
}

function loadExperience() {
  const stored = readJson(EXPERIENCE_STORAGE_KEY, null);
  return {
    version: 2,
    exploration: EXPLORATION_OPTIONS[stored?.exploration] ? stored.exploration : 'balanced',
    hiddenIds: Array.isArray(stored?.hiddenIds) ? stored.hiddenIds.map(String).slice(-MAX_HIDDEN) : [],
    activity: Array.isArray(stored?.activity) ? stored.activity.slice(-MAX_ACTIVITY) : [],
    recent: Array.isArray(stored?.recent) ? stored.recent.slice(0, MAX_RECENT) : [],
    visitDays: Array.isArray(stored?.visitDays) ? stored.visitDays.slice(-30) : [],
    mixOffset: Number.isFinite(stored?.mixOffset) ? stored.mixOffset : 0,
    mixDay: typeof stored?.mixDay === 'string' ? stored.mixDay : null,
    rabbitStartId: stored?.rabbitStartId ? String(stored.rabbitStartId) : null,
    rabbitDirection: RABBIT_DIRECTIONS[stored?.rabbitDirection] ? stored.rabbitDirection : 'deeper',
    rabbitOffset: Number.isFinite(stored?.rabbitOffset) ? stored.rabbitOffset : 0,
  };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function langAttr(value) {
  const lang = languageForText(value);
  return lang ? ` lang="${lang}"` : '';
}

function artwork(url, size = 480) {
  if (!url) return '';
  return String(url).replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function favoriteSongs() {
  const stored = readJson(FAVORITES_STORAGE_KEY, null);
  const items = Array.isArray(stored) ? stored : stored?.items;
  return Array.isArray(items) ? dedupeSongs(items) : [];
}

function userStorefront() {
  try { return (new Intl.Locale(navigator.language || 'ko-KR').region || 'KR').toLowerCase(); }
  catch { return 'kr'; }
}

function preferredPlatform() {
  try {
    const value = safeStorage()?.getItem(PLATFORM_STORAGE_KEY);
    return value && PLATFORM_LABELS[value] ? value : null;
  } catch { return null; }
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
    } catch { exact = null; }
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

function announce(message) {
  const live = document.querySelector('#liveStatus');
  if (live) live.textContent = message;
}

function recordVisit() {
  const today = localDateKey();
  if (experience.mixDay !== today) {
    experience.mixDay = today;
    experience.mixOffset = 0;
    experience.rabbitOffset = 0;
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
  scheduleRefresh();
}

function weeklyDiscoveryCount() {
  const cutoff = Date.now() - 7 * 86400000;
  return new Set(experience.activity.filter((item) => new Date(item.at).getTime() >= cutoff).map((item) => String(item.id))).size;
}

function catalogSong(id) { return catalog.find((song) => song.id === String(id)) || null; }
function openExternal(url) { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }

function openListen(song) {
  if (!song) return;
  const platform = preferredPlatform();
  if (!platform) {
    pendingListen = song;
    document.querySelector('#platformSettings')?.click();
    announce(`${song.title}을(를) 들을 플랫폼을 먼저 선택해 주세요.`);
    return;
  }
  const action = platformAction(song, platform);
  recordActivity(song, 'listen');
  openExternal(action.url);
}

function continuePendingListen() {
  if (!pendingListen) return;
  const platform = preferredPlatform();
  if (!platform) { pendingListen = null; return; }
  const song = pendingListen;
  pendingListen = null;
  recordActivity(song, 'listen');
  openExternal(platformAction(song, platform).url);
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

function decorateBaseUi() {
  document.querySelectorAll('.card-rank, #featuredRank').forEach((node) => {
    const text = node.textContent.trim();
    node.dataset.badgeKind = text.startsWith('Apple JP #') ? 'rank' : text.startsWith('발매 ') ? 'release' : 'recommendation';
  });
  document.querySelectorAll('[data-listen-id], #featuredListen').forEach((node) => {
    if (!node.textContent.includes('↗')) return;
    node.textContent = node.textContent.replace(/\s*↗/g, '');
    node.classList.add('external-action');
  });
  const favorites = document.querySelector('#favoritesFilter');
  if (favorites && /^[♡♥]/.test(favorites.textContent.trim())) {
    favorites.textContent = favorites.textContent.trim().replace(/^[♡♥]\s*/, '');
    favorites.dataset.icon = favorites.classList.contains('active') ? 'heart-filled' : 'heart';
  }
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

function addHeroSignatureLink() {
  const actions = document.querySelector('.hero-copy-actions');
  if (!actions || actions.querySelector('.jp-signature-link')) return;
  const existing = actions.querySelector('.hero-discover-link');
  if (existing) { existing.href = '#personalized'; existing.textContent = '내 취향 지도 보기'; }
  const link = document.createElement('a');
  link.className = 'secondary-button jp-signature-link direction-down';
  link.href = '#discovery';
  link.textContent = '전체 곡 탐색';
  actions.append(link);
}

function formatRelease(song) {
  const days = releaseAgeDays(song.releaseDate);
  if (days <= 0) return '오늘 발매';
  if (days === 1) return '어제 발매';
  if (days <= 30) return `${Math.round(days)}일 전 발매`;
  if (song.chartRank) return `Apple JP #${song.chartRank}`;
  return getGenreTags(song)[0] || '일본 음악';
}

function topArtistName(profile) {
  const key = profile.topArtists[0]?.[0];
  if (!key) return null;
  return profile.favorites.find((song) => String(song.artist || '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP') === key)?.artist || null;
}

function profileTags(profile) {
  const tags = profile.topGenres.slice(0, 3).map(([genre]) => genre);
  const artist = topArtistName(profile);
  if (artist) tags.push(artist);
  if (!tags.length) tags.push('좋아요로 지도 만들기');
  return tags.slice(0, 4);
}

function signalMarkup(label, value) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `<div class="jp-signal-row"><span>${escapeHtml(label)}</span><div class="jp-signal-track" aria-hidden="true"><div class="jp-signal-fill" style="--signal:${percent}"></div></div><strong>${percent}%</strong></div>`;
}

function tasteMapMarkup(profile) {
  const favorites = profile.favorites.length;
  const stage = favorites >= 12 ? '신뢰도 높음' : favorites >= 5 ? '학습 중' : favorites ? '초기 지도' : '시작 전';
  return `
    <div class="jp-map-layout">
      <section class="jp-map-panel" aria-labelledby="jpTasteMapTitle">
        <div class="jp-map-panel-head"><div><p class="jp-section-kicker">TASTE MAP</p><h3 id="jpTasteMapTitle">지금 내 취향의 위치</h3></div><span class="jp-map-state">${escapeHtml(stage)}</span></div>
        <div class="jp-map-plane-wrap">
          <span class="jp-axis jp-axis-top">새 아티스트 탐험</span><span class="jp-axis jp-axis-left">익숙한 취향</span><span class="jp-axis jp-axis-bottom-left">차트 중심</span><span class="jp-axis jp-axis-bottom-right">딥컷</span>
          <div class="jp-map-plane" role="img" aria-label="차트 밖 성향 ${profile.mapX}%, 새 아티스트 탐험 ${profile.mapY}% 지점"><span class="jp-map-point" style="--taste-x:${profile.mapX};--taste-y:${profile.mapY}" aria-hidden="true"></span></div>
        </div>
      </section>
      <section class="jp-map-insight" aria-label="취향 해석">
        <p class="jp-section-kicker">YOUR POSITION</p><h3>${escapeHtml(profile.mapLabel)}</h3><p class="jp-map-narrative">${escapeHtml(tasteNarrative(profile))}</p>
        <div class="jp-taste-tags">${profileTags(profile).map((tag) => `<span class="jp-taste-tag"${langAttr(tag)}>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="jp-signal-list">${signalMarkup('차트 밖 성향', profile.deepCut)}${signalMarkup('새 아티스트', profile.exploration)}${signalMarkup('최근 발매', profile.freshness)}${signalMarkup('장르 폭', profile.breadth)}</div>
        <div class="jp-exploration-control"><span>오늘 추천을 얼마나 낯설게 할까요?</span><div class="jp-exploration-options" role="radiogroup" aria-label="추천의 새로움">
          ${Object.entries(EXPLORATION_OPTIONS).map(([key, option]) => `<button class="jp-direction" type="button" role="radio" data-jp-exploration="${key}" aria-checked="${experience.exploration === key}" tabindex="${experience.exploration === key ? '0' : '-1'}">${escapeHtml(option.label)}</button>`).join('')}
        </div></div>
      </section>
    </div>`;
}

function dailyCardMarkup(pick) {
  const { song } = pick;
  const platform = preferredPlatform();
  const action = platform ? platformAction(song, platform) : null;
  const listenLabel = platform ? `${PLATFORM_LABELS[platform]} ${action?.exact ? '열기' : '검색'}` : '듣기 선택';
  const image = song.artwork ? `<img src="${escapeHtml(artwork(song.artwork, 640))}" alt="" loading="lazy" decoding="async" />` : '';
  return `
    <article class="jp-daily-card" data-role="${pick.key}" data-jp-song="${escapeHtml(song.id)}">
      <div class="jp-daily-art">${image}<span class="jp-role-badge">${escapeHtml(pick.label)}</span></div>
      <div class="jp-daily-copy">
        <p class="jp-role-kicker">${escapeHtml(pick.eyebrow)}</p><h4 class="jp-daily-title"${langAttr(song.title)} title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h4><span class="jp-daily-artist"${langAttr(song.artist)}>${escapeHtml(song.artist)}</span>
        <p class="jp-daily-reason">${escapeHtml(pick.reason)}</p><div class="jp-daily-meta">${escapeHtml(formatRelease(song))}</div>
        <div class="jp-daily-actions"><button class="jp-daily-hole" type="button" data-jp-rabbit-start="${escapeHtml(song.id)}">Rabbit Hole 시작</button><button class="jp-daily-open" type="button" data-jp-open="${escapeHtml(song.id)}">곡 보기</button><button class="jp-daily-listen" type="button" data-jp-listen="${escapeHtml(song.id)}">${escapeHtml(listenLabel)}</button></div>
        <button class="jp-dismiss" type="button" data-jp-dismiss="${escapeHtml(song.id)}" aria-label="${escapeHtml(`${song.title} 관심 없음`)}">이 추천은 관심 없어요</button>
      </div>
    </article>`;
}

function recentMarkup() {
  const recent = experience.recent.filter((item) => catalog.some((song) => song.id === String(item.id)));
  if (!recent.length) return '';
  return `<div class="jp-recent"><div class="jp-recent-head"><h3>내가 만든 발견 기록</h3><span>최근 7일 ${weeklyDiscoveryCount()}곡</span></div><div class="jp-recent-row">${recent.slice(0, 6).map((item) => `<button class="jp-recent-item" type="button" data-jp-recent="${escapeHtml(item.id)}"><strong${langAttr(item.title)}>${escapeHtml(item.title)}</strong><span${langAttr(item.artist)}>${escapeHtml(item.artist)}</span></button>`).join('')}</div></div>`;
}

function rabbitPathMarkup(path) {
  return `<div class="jp-rabbit-path" aria-label="Rabbit Hole 5단계 경로">${path.map(({ song, reason }, index) => `
    <article class="jp-path-card" data-jp-path-song="${escapeHtml(song.id)}"><div class="jp-path-step"><span>STEP ${index + 1}</span><span>${index === 0 ? 'START' : 'NEXT'}</span></div>${song.artwork ? `<img class="jp-path-thumb" src="${escapeHtml(artwork(song.artwork, 360))}" alt="" loading="lazy" decoding="async" />` : '<div class="jp-path-thumb" aria-hidden="true"></div>'}<h4 class="jp-path-title"${langAttr(song.title)}>${escapeHtml(song.title)}</h4><span class="jp-path-artist"${langAttr(song.artist)}>${escapeHtml(song.artist)}</span><p class="jp-path-reason">${escapeHtml(reason)}</p><div class="jp-path-actions"><button class="jp-path-action" type="button" data-jp-listen="${escapeHtml(song.id)}">듣기</button><button class="jp-path-action" type="button" data-jp-rabbit-start="${escapeHtml(song.id)}">여기서 다시</button></div></article>`).join('')}</div>`;
}

function rabbitMarkup(profile) {
  const start = catalogSong(experience.rabbitStartId);
  const direction = experience.rabbitDirection;
  const path = start ? buildRabbitHole({ start, catalog, profile, hiddenIds: experience.hiddenIds, direction, dayKey: localDateKey(), offset: experience.rabbitOffset, steps: 5 }) : [];
  return `
    <section class="jp-rabbit-section" id="rabbitHole" aria-labelledby="jpRabbitTitle">
      <div class="jp-rabbit-heading"><div><p class="jp-section-kicker">RABBIT HOLE</p><h3 id="jpRabbitTitle">한 곡에서 다음 취향으로, 5단계</h3><p>${start ? `${escapeHtml(start.artist)} · ${escapeHtml(start.title)}에서 출발한 경로예요.` : '오늘의 3곡 중 하나를 출발점으로 고르면, 한 번에 다섯 곡만 이어서 보여줍니다.'}</p></div>
        <div class="jp-rabbit-controls" role="radiogroup" aria-label="Rabbit Hole 방향">${Object.entries(RABBIT_DIRECTIONS).map(([key, option]) => `<button class="jp-direction" type="button" role="radio" data-jp-rabbit-direction="${key}" aria-checked="${direction === key}" tabindex="${direction === key ? '0' : '-1'}" title="${escapeHtml(option.description)}">${escapeHtml(option.label)}</button>`).join('')}${start ? '<button class="jp-quiet-button" type="button" data-jp-rabbit-remix>다른 경로</button>' : ''}</div>
      </div>
      ${path.length ? rabbitPathMarkup(path) : `<div class="jp-rabbit-empty"><span class="jp-rabbit-empty-mark" aria-hidden="true">↘</span><div><strong>추천 목록이 아니라 탐험 경로입니다.</strong><span>${escapeHtml(DAILY_ROLES[1].description)}부터 시작해 보세요.</span></div></div>`}
    </section>`;
}

function renderHub({ focusExploration = null, focusRabbitDirection = null, scrollRabbit = false } = {}) {
  if (!hub || !catalog.length) return;
  const favorites = favoriteSongs();
  const profile = buildTasteProfile({ favorites, activity: experience.activity, catalog });
  const daily = buildDailyThree({ catalog, profile, hiddenIds: experience.hiddenIds, dayKey: localDateKey(), offset: experience.mixOffset, exploration: experience.exploration });
  const hiddenCount = experience.hiddenIds.length;
  const intro = favorites.length >= 5
    ? '좋아요와 실제 탐색 기록으로 취향 위치를 계산하고, 오늘은 그 위치 안쪽·경계·바깥에서 한 곡씩만 고릅니다.'
    : favorites.length
      ? `좋아요 ${favorites.length}곡으로 첫 지도를 만들었어요. 듣고 열어보는 행동이 쌓이면 지도와 Rabbit Hole이 더 개인화됩니다.`
      : '아직 데이터가 적을 때는 최근 발매와 일본 차트 흐름을 출발점으로 씁니다. 좋아요와 탐색이 쌓이면 이 지도가 당신만의 모양으로 바뀝니다.';

  hub.innerHTML = `
    <div class="jp-signature-shell">
      <header class="jp-signature-head"><div><p class="jp-signature-kicker">YOUR J-MUSIC COMPASS</p><h2 id="jpHubTitle">내 취향을 보고,<br />다음 취향으로 간다.</h2><p>${escapeHtml(intro)}</p></div><div class="jp-signature-actions">${hiddenCount ? `<button class="jp-quiet-button" type="button" data-jp-reset-hidden>관심 없음 ${hiddenCount}곡 초기화</button>` : ''}<button class="jp-quiet-button" type="button" data-jp-remix>오늘의 3곡 새로 고르기</button></div></header>
      ${tasteMapMarkup(profile)}
      <section class="jp-daily-section" aria-labelledby="jpDailyTitle"><div class="jp-daily-heading"><div><p class="jp-section-kicker">THREE MOVES A DAY</p><h3 id="jpDailyTitle">오늘은 딱 세 방향만</h3><p>안전픽 하나, 취향 경계 하나, 깊게 파볼 곡 하나. 추천을 많이 보여주는 대신 역할을 분명히 합니다.</p></div><span class="jp-daily-date">${escapeHtml(localDateKey())}</span></div>${daily.length ? `<div class="jp-daily-grid">${daily.map(dailyCardMarkup).join('')}</div>` : '<div class="jp-empty-daily">오늘 추천 후보를 모두 숨겼어요. 관심 없음 목록을 초기화하면 다시 만들 수 있습니다.</div>'}</section>
      ${rabbitMarkup(profile)}${recentMarkup()}
    </div>`;

  if (focusExploration) hub.querySelector(`[data-jp-exploration="${focusExploration}"]`)?.focus({ preventScroll: true });
  if (focusRabbitDirection) hub.querySelector(`[data-jp-rabbit-direction="${focusRabbitDirection}"]`)?.focus({ preventScroll: true });
  if (scrollRabbit) window.requestAnimationFrame(() => document.querySelector('#rabbitHole')?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => renderHub(), 120);
}

function setExploration(mode, { focus = false } = {}) {
  if (!EXPLORATION_OPTIONS[mode]) return;
  experience.exploration = mode;
  experience.mixOffset = 0;
  writeExperience();
  renderHub({ focusExploration: focus ? mode : null });
  announce(`오늘 추천을 ${EXPLORATION_OPTIONS[mode].label}으로 조정했습니다.`);
}

function handleRovingKey(event, selector, keys, setter) {
  const button = event.target.closest(selector);
  if (!button || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  event.preventDefault();
  const current = keys.indexOf(button.dataset[selector.includes('rabbit') ? 'jpRabbitDirection' : 'jpExploration']);
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % keys.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + keys.length) % keys.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = keys.length - 1;
  setter(keys[next], { focus: true });
  return true;
}

function handleHubKeydown(event) {
  if (handleRovingKey(event, '[data-jp-exploration]', Object.keys(EXPLORATION_OPTIONS), setExploration)) return;
  handleRovingKey(event, '[data-jp-rabbit-direction]', Object.keys(RABBIT_DIRECTIONS), setRabbitDirection);
}

function dismissRecommendation(id) {
  const song = catalogSong(id);
  if (!song || experience.hiddenIds.includes(String(id))) return;
  experience.hiddenIds.push(String(id));
  experience.hiddenIds = experience.hiddenIds.slice(-MAX_HIDDEN);
  if (experience.rabbitStartId === String(id)) experience.rabbitStartId = null;
  writeExperience(); renderHub();
  announce(`${song.title}은(는) 앞으로 오늘의 추천과 Rabbit Hole 후보에서 제외합니다.`);
}

function resetHidden() { experience.hiddenIds = []; writeExperience(); renderHub(); announce('관심 없음으로 숨긴 곡을 다시 추천 후보에 포함했습니다.'); }
function remixDaily() { experience.mixOffset = (experience.mixOffset + 1) % 10000; writeExperience(); renderHub(); announce('오늘의 세 방향을 새로 골랐습니다.'); }

function startRabbit(id) {
  const song = catalogSong(id);
  if (!song) return;
  experience.rabbitStartId = song.id;
  experience.rabbitOffset = 0;
  writeExperience(); recordActivity(song, 'rabbit'); renderHub({ scrollRabbit: true });
  announce(`${song.title}에서 Rabbit Hole을 시작합니다.`);
}

function setRabbitDirection(direction, { focus = false } = {}) {
  if (!RABBIT_DIRECTIONS[direction]) return;
  experience.rabbitDirection = direction;
  experience.rabbitOffset = 0;
  writeExperience(); renderHub({ focusRabbitDirection: focus ? direction : null });
  announce(`Rabbit Hole 방향을 ${RABBIT_DIRECTIONS[direction].label}로 바꿨습니다.`);
}

function remixRabbit() { experience.rabbitOffset = (experience.rabbitOffset + 1) % 10000; writeExperience(); renderHub(); announce('같은 출발점에서 다른 5단계 경로를 만들었습니다.'); }

function handleHubClick(event) {
  const exploration = event.target.closest('[data-jp-exploration]');
  if (exploration) return setExploration(exploration.dataset.jpExploration, { focus: true });
  const direction = event.target.closest('[data-jp-rabbit-direction]');
  if (direction) return setRabbitDirection(direction.dataset.jpRabbitDirection, { focus: true });
  const open = event.target.closest('[data-jp-open]');
  if (open) return openSongInCatalog(catalogSong(open.dataset.jpOpen));
  const listen = event.target.closest('[data-jp-listen]');
  if (listen) return openListen(catalogSong(listen.dataset.jpListen));
  const start = event.target.closest('[data-jp-rabbit-start]');
  if (start) return startRabbit(start.dataset.jpRabbitStart);
  const dismiss = event.target.closest('[data-jp-dismiss]');
  if (dismiss) return dismissRecommendation(dismiss.dataset.jpDismiss);
  const recent = event.target.closest('[data-jp-recent]');
  if (recent) return openSongInCatalog(catalogSong(recent.dataset.jpRecent));
  if (event.target.closest('[data-jp-remix]')) return remixDaily();
  if (event.target.closest('[data-jp-rabbit-remix]')) return remixRabbit();
  if (event.target.closest('[data-jp-reset-hidden]')) resetHidden();
}

function captureBaseActivity(event) {
  const listen = event.target.closest?.('[data-listen-id]');
  const preview = event.target.closest?.('[data-preview-id]');
  if (listen) recordActivity(catalogSong(listen.dataset.listenId), 'listen');
  else if (preview) recordActivity(catalogSong(preview.dataset.previewId), 'preview');
  if (event.target.closest?.('[data-like-id], #featuredLike, #favoriteUndoButton, #backupMerge, #backupReplace, #undoImport')) scheduleRefresh();
}

async function loadCatalog() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  catalog = dedupeSongs(Array.isArray(payload?.songs) ? payload.songs : [...(payload?.latestSongs || []), ...(payload?.popularSongs || [])]);
}

function installHub() {
  if (document.querySelector('#personalized')) return;
  const hero = document.querySelector('.hero');
  if (!hero) return;
  hub = document.createElement('section');
  hub.id = 'personalized'; hub.className = 'jp-signature'; hub.setAttribute('aria-labelledby', 'jpHubTitle');
  hero.insertAdjacentElement('afterend', hub);
  hub.addEventListener('click', handleHubClick);
  hub.addEventListener('keydown', handleHubKeydown);
  renderHub();
}

function bindPlatformContinuation() { document.querySelector('#platformDialog')?.addEventListener('close', () => window.setTimeout(continuePendingListen, 0)); }
function bindExperienceEvents() { document.addEventListener('click', captureBaseActivity, true); window.addEventListener('focus', scheduleRefresh); }

async function boot() {
  decorateBaseUi(); addServiceCredit(); addHeroSignatureLink(); recordVisit(); bindPlatformContinuation(); bindExperienceEvents();
  const observer = new MutationObserver((mutations) => { if (mutations.some((mutation) => !mutation.target.closest?.('#personalized'))) decorateBaseUi(); });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  try { await loadCatalog(); installHub(); }
  catch (error) { console.warn('Signature taste experience unavailable:', error); }
}

boot();
