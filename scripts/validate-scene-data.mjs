import { readFile } from 'node:fs/promises';

const TARGETS = [
  { id: 'kpop', label: 'K-POP', path: new URL('../data/songs-kpop.json', import.meta.url) },
  { id: 'pop', label: 'POP', path: new URL('../data/songs-pop.json', import.meta.url) },
];

function fail(label, message) {
  console.error(`${label} data validation failed: ${message}`);
  process.exitCode = 1;
}

function releaseAgeDays(releaseDate, now = new Date()) {
  if (!releaseDate) return Number.POSITIVE_INFINITY;
  const date = new Date(`${String(releaseDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

for (const target of TARGETS) {
  let payload;
  try {
    payload = JSON.parse(await readFile(target.path, 'utf8'));
  } catch (error) {
    fail(target.label, `cannot read payload (${error.message})`);
    continue;
  }

  const latest = Array.isArray(payload.latestSongs) ? payload.latestSongs : [];
  const popular = Array.isArray(payload.popularSongs) ? payload.popularSongs : [];
  const songs = Array.isArray(payload.songs) ? payload.songs : [];
  if (payload.schemaVersion !== 3) fail(target.label, 'schemaVersion must be 3');
  if (payload.scene?.id !== target.id) fail(target.label, `scene.id must be ${target.id}`);
  if (!['fresh', 'degraded', 'stale'].includes(payload.status)) fail(target.label, 'invalid status');
  if (popular.length < (payload.status === 'stale' ? 8 : 20)) fail(target.label, `popularSongs too small (${popular.length})`);
  if (latest.length < (payload.status === 'stale' ? 3 : 8)) fail(target.label, `latestSongs too small (${latest.length})`);
  if (songs.length < Math.max(latest.length, popular.length)) fail(target.label, 'songs union is smaller than source sections');

  for (const [section, values] of [['latest', latest], ['popular', popular], ['songs', songs]]) {
    const ids = new Set();
    for (const song of values) {
      if (!song?.id || !song?.title || !song?.artist) {
        fail(target.label, `${section} contains an invalid song`);
        break;
      }
      if (ids.has(String(song.id))) {
        fail(target.label, `${section} contains duplicate id ${song.id}`);
        break;
      }
      ids.add(String(song.id));
      if (song.isrc && !/^[A-Z0-9]{12}$/.test(song.isrc)) fail(target.label, `${section} contains malformed ISRC ${song.isrc}`);
    }
  }

  if (payload.status !== 'stale') {
    const windowDays = Number(payload.latestWindowDays || 0);
    if (!windowDays) fail(target.label, 'fresh/degraded payload needs latestWindowDays');
    const outside = latest.filter((song) => releaseAgeDays(song.releaseDate) > windowDays + 1);
    if (outside.length) fail(target.label, `${outside.length} latest songs are outside ${windowDays}-day window`);
    const keyword = payload.coverage?.keywordSearch;
    if (!Number.isFinite(Number(keyword?.total)) || Number(keyword.total) < 1) fail(target.label, 'keyword coverage is missing');
    if (!payload.sources?.discovery?.components?.length) fail(target.label, 'discovery source components are missing');
  }

  console.log(`${target.label} data OK: ${latest.length} recent, ${popular.length} popular, status=${payload.status}.`);
}

if (process.exitCode) process.exit(process.exitCode);
