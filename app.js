const DATA_URL = './data/songs.json';
const STORAGE_KEY = 'jplaylist-likes-v1';

const state = {
  songs: [],
  visibleSongs: [],
  likes: new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')),
  activeGenre: '전체',
  favoritesOnly: false,
  featuredId: null,
};

const els = {
  updatedAt: document.querySelector('#updatedAt'),
  featuredCard: document.querySelector('#featuredCard'),
  featuredArtwork: document.querySelector('#featuredArtwork'),
  featuredRank: document.querySelector('#featuredRank'),
  featuredTitle: document.querySelector('#featuredTitle'),
  featuredArtist: document.querySelector('#featuredArtist'),
  featuredGenres: document.querySelector('#featuredGenres'),
  featuredListen: document.querySelector('#featuredListen'),
  featuredLike: document.querySelector('#featuredLike'),
  recommendAgain: document.querySelector('#recommendAgain'),
  genreFilters: document.querySelector('#genreFilters'),
  songGrid: document.querySelector('#songGrid'),
  emptyState: document.querySelector('#emptyState'),
  emptyTitle: document.querySelector('#emptyTitle'),
  emptyMessage: document.querySelector('#emptyMessage'),
  favoritesFilter: document.querySelector('#favoritesFilter'),
};

function saveLikes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.likes]));
}

function toggleLike(id) {
  if (state.likes.has(id)) state.likes.delete(id);
  else state.likes.add(id);
  saveLikes();
  render();
}

function normalizeGenre(value = '') {
  const genre = value.toLowerCase();
  if (genre.includes('rock')) return 'J-Rock';
  if (genre.includes('anime') || genre.includes('animation')) return 'Anime';
  if (genre.includes('electronic') || genre.includes('dance')) return 'Electronic';
  if (genre.includes('hip-hop') || genre.includes('rap')) return 'Hip-Hop';
  if (genre.includes('r&b') || genre.includes('soul')) return 'R&B';
  if (genre.includes('pop')) return 'J-Pop';
  return value || 'Music';
}

function getPrimaryGenre(song) {
  return normalizeGenre(song.genres?.[0] || 'Music');
}

function ageScore(releaseDate) {
  if (!releaseDate) return 0.4;
  const days = Math.max(0, (Date.now() - new Date(releaseDate).getTime()) / 86_400_000);
  if (days <= 7) return 1;
  if (days <= 30) return 0.9;
  if (days <= 90) return 0.72;
  if (days <= 180) return 0.55;
  return 0.35;
}

function recommendationScore(song) {
  const liked = state.songs.filter((item) => state.likes.has(item.id));
  const likedGenres = new Map();
  const likedArtists = new Set(liked.map((item) => item.artist));

  for (const item of liked) {
    for (const genre of item.genres || []) {
      const key = normalizeGenre(genre);
      likedGenres.set(key, (likedGenres.get(key) || 0) + 1);
    }
  }

  const genreAffinity = (song.genres || []).reduce((sum, genre) => sum + (likedGenres.get(normalizeGenre(genre)) || 0), 0);
  const artistAffinity = likedArtists.has(song.artist) ? 1 : 0;
  const popularity = 1 - Math.min((song.rank - 1) / 100, 1);
  const novelty = state.likes.has(song.id) ? -0.4 : 0.12;
  const jitter = Math.random() * 0.08;

  return ageScore(song.releaseDate) * 0.36 + popularity * 0.3 + Math.min(genreAffinity / 3, 1) * 0.2 + artistAffinity * 0.08 + novelty + jitter;
}

function pickRecommendation(excludeId = null) {
  const pool = state.songs.filter((song) => song.id !== excludeId);
  return [...pool].sort((a, b) => recommendationScore(b) - recommendationScore(a))[0] || state.songs[0];
}

