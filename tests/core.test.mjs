import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diversifyByArtist,
  getGenreTags,
  isLikelyJapaneseTrack,
  languageForText,
  normalizeGenre,
  normalizeSearchText,
  parseFavorites,
  parseViewParams,
  serializeFavorites,
  serializeViewParams,
  snapshotSong,
} from '../core.mjs';

test('genre taxonomy keeps K-Pop separate from J-Pop', () => {
  assert.equal(normalizeGenre('K-Pop'), 'K-Pop');
  assert.equal(normalizeGenre('J-Pop'), 'J-Pop');
  assert.equal(normalizeGenre('ポップ'), 'Pop');
});

test('Japanese genre aliases are normalized', () => {
  assert.equal(normalizeGenre('ロック'), 'J-Rock');
  assert.equal(normalizeGenre('ヒップホップ／ラップ'), 'Hip-Hop');
  assert.deepEqual(getGenreTags({ genres: ['オルタナティブ', 'ミュージック', 'ロック'] }), ['Alternative', 'J-Rock']);
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

test('search normalization is Unicode and whitespace tolerant', () => {
  assert.equal(normalizeSearchText('  ＩＲＩＳ   OUT  '), 'iris out');
});

test('corrupt favorite storage fails safely', () => {
  assert.equal(parseFavorites('{broken-json').size, 0);
  assert.equal(parseFavorites('null').size, 0);
});

test('favorite snapshots round-trip with metadata', () => {
  const map = new Map();
  map.set('1', snapshotSong({ id: 1, title: '晴る', artist: 'ヨルシカ', genres: ['ロック'], rank: 4 }));
  const restored = parseFavorites(serializeFavorites(map));
  assert.equal(restored.get('1').title, '晴る');
  assert.equal(restored.get('1').chartRank, 4);
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

test('URL view state round-trips search, genre, artist, mode and favorites', () => {
  const search = serializeViewParams({
    activeMode: 'popular',
    query: 'IRIS OUT',
    activeGenre: 'J-Rock',
    artistFilter: '米津玄師',
    favoritesOnly: true,
  });
  assert.deepEqual(parseViewParams(search), {
    activeMode: 'popular',
    query: 'IRIS OUT',
    activeGenre: 'J-Rock',
    artistFilter: '米津玄師',
    favoritesOnly: true,
  });
});
