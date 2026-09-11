(() => {
  const SCENES = {
    jpop: {
      id: 'jpop', label: 'J-POP', dataUrl: './data/songs.json', country: 'JP', chartBadge: 'Apple JP',
      eyebrow: 'J-MUSIC TASTE COMPASS', heroSubject: '일본 음악', titleNoun: '일본 음악', fallbackGenre: '일본 음악',
      heroDescription: '좋아요와 실제 탐색 기록으로 취향의 위치를 보여주고, 매일 세 곡과 5단계 Rabbit Hole로 평소 검색하지 않았을 음악까지 이어갑니다.',
      catalogTitle: '전체 일본 음악 탐색',
      latestDescription: '최근 발매된 일본 음악을 다양한 아티스트 순으로 보여드려요.',
      popularDescription: 'Apple Music Japan 전체 인기 차트에서 일본 음악으로 분류한 곡을 보여드려요.',
      latestSource: '최근 발매: 공개 발매일 인덱스 + 일본 카탈로그 검색 + 인기 차트 보완',
      popularSource: '순위: Apple Music Japan 전체 차트 기준',
      bootstrapFlow: '일본 차트 흐름',
    },
    kpop: {
      id: 'kpop', label: 'K-POP', dataUrl: './data/songs-kpop.json', country: 'KR', chartBadge: 'Apple KR',
      eyebrow: 'K-POP TASTE COMPASS', heroSubject: 'K-POP', titleNoun: 'K-POP', fallbackGenre: 'K-POP',
      heroDescription: '좋아요와 실제 탐색 기록으로 K-POP 취향의 위치를 보여주고, 매일 세 곡과 5단계 Rabbit Hole로 익숙한 팀 밖의 다음 취향까지 이어갑니다.',
      catalogTitle: '전체 K-POP 탐색',
      latestDescription: '최근 발매된 K-POP을 다양한 아티스트 순으로 보여드려요.',
      popularDescription: 'Apple Music Korea 인기 차트에서 K-POP 흐름을 골라 보여드려요.',
      latestSource: '최근 발매: 한국 스토어 카탈로그 검색 + Korea 인기 차트 보완',
      popularSource: '순위: Apple Music Korea 전체 차트 기준',
      bootstrapFlow: '한국 차트 흐름',
    },
    pop: {
      id: 'pop', label: 'POP', dataUrl: './data/songs-pop.json', country: 'US', chartBadge: 'Apple US',
      eyebrow: 'POP TASTE COMPASS', heroSubject: '팝', titleNoun: '팝 음악', fallbackGenre: 'Pop',
      heroDescription: '좋아요와 실제 탐색 기록으로 팝 취향의 위치를 보여주고, 매일 세 곡과 5단계 Rabbit Hole로 평소 듣던 아티스트 밖의 다음 곡까지 이어갑니다.',
      catalogTitle: '전체 팝 음악 탐색',
      latestDescription: '최근 발매된 팝 음악을 다양한 아티스트 순으로 보여드려요.',
      popularDescription: 'Apple Music US 인기 차트에서 K-POP·J-POP을 제외한 글로벌 팝 흐름을 보여드려요.',
      latestSource: '최근 발매: US 스토어 카탈로그 검색 + US 인기 차트 보완',
      popularSource: '순위: Apple Music US 전체 차트 기준',
      bootstrapFlow: '글로벌 팝 차트 흐름',
    },
  };

  function resolveScene() {
    try {
      const requested = String(new URLSearchParams(window.location.search).get('scene') || 'jpop').toLowerCase();
      return SCENES[requested] || SCENES.jpop;
    } catch {
      return SCENES.jpop;
    }
  }

  const scene = resolveScene();
  window.__JPLAYLIST_SCENE__ = scene;
  document.documentElement.dataset.musicScene = scene.id;

  const SCENE_SCOPED_KEYS = new Set([
    'jplaylist-favorites-v2',
    'jplaylist-likes-v1',
    'jplaylist-data-cache-v2',
    'jplaylist-experience-v1',
  ]);

  function scopedStorageKey(key) {
    const value = String(key);
    if (scene.id === 'jpop' || !SCENE_SCOPED_KEYS.has(value)) return value;
    return `${value}-${scene.id}`;
  }

  try {
    const storageProto = window.Storage?.prototype;
    if (storageProto && !storageProto.__jplaylistSceneScoped) {
      const nativeGetItem = storageProto.getItem;
      const nativeSetItem = storageProto.setItem;
      const nativeRemoveItem = storageProto.removeItem;
      storageProto.getItem = function getItem(key) { return nativeGetItem.call(this, scopedStorageKey(key)); };
      storageProto.setItem = function setItem(key, value) { return nativeSetItem.call(this, scopedStorageKey(key), value); };
      storageProto.removeItem = function removeItem(key) { return nativeRemoveItem.call(this, scopedStorageKey(key)); };
      Object.defineProperty(storageProto, '__jplaylistSceneScoped', { value: true, configurable: false });
    }
  } catch {
    // Persistence is optional; the app already degrades gracefully when storage is unavailable.
  }

  function adaptKpopPayloadForLegacyCatalog(payload) {
    if (scene.id !== 'kpop' || !payload || typeof payload !== 'object') return payload;
    const adaptSong = (song) => {
      if (!song || typeof song !== 'object') return song;
      const genres = Array.isArray(song.genres)
        ? song.genres.map((genre) => /^k[- ]?pop$/i.test(String(genre).trim()) ? 'Korean Pop' : genre)
        : song.genres;
      return { ...song, genres };
    };
    return {
      ...payload,
      latestSongs: Array.isArray(payload.latestSongs) ? payload.latestSongs.map(adaptSong) : payload.latestSongs,
      popularSongs: Array.isArray(payload.popularSongs) ? payload.popularSongs.map(adaptSong) : payload.popularSongs,
      songs: Array.isArray(payload.songs) ? payload.songs.map(adaptSong) : payload.songs,
    };
  }

  try {
    const defaultDataUrl = new URL('./data/songs.json', window.location.href).href;
    const sceneDataUrl = new URL(scene.dataUrl, window.location.href).href;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      let candidate = null;
      if (typeof input === 'string') candidate = input;
      else if (input instanceof URL) candidate = input.href;
      else if (input instanceof Request) candidate = input.url;
      try {
        if (candidate && new URL(candidate, window.location.href).href === defaultDataUrl && sceneDataUrl !== defaultDataUrl) {
          const routed = nativeFetch(sceneDataUrl, init);
          if (scene.id === 'kpop' && init?.signal) {
            return routed.then(async (response) => {
              if (!response.ok) return response;
              const payload = adaptKpopPayloadForLegacyCatalog(await response.clone().json());
              return new Response(JSON.stringify(payload), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            });
          }
          return routed;
        }
      } catch {
        // Fall through to the original request.
      }
      return nativeFetch(input, init);
    };
  } catch {
    // Network routing is best-effort; J-POP remains the safe default.
  }

  function withSceneInUrl(value) {
    if (!value || scene.id === 'jpop') return value;
    try {
      const url = new URL(String(value), window.location.href);
      url.searchParams.set('scene', scene.id);
      return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
    } catch {
      return value;
    }
  }

  try {
    const nativePushState = window.history.pushState.bind(window.history);
    const nativeReplaceState = window.history.replaceState.bind(window.history);
    window.history.pushState = (state, title, url) => nativePushState(state, title, withSceneInUrl(url));
    window.history.replaceState = (state, title, url) => nativeReplaceState(state, title, withSceneInUrl(url));
  } catch {
    // History enhancement is optional.
  }

  function sceneHref(targetId) {
    const url = new URL(window.location.href);
    url.search = '';
    if (targetId !== 'jpop') url.searchParams.set('scene', targetId);
    url.hash = 'personalized';
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function installSceneStyles() {
    if (document.querySelector('#sceneStyles')) return;
    const link = document.createElement('link');
    link.id = 'sceneStyles';
    link.rel = 'stylesheet';
    link.href = './scene.css';
    document.head.append(link);
  }

  function installSceneSwitch() {
    const header = document.querySelector('.site-header');
    if (!header || header.querySelector('.scene-switch')) return;
    header.classList.add('scene-header');
    const nav = document.createElement('nav');
    nav.className = 'scene-switch';
    nav.setAttribute('aria-label', '음악 카테고리');
    nav.innerHTML = Object.values(SCENES).map((option) => `
      <a class="scene-option" data-scene-switch="${option.id}" href="${sceneHref(option.id)}"${option.id === scene.id ? ' aria-current="page"' : ''}>${option.label}</a>`).join('');
    header.querySelector('.brand')?.insertAdjacentElement('afterend', nav);
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function setHtml(node, value) {
    if (node && node.innerHTML.replace(/\s+/g, '') !== value.replace(/\s+/g, '')) node.innerHTML = value;
  }

  function replaceText(node, from, to) {
    if (!node || !node.textContent?.includes(from)) return;
    const next = node.textContent.replaceAll(from, to);
    if (next !== node.textContent) node.textContent = next;
  }

  function replaceDirectText(node, from, to) {
    if (!node) return;
    for (const child of node.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.includes(from)) continue;
      const next = child.textContent.replaceAll(from, to);
      if (next !== child.textContent) child.textContent = next;
    }
  }

  function sceneTitleFrom(current) {
    if (scene.id === 'jpop') return current;
    return String(current)
      .replaceAll('일본 음악', scene.titleNoun)
      .replace('내 일본 음악 취향의 다음 좌표', `내 ${scene.heroSubject} 취향의 다음 좌표`);
  }

  function applySceneCopy() {
    setText(document.querySelector('.hero .eyebrow'), scene.eyebrow);
    setHtml(document.querySelector('#heroTitle'), `내 ${scene.heroSubject} 취향을,<br><span>다음 취향으로.</span>`);
    setText(document.querySelector('.hero-description'), scene.heroDescription);
    setText(document.querySelector('#discoverTitle'), scene.catalogTitle);

    const popularActive = document.querySelector('[data-mode="popular"]')?.classList.contains('active');
    setText(document.querySelector('#modeDescription'), popularActive ? scene.popularDescription : scene.latestDescription);
    setText(document.querySelector('#sourceNote'), popularActive ? scene.popularSource : scene.latestSource);
    setText(document.querySelector('#localViewNotice'), `${scene.label} 좋아요는 이 브라우저에 저장된 개인 컬렉션이며 다른 카테고리나 공유 링크에는 섞이지 않습니다.`);
    setText(document.querySelector('#backupDialogTitle'), `${scene.label} 취향 백업`);
    setText(document.querySelector('#backupDialog .dialog-copy'), `현재 ${scene.label}에서 좋아요한 곡과 기본 듣기 플랫폼을 파일로 저장하거나 다른 브라우저에서 가져올 수 있어요. 카테고리별 좋아요는 서로 분리되며, 가져오기 전 변경 내용을 먼저 보여드립니다.`);
    setText(document.querySelector('.jp-signature-kicker'), `YOUR ${scene.label} COMPASS`);

    const signatureIntro = document.querySelector('.jp-signature-head > div > p:last-child');
    if (signatureIntro && scene.id !== 'jpop') replaceText(signatureIntro, '일본 차트 흐름', scene.bootstrapFlow);

    document.querySelectorAll('#featuredRank, .card-rank, .jp-daily-meta').forEach((node) => {
      const current = node.textContent || '';
      if (/^Apple (JP|KR|US) #/.test(current)) setText(node, current.replace(/^Apple (JP|KR|US) #/, `${scene.chartBadge} #`));
      if (scene.id !== 'jpop' && current === '일본 음악') setText(node, scene.fallbackGenre);
    });

    if (scene.id !== 'jpop') {
      document.querySelectorAll('.filter-chip, .jp-taste-tag, .song-context > span:first-child').forEach((node) => replaceText(node, 'J-Rock', 'Rock'));
      replaceText(document.querySelector('#featuredReason'), '일본 음악', scene.titleNoun);
      replaceText(document.querySelector('#emptyMessage'), '일본 음악', scene.titleNoun);
    }
    if (scene.id === 'kpop') {
      document.querySelectorAll('.genre-chip, .jp-taste-tag, .song-context > span:first-child').forEach((node) => replaceText(node, 'Korean Pop', 'K-Pop'));
      document.querySelectorAll('.filter-button').forEach((node) => replaceDirectText(node, 'Korean Pop', 'K-Pop'));
    }

    const footer = document.querySelector('footer p');
    if (footer?.firstChild?.nodeType === Node.TEXT_NODE) {
      const copy = 'JPlaylist · J-POP, K-POP, POP 공개 카탈로그와 지역별 인기 차트를 바탕으로 취향을 탐색하며, 듣기 플랫폼은 사용자가 선택합니다.';
      if (footer.firstChild.textContent !== copy) footer.firstChild.textContent = copy;
    }

    const nextTitle = sceneTitleFrom(document.title);
    if (document.title !== nextTitle) document.title = nextTitle;
    if (scene.id !== 'jpop') {
      document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').forEach((meta) => {
        const current = meta.getAttribute('content') || '';
        const next = current
          .replaceAll('일본 음악', scene.titleNoun)
          .replaceAll('일본', scene.label)
          .replace('내 K-POP 음악 취향', '내 K-POP 취향')
          .replace('내 POP 음악 취향', '내 팝 취향');
        if (current !== next) meta.setAttribute('content', next);
      });
    }
  }

  installSceneStyles();
  installSceneSwitch();
  applySceneCopy();

  let sceneCopyFrame = 0;
  let copyObserver = null;
  const observerOptions = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'content'] };
  const scheduleSceneCopy = () => {
    if (sceneCopyFrame) return;
    sceneCopyFrame = window.requestAnimationFrame(() => {
      sceneCopyFrame = 0;
      copyObserver?.disconnect();
      applySceneCopy();
      copyObserver?.observe(document.documentElement, observerOptions);
    });
  };
  copyObserver = new MutationObserver(scheduleSceneCopy);
  copyObserver.observe(document.documentElement, observerOptions);

  const READY_EVENT = 'jplaylist:ready';
  const LEGACY_KEY = 'jplaylist-likes-v1';
  const FAVORITES_KEY = 'jplaylist-favorites-v2';
  const RELOAD_GUARD = 'jplaylist-legacy-recovery-reloaded';
  const STARTUP_TIMEOUT_MS = 8_000;

  const failure = document.querySelector('#appFailure');
  const reload = document.querySelector('#appFailureReload');
  reload?.addEventListener('click', () => window.location.reload());

  const startupTimer = window.setTimeout(() => {
    if (window.__JPLAYLIST_READY__) return;
    failure?.classList.remove('hidden');
  }, STARTUP_TIMEOUT_MS);

  function markReady() {
    window.clearTimeout(startupTimer);
    failure?.classList.add('hidden');
    scheduleSceneCopy();
  }

  if (window.__JPLAYLIST_READY__) markReady();
  else window.addEventListener(READY_EVENT, markReady, { once: true });

  function storage() {
    try { return window.localStorage; } catch { return null; }
  }

  function readLegacyIds(store) {
    try {
      const parsed = JSON.parse(store.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(parsed) ? [...new Set(parsed.map(String).filter(Boolean))] : [];
    } catch {
      return [];
    }
  }

  function readFavoritePayload(store) {
    try {
      const parsed = JSON.parse(store.getItem(FAVORITES_KEY) || 'null');
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      return Array.isArray(items) ? items.filter((item) => item && item.id !== undefined) : [];
    } catch {
      return [];
    }
  }

  function snapshotTrack(track) {
    return {
      id: String(track.trackId),
      title: String(track.trackName || 'Unknown title').trim(),
      artist: String(track.artistName || 'Unknown artist').trim(),
      artistId: track.artistId ? String(track.artistId) : null,
      releaseDate: track.releaseDate ? String(track.releaseDate).slice(0, 10) : null,
      artwork: track.artworkUrl100 || null,
      genres: [track.primaryGenreName].filter(Boolean),
      appleUrl: track.trackViewUrl || null,
      previewUrl: track.previewUrl || null,
      chartRank: null,
      collectionId: track.collectionId ? String(track.collectionId) : null,
      collectionName: track.collectionName || null,
      trackNumber: Number.isFinite(Number(track.trackNumber)) ? Number(track.trackNumber) : null,
      trackCount: Number.isFinite(Number(track.trackCount)) ? Number(track.trackCount) : null,
      discNumber: Number.isFinite(Number(track.discNumber)) ? Number(track.discNumber) : null,
      discCount: Number.isFinite(Number(track.discCount)) ? Number(track.discCount) : null,
      recordingId: null,
      isrc: null,
      searchAliases: [],
      platformLinks: track.trackViewUrl ? { apple: track.trackViewUrl } : {},
      sourceKinds: ['itunes-legacy-lookup'],
      likedAt: null,
    };
  }

  async function lookupBatch(ids) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const url = new URL('https://itunes.apple.com/lookup');
      url.searchParams.set('id', ids.join(','));
      url.searchParams.set('country', scene.country);
      url.searchParams.set('entity', 'song');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data?.results)
        ? data.results.filter((item) => item?.wrapperType === 'track' && item.trackId)
        : [];
    } catch {
      return [];
    } finally {
      window.clearTimeout(timer);
    }
  }

  function appendLegacyNotice(unresolvedCount) {
    if (!unresolvedCount) return;
    const notice = document.querySelector('#persistenceNotice');
    if (!notice) return;
    const message = `예전 버전 좋아요 ${unresolvedCount}곡의 정보를 현재 공개 카탈로그에서 아직 복구하지 못했습니다. ID는 보존되어 다음 방문에도 다시 복구를 시도합니다.`;
    if (!notice.textContent?.includes(message)) notice.textContent = notice.textContent ? `${notice.textContent} ${message}` : message;
    notice.classList.remove('hidden');
  }

  async function recoverLegacyFavorites() {
    const store = storage();
    if (!store) return;
    const legacyIds = readLegacyIds(store);
    if (!legacyIds.length) return;

    const favorites = readFavoritePayload(store);
    const known = new Set(favorites.map((item) => String(item.id)));
    const missing = legacyIds.filter((id) => !known.has(id));
    if (!missing.length) {
      store.removeItem(LEGACY_KEY);
      return;
    }

    const recovered = [];
    for (let index = 0; index < missing.length; index += 40) {
      const tracks = await lookupBatch(missing.slice(index, index + 40));
      recovered.push(...tracks.map(snapshotTrack));
    }

    const recoveredIds = new Set(recovered.map((item) => item.id));
    if (recovered.length) {
      const merged = new Map(favorites.map((item) => [String(item.id), item]));
      for (const item of recovered) merged.set(item.id, item);
      store.setItem(FAVORITES_KEY, JSON.stringify({ version: 3, items: [...merged.values()] }));
      const unresolved = legacyIds.filter((id) => !recoveredIds.has(id) && !known.has(id));
      if (unresolved.length) store.setItem(LEGACY_KEY, JSON.stringify(unresolved));
      else store.removeItem(LEGACY_KEY);

      try {
        if (!sessionStorage.getItem(RELOAD_GUARD)) {
          sessionStorage.setItem(RELOAD_GUARD, '1');
          window.location.reload();
          return;
        }
      } catch {
        // Reload is an enhancement; recovered data is already persisted.
      }
      appendLegacyNotice(unresolved.length);
      return;
    }

    appendLegacyNotice(missing.length);
  }

  function restoreDeepLinkAfterSignatureLayout() {
    if (window.location.hash !== '#discovery') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.querySelector('#discovery')?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    });
  }

  function bindSignatureVisibility() {
    const signature = document.querySelector('#personalized');
    if (!signature) return false;
    const observer = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle('jp-signature-active', Boolean(entry?.isIntersecting));
    }, { root: null, rootMargin: '-4% 0px -4% 0px', threshold: 0 });
    observer.observe(signature);
    restoreDeepLinkAfterSignatureLayout();
    return true;
  }

  if (!bindSignatureVisibility()) {
    const signatureObserver = new MutationObserver(() => {
      if (!bindSignatureVisibility()) return;
      signatureObserver.disconnect();
    });
    signatureObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  const scheduleRecovery = () => window.setTimeout(recoverLegacyFavorites, 350);
  if (window.__JPLAYLIST_READY__) scheduleRecovery();
  else window.addEventListener(READY_EVENT, scheduleRecovery, { once: true });
})();
