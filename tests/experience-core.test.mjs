import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyThree,
  buildRabbitHole,
  buildTasteProfile,
  tasteNarrative,
} from '../experience-core.mjs';

const now = new Date('2026-09-10T12:00:00Z');
const song = (id, artist, genre, daysAgo, rank = null) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    id: String(id),
    title: `Song ${id}`,
    artist,
    releaseDate: date.toISOString().slice(0, 10),
    genres: [genre],
    chartRank: rank,
    collectionId: `release-${id}`,
    platformLinks: {},
  };
};

const catalog = [
  song(1, 'Favorite Artist', 'J-Rock', 20, 5),
  song(2, 'Rock Neighbor', 'J-Rock', 3, 12),
  song(3, 'Rock Deep', 'J-Rock', 40, null),
  song(4, 'Pop Chart', 'J-Pop', 2, 2),
  song(5, 'Alt Deep', 'Alternative', 75, null),
  song(6, 'Anime Fresh', 'Anime', 1, 30),
  song(7, 'Electronic New', 'Electronic', 5, null),
  song(8, 'Rock Other', 'J-Rock', 12, 45),
  song(9, 'Vocaloid Edge', 'Vocaloid', 7, null),
  song(10, 'R&B Side', 'R&B', 25, 70),
  song(11, 'Pop Hidden', 'J-Pop', 4, 18),
  song(12, 'Alt Other', 'Alternative', 120, 80),
];

const favorites = [{ ...catalog[0], likedAt: '2026-09-09T00:00:00Z' }];
const activity = [
  { id: '2', kind: 'listen', at: '2026-09-10T01:00:00Z' },
  { id: '5', kind: 'open', at: '2026-09-10T02:00:00Z' },
  { id: '7', kind: 'preview', at: '2026-09-10T03:00:00Z' },
];

test('taste map converts favorites and exploration history into stable product signals', () => {
  const first = buildTasteProfile({ favorites, activity, catalog, now });
  const second = buildTasteProfile({ favorites, activity, catalog, now });
  assert.equal(first.mapX, second.mapX);
  assert.equal(first.mapY, second.mapY);
  assert.ok(first.mapX >= 0 && first.mapX <= 100);
  assert.ok(first.mapY >= 0 && first.mapY <= 100);
  assert.equal(first.topGenres[0][0], 'J-Rock');
  assert.match(tasteNarrative(first), /차트 밖 성향/);
});

test('daily three assigns distinct roles and excludes liked or hidden songs', () => {
  const profile = buildTasteProfile({ favorites, activity, catalog, now });
  const picks = buildDailyThree({ catalog, profile, hiddenIds: ['11'], dayKey: '2026-09-10', now });
  assert.deepEqual(picks.map((pick) => pick.key), ['safe', 'step', 'deep']);
  assert.equal(new Set(picks.map((pick) => pick.song.id)).size, 3);
  assert.ok(!picks.some((pick) => pick.song.id === '1'));
  assert.ok(!picks.some((pick) => pick.song.id === '11'));
  assert.ok(picks.every((pick) => pick.reason.length > 8));
});

test('daily three is deterministic for the same day and offset', () => {
  const profile = buildTasteProfile({ favorites, activity, catalog, now });
  const a = buildDailyThree({ catalog, profile, dayKey: '2026-09-10', offset: 4, now });
  const b = buildDailyThree({ catalog, profile, dayKey: '2026-09-10', offset: 4, now });
  assert.deepEqual(a.map((pick) => pick.song.id), b.map((pick) => pick.song.id));
});

test('rabbit hole builds a five-step unique path and respects hidden/favorite exclusions after the start', () => {
  const profile = buildTasteProfile({ favorites, activity, catalog, now });
  const path = buildRabbitHole({
    start: catalog[1],
    catalog,
    profile,
    hiddenIds: ['11'],
    direction: 'deeper',
    dayKey: '2026-09-10',
    now,
  });
  assert.equal(path.length, 5);
  assert.equal(path[0].song.id, '2');
  assert.equal(new Set(path.map((step) => step.song.id)).size, 5);
  assert.ok(!path.slice(1).some((step) => step.song.id === '1' || step.song.id === '11'));
  assert.ok(path.slice(1).every((step) => step.reason.length > 8));
});
