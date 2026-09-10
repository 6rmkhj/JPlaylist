import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ui-design.js', import.meta.url), 'utf8');

test('personalized mix is deterministic by local day and remix offset', () => {
  assert.match(source, /stableUnit\(`\$\{localDateKey\(\)\}::\$\{experience\.mixOffset\}/);
  assert.match(source, /experience\.mixDay !== today/);
});

test('personalized mix excludes favorites and explicit hidden feedback', () => {
  assert.match(source, /!profile\.favoriteIds\.has\(song\.id\) && !hidden\.has\(song\.id\)/);
  assert.match(source, /data-jp-dismiss/);
  assert.match(source, /숨김 .*곡 초기화/);
});

test('recommendation novelty is user controllable with an accessible radio group', () => {
  assert.match(source, /role="radiogroup" aria-label="추천의 새로움"/);
  assert.match(source, /role="radio" data-jp-exploration/);
  assert.match(source, /ArrowRight.*ArrowDown.*ArrowLeft.*ArrowUp.*Home.*End/s);
});

test('recent discovery history stays local and bounded', () => {
  assert.match(source, /jplaylist-experience-v1/);
  assert.match(source, /experience\.activity = experience\.activity\.slice\(-MAX_ACTIVITY\)/);
  assert.match(source, /experience\.recent = \[/);
});

test('premium listening reuses the existing preferred platform contract', () => {
  assert.match(source, /jplaylist-listen-platform-v1/);
  assert.match(source, /#platformSettings/);
  assert.match(source, /music\.youtube\.com\/search/);
  assert.match(source, /open\.spotify\.com\/search/);
});

test('new premium controls retain minimum touch targets', () => {
  assert.match(source, /\.jp-quiet-button.*min-height: 44px/s);
  assert.match(source, /\.jp-chip-button \{ min-height: 44px/);
  assert.match(source, /\.jp-mix-open, \.jp-mix-listen \{ min-height: 44px/);
});
