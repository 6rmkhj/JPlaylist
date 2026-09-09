import { mkdir, readFile, writeFile } from 'node:fs/promises';

const FEED_URL = 'https://rss.applemarketingtools.com/api/v2/jp/music/most-played/100/songs.json';
const OUTPUT_PATH = new URL('../data/songs.json', import.meta.url);
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const JAPANESE_GENRES = ['j-pop', 'j-pop／j-ロック', 'j-rock', 'アニメ', 'anime', '歌謡曲', 'japanese'];

function isLikelyJapanese(track) {
  const text = `${track.artistName ?? ''} ${track.name ?? ''}`;
  const genres = (track.genres ?? []).map((genre) => String(genre.name ?? '').toLowerCase());
  return JAPANESE_TEXT.test(text) || genres.some((genre) => JAPANESE_GENRES.some((keyword) => genre.includes(keyword)));
}

function normalizeTrack(track, index) {
  return {
    id: String(track.id),
    title: track.name ?? 'Unknown title',
    artist: track.artistName ?? 'Unknown artist',
    artistId: track.artistId ? String(track.artistId) : null,
    artistUrl: track.artistUrl ?? null,
    releaseDate: track.releaseDate ?? null,
    artwork: track.artworkUrl100 ?? null,
    genres: (track.genres ?? []).map((genre) => genre.name).filter(Boolean),
    url: track.url ?? null,
    rank: index + 1,
    source: 'Apple Music Japan Top Songs',
  };
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    return { songs: [] };
  }
}

async function main() {
  const response = await fetch(FEED_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'JPlaylist/1.0 (+https://github.com/6rmkhj/JPlaylist)',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Apple RSS returned ${response.status}`);
  const data = await response.json();
  const results = data?.feed?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error('Apple RSS returned no songs');

  const normalized = results.map(normalizeTrack);
  const japanese = normalized.filter((song, index) => isLikelyJapanese(results[index]));
  const selected = (japanese.length >= 20 ? japanese : normalized).slice(0, 100);

  const payload = {
    updatedAt: new Date().toISOString(),
    source: FEED_URL,
    sourceLabel: 'Apple Music Japan Top Songs',
    filter: japanese.length >= 20 ? 'Japanese language/genre heuristic' : 'Japan storefront fallback',
    count: selected.length,
    songs: selected,
  };

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Saved ${selected.length} songs (${japanese.length} likely Japanese) to data/songs.json`);
}

main().catch(async (error) => {
  console.error(`Song collection failed: ${error.message}`);
  const existing = await readExisting();
  if (Array.isArray(existing.songs) && existing.songs.length > 0) {
    console.log(`Keeping existing ${existing.songs.length} songs so the site can still deploy.`);
    return;
  }
  console.log('No existing songs found. Deploying the empty-state site instead.');
});
