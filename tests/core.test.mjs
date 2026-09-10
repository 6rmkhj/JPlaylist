import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGenreTags,
  isLikelyJapaneseTrack,
  normalizeGenre,
  normalizeSearchText,
  parseFavorites,
  serializeFavorites,
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
