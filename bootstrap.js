(() => {
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
      url.searchParams.set('country', 'JP');
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
    notice.textContent = notice.textContent ? `${notice.textContent} ${message}` : message;
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

  function bindSignatureVisibility() {
    const signature = document.querySelector('#personalized');
    if (!signature) return false;
    const observer = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle('jp-signature-active', Boolean(entry?.isIntersecting));
    }, { root: null, rootMargin: '-4% 0px -4% 0px', threshold: 0 });
    observer.observe(signature);
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
