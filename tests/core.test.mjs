import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSearchQuery,
  diversifyByArtist,
  diversifyRecent,
  GENRE_ORDER,
  getGenreTags,
  hasShareableDiscoveryState,
  isLikelyJapaneseTrack,
  languageForText,
  normalizeGenre,
  normalizeSearchText,
  parseFavorites,
  parseViewParams,
  searchScore,
  serializeFavorites,
  serializeViewParams,
  snapshotSong,
  sortSearchResults,
} from '../core.mjs';

test('genre taxonomy keeps K-Pop separate from J-Pop', () => {
  assert.equal(normalizeGenre('K-Pop'), 'K-Pop');
  assert.equal(normalizeGenre('J-Pop'), 'J-Pop');
  assert.equal(normalizeGenre('ポップ'), 'Pop');
});

test('Japanese genre aliases and secondary genres are normalized', () => {
  assert.equal(normalizeGenre('ロック'), 'J-Rock');
  assert.equal(normalizeGenre('ヒップホップ／ラップ'), 'Hip-Hop');
  assert.deepEqual(getGenreTags({ genres: ['オルタナティブ', 'ミュージック', 'ロック'] }), ['Alternative', 'J-Rock']);
  assert.ok(GENRE_ORDER.indexOf('J-Pop') < GENRE_ORDER.indexOf('Electronic'));
});

test('known K-Pop false positive is rejected', () => {
  const golden = {
    artistName: 'HUNTR/X, EJAE, オードリー・ヌナ, REI AMI & KPop Demon Hunters Cast',
    name: 'Golden',
    genres: [{ name: 'K-Pop' }],
  };
  assert.equal(isLikelyJapaneseTrack(golden), false);
});

test('Japanese J-Pop tracks remain accepted', () => {
  assert.equal(isLikelyJapaneseTrack({ artistName: '米津玄師', name: 'IRIS OUT', genres: [{ name: 'J-Pop' }] }), true);
  assert.equal(isLikelyJapaneseTrack({ artistName: 'ヨルシカ', name: '晴る', genres: [{ name: 'ロック' }] }), true);
});

test('search normalization trims whitespace-only and Unicode variants', () => {
  assert.equal(normalizeSearchText('  ＩＲＩＳ   OUT  '), 'iris out');
  assert.equal(cleanSearchQuery('　   \n'), '');
});

test('corrupt favorite storage fails safely', () => {
  assert.equal(parseFavorites('{broken-json').size, 0);
  assert.equal(parseFavorites('null').size, 0);
});

test('favorite snapshots round-trip full metadata and likedAt', () => {
  const map = new Map();
  map.set('1', snapshotSong({
    id: 1,
    title: '晴る',
    artist: 'ヨルシカ',
    genres: ['ロック'],
    rank: 4,
    likedAt: '2026-09-10T05:00:00.000Z',
    collectionId: 99,
    collectionName: '晴る - Single',
    trackNumber: 1,
    trackCount: 1,
    recordingId: 'mbid-1',
    isrc: 'JP-ABC-26-00001',
    platformLinks: { spotify: 'https://open.spotify.com/track/example' },
  }));
  const restored = parseFavorites(serializeFavorites(map));
  assert.equal(restored.get('1').title, '晴る');
  assert.equal(restored.get('1').chartRank, 4);
  assert.equal(restored.get('1').likedAt, '2026-09-10T05:00:00.000Z');
  assert.equal(restored.get('1').collectionName, '晴る - Single');
  assert.equal(restored.get('1').isrc, 'JPABC2600001');
  assert.equal(restored.get('1').platformLinks.spotify, 'https://open.spotify.com/track/example');
});

test('language detection marks Japanese music text without changing Korean UI', () => {
  assert.equal(languageForText('荒谷翔大'), 'ja');
  assert.equal(languageForText('情熱'), 'ja');
  assert.equal(languageForText('좋아요'), 'ko');
  assert.equal(languageForText('IRIS OUT'), 'en');
});

test('artist diversification prevents one artist from occupying the first page', () => {
  const songs = [
    { id: 'a1', artist: 'A' }, { id: 'a2', artist: 'A' }, { id: 'a3', artist: 'A' },
    { id: 'b1', artist: 'B' }, { id: 'c1', artist: 'C' }, { id: 'd1', artist: 'D' },
  ];
  const result = diversifyByArtist(songs);
  assert.deepEqual(result.slice(0, 4).map((song) => song.artist), ['A', 'B', 'C', 'D']);
  assert.equal(result.length, songs.length);
});

test('recent diversification preserves recency buckets before artist diversity', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const songs = [
    { id: 'a1', artist: 'A', collectionId: 'r1', releaseDate: '2026-09-10' },
    { id: 'a2', artist: 'A', collectionId: 'r1', releaseDate: '2026-09-10' },
    { id: 'b1', artist: 'B', collectionId: 'r2', releaseDate: '2026-09-09' },
    { id: 'c1', artist: 'C', collectionId: 'r3', releaseDate: '2026-08-25' },
    { id: 'old', artist: 'D', collectionId: 'r4', releaseDate: '2026-04-01' },
  ];
  const result = diversifyRecent(songs, now);
  assert.deepEqual(result.slice(0, 3).map((song) => song.id), ['a1', 'b1', 'a2']);
  assert.equal(result.at(-1).id, 'old');
});

test('search supports Korean/romanized aliases and relevance ordering', () => {
  const y = snapshotSong({ id: '1', title: 'IRIS OUT', artist: '米津玄師' });
  const other = snapshotSong({ id: '2', title: 'Kenshi', artist: 'Other' });
  assert.ok(searchScore(y, '요네즈 켄시') > 0);
  assert.ok(searchScore(y, 'Kenshi Yonezu') > 0);
  assert.deepEqual(sortSearchResults([other, y], 'IRIS OUT').map((song) => song.id), ['1']);
});

test('URL state trims query, includes release/sort, and keeps favorites local-only', () => {
  const search = serializeViewParams({
    activeMode: 'popular',
    query: '  IRIS OUT  ',
    activeGenre: 'J-Rock',
    artistFilter: '米津玄師',
    releaseFilter: 'release-1',
    favoritesOnly: true,
    latestSort: 'newest',
  });
  assert.ok(search.includes('mode=popular'));
  assert.ok(search.includes('q=IRIS+OUT'));
  assert.ok(search.includes('release=release-1'));
  assert.ok(!search.includes('view=favorites'));
  const parsed = parseViewParams(search);
  assert.equal(parsed.query, 'IRIS OUT');
  assert.equal(parsed.releaseFilter, 'release-1');
  assert.equal(parsed.favoritesOnly, false);
});

test('legacy favorites URL is readable but no longer serialized', () => {
  assert.equal(parseViewParams('?view=favorites').favoritesOnly, true);
  assert.equal(serializeViewParams({ favoritesOnly: true }), '');
});

test('shareable discovery state excludes local-only favorites', () => {
  assert.equal(hasShareableDiscoveryState({ favoritesOnly: true }), false);
  assert.equal(hasShareableDiscoveryState({ query: 'A' }), true);
  assert.equal(hasShareableDiscoveryState({ artistFilter: '米津玄師' }), true);
});
