import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../bootstrap.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../scene.css', import.meta.url), 'utf8');
const collector = await readFile(new URL('../scripts/fetch-scene.mjs', import.meta.url), 'utf8');
const validator = await readFile(new URL('../scripts/validate-scene-data.mjs', import.meta.url), 'utf8');
const pages = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const kpop = JSON.parse(await readFile(new URL('../data/songs-kpop.json', import.meta.url), 'utf8'));
const pop = JSON.parse(await readFile(new URL('../data/songs-pop.json', import.meta.url), 'utf8'));

test('J-POP K-POP and POP are first-class scenes with distinct catalogs', () => {
  assert.match(bootstrap, /jpop:\s*\{/);
  assert.match(bootstrap, /kpop:\s*\{/);
  assert.match(bootstrap, /pop:\s*\{/);
  assert.match(bootstrap, /data\/songs-kpop\.json/);
  assert.match(bootstrap, /data\/songs-pop\.json/);
  assert.equal(kpop.scene.id, 'kpop');
  assert.equal(pop.scene.id, 'pop');
});

test('scene switching keeps the same Taste Map product while isolating taste memory', () => {
  assert.match(bootstrap, /SCENE_SCOPED_KEYS/);
  assert.match(bootstrap, /jplaylist-favorites-v2/);
  assert.match(bootstrap, /jplaylist-experience-v1/);
  assert.match(bootstrap, /scopedStorageKey/);
  assert.match(bootstrap, /YOUR \$\{scene\.label\} COMPASS/);
  assert.match(bootstrap, /scene-switch/);
  assert.match(css, /scene-option\[aria-current="page"\]/);
});

test('scene query survives app history serialization', () => {
  assert.match(bootstrap, /withSceneInUrl/);
  assert.match(bootstrap, /history\.pushState/);
  assert.match(bootstrap, /searchParams\.set\('scene', scene\.id\)/);
});

test('K-Pop and Pop collectors use their regional charts and storefronts', () => {
  assert.match(collector, /api\/v2\/kr\/music\/most-played\/100\/songs\.json/);
  assert.match(collector, /api\/v2\/us\/music\/most-played\/100\/songs\.json/);
  assert.match(collector, /country:\s*'KR'/);
  assert.match(collector, /country:\s*'US'/);
  assert.match(collector, /acceptsChartItem/);
  assert.match(validator, /songs-kpop\.json/);
  assert.match(validator, /songs-pop\.json/);
});

test('production refreshes and packages all three music scenes', () => {
  assert.match(pages, /fetch-scene\.mjs "\$scene"/);
  assert.match(pages, /validate-scene-data\.mjs/);
  assert.match(pages, /data\/songs-kpop\.json data\/songs-pop\.json/);
  assert.match(pages, /cp data\/songs\*\.json _site\/data\//);
  assert.match(pages, /scene\.css/);
});