function formatDate(dateString) {
  if (!dateString) return '발매일 미상';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function artwork(url, size = 600) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function setLikeButton(button, song) {
  const liked = state.likes.has(song.id);
  button.textContent = liked ? '♥' : '♡';
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
}

function renderFeatured() {
  const current = state.songs.find((song) => song.id === state.featuredId) || pickRecommendation();
  if (!current) return;
  state.featuredId = current.id;

  els.featuredCard.classList.remove('loading');
  els.featuredArtwork.src = artwork(current.artwork, 1000);
  els.featuredArtwork.alt = `${current.artist} - ${current.title} 앨범 아트`;
  els.featuredRank.textContent = `#${current.rank}`;
  els.featuredTitle.textContent = current.title;
  els.featuredArtist.textContent = current.artist;
  els.featuredGenres.innerHTML = (current.genres || []).slice(0, 3).map((genre) => `<span class="genre-chip">${escapeHtml(normalizeGenre(genre))}</span>`).join('');
  els.featuredListen.href = current.url;
  els.featuredListen.classList.toggle('disabled', !current.url);
  els.featuredListen.setAttribute('aria-disabled', String(!current.url));
  setLikeButton(els.featuredLike, current);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderFilters() {
  const genres = ['전체', ...new Set(state.songs.map(getPrimaryGenre).filter(Boolean))].slice(0, 7);
  els.genreFilters.innerHTML = genres.map((genre) => `
    <button class="filter-button ${state.activeGenre === genre ? 'active' : ''}" type="button" data-genre="${escapeHtml(genre)}" aria-pressed="${state.activeGenre === genre}">${escapeHtml(genre)}</button>
  `).join('');
}

function filteredSongs() {
  return state.songs.filter((song) => {
    const genreMatches = state.activeGenre === '전체' || getPrimaryGenre(song) === state.activeGenre;
    const favoriteMatches = !state.favoritesOnly || state.likes.has(song.id);
    return genreMatches && favoriteMatches;
  });
}

function renderGrid() {
  state.visibleSongs = filteredSongs();
  els.emptyState.classList.toggle('hidden', state.visibleSongs.length > 0);
  els.songGrid.innerHTML = state.visibleSongs.slice(0, 40).map((song) => {
    const liked = state.likes.has(song.id);
    return `
      <article class="song-card">
        <div class="song-artwork-wrap">
          <img class="song-artwork" src="${escapeHtml(artwork(song.artwork, 500))}" alt="${escapeHtml(`${song.artist} - ${song.title} 앨범 아트`)}" loading="lazy" />
          <span class="card-rank">#${song.rank}</span>
          <button class="card-like ${liked ? 'liked' : ''}" type="button" data-like-id="${escapeHtml(song.id)}" aria-label="${escapeHtml(song.title)} 좋아요" aria-pressed="${liked}">${liked ? '♥' : '♡'}</button>
        </div>
        <div class="song-info">
          <h3 class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h3>
          <p class="song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</p>
          <div class="song-meta">
            <span>${escapeHtml(getPrimaryGenre(song))} · ${escapeHtml(formatDate(song.releaseDate))}</span>
            <a href="${escapeHtml(song.url)}" target="_blank" rel="noreferrer" aria-label="Apple Music에서 ${escapeHtml(song.title)} 듣기">듣기 ↗</a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  if (!state.visibleSongs.length && state.favoritesOnly) {
    els.emptyTitle.textContent = '아직 좋아요한 곡이 없어요';
    els.emptyMessage.textContent = '마음에 드는 곡의 ♡를 누르면 이 브라우저에 취향이 저장되고 추천에 반영됩니다.';
  }
}

function render() {
  renderFilters();
  renderFeatured();
  renderGrid();
  els.favoritesFilter.classList.toggle('active', state.favoritesOnly);
  els.favoritesFilter.setAttribute('aria-pressed', String(state.favoritesOnly));
  els.favoritesFilter.textContent = state.favoritesOnly ? '♥ 좋아요만' : '♡ 좋아요';
}

function bindEvents() {
  els.featuredLike.addEventListener('click', () => state.featuredId && toggleLike(state.featuredId));
  els.recommendAgain.addEventListener('click', () => {
    const next = pickRecommendation(state.featuredId);
    if (next) {
      state.featuredId = next.id;
      renderFeatured();
    }
  });

  els.genreFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    state.activeGenre = button.dataset.genre;
    render();
  });

  els.songGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-like-id]');
    if (!button) return;
    toggleLike(button.dataset.likeId);
  });

  els.favoritesFilter.addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    render();
  });
}

async function init() {
  bindEvents();

  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.songs = Array.isArray(payload.songs) ? payload.songs : [];

    if (payload.updatedAt) {
      const updated = new Date(payload.updatedAt);
      els.updatedAt.textContent = `최근 수집 ${new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(updated)}`;
    } else {
      els.updatedAt.textContent = '아직 자동 수집 전입니다';
    }

    if (!state.songs.length) {
      els.featuredCard.classList.add('loading');
      els.emptyState.classList.remove('hidden');
      els.songGrid.innerHTML = '';
      return;
    }

    state.featuredId = pickRecommendation()?.id || state.songs[0].id;
    render();
  } catch (error) {
    console.error('Failed to load song data:', error);
    els.updatedAt.textContent = '데이터를 불러오지 못했습니다';
    els.emptyState.classList.remove('hidden');
    els.emptyTitle.textContent = '곡 데이터를 불러오지 못했어요';
    els.emptyMessage.textContent = '잠시 후 새로고침하거나 GitHub Actions 상태를 확인해 주세요.';
  }
}

init();
