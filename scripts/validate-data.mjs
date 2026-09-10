import { readFile } from 'node:fs/promises';
import { normalizeGenre, releaseAgeDays } from '../core.mjs';

const DATA_PATH = new URL('../data/songs.json', import.meta.url);
const payload = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const latest = Array.isArray(payload.latestSongs) ? payload.latestSongs : [];
const popular = Array.isArray(payload.popularSongs) ? payload.popularSongs : [];

function fail(message) {
  console.error(`Data validation failed: ${message}`);
  process.exit(1);
}

if (payload.schemaVersion !== 2) fail('schemaVersion must be 2');
if (!['fresh', 'stale'].includes(payload.status)) fail('status must be fresh or stale');
if (popular.length < 20) fail(`popularSongs too small (${popular.length})`);
if (latest.length < 1) fail('latestSongs is empty');

for (const [section, songs] of [['latest', latest], ['popular', popular]]) {
  const ids = new Set();
  for (const song of songs) {
    if (!song?.id || !song?.title || !song?.artist) fail(`${section} contains an invalid song`);
    if (ids.has(song.id)) fail(`${section} contains duplicate id ${song.id}`);
    ids.add(song.id);
    if ((song.genres || []).some((genre) => normalizeGenre(genre) === 'K-Pop')) {
      fail(`${section} contains K-Pop track ${song.artist} - ${song.title}`);
    }
  }
}

if (payload.status === 'fresh') {
  const windowDays = Number(payload.latestWindowDays || 0);
  if (!windowDays) fail('fresh payload needs latestWindowDays');
  const outside = latest.filter((song) => releaseAgeDays(song.releaseDate) > windowDays + 1);
  if (outside.length) fail(`${outside.length} latest songs are outside the declared ${windowDays}-day window`);
}

console.log(`Data OK: ${latest.length} recent, ${popular.length} popular, status=${payload.status}.`);
