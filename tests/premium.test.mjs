import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSource = await readFile(new URL('../ui-design.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../experience-core.mjs', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../experience.css', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('signature experience makes taste position the primary product promise', () => {
  assert.match(htmlSource, /J-MUSIC TASTE COMPASS/);
  assert.match(htmlSource, /내 일본 음악 취향을/);
  assert.match(uiSource, /TASTE MAP/);
  assert.match(uiSource, /지금 내 취향의 위치/);
  assert.match(coreSource, /mapX: Math\.round\(deepCut \* 100\)/);
  assert.match(coreSource, /mapY: Math\.round\(exploration \* 100\)/);
});

test('daily recommendation is intentionally limited to three distinct roles', () => {
  assert.match(coreSource, /label: '안전픽'/);
  assert.match(coreSource, /label: '한 발 밖'/);
  assert.match(coreSource, /label: '딥 다이브'/);
  assert.match(coreSource, /for \(const role of DAILY_ROLES\)/);
  assert.match(coreSource, /used\.artists\.has/);
  assert.match(coreSource, /used\.releases\.has/);
});

test('rabbit hole is a five-step directional journey rather than another recommendation grid', () => {
  assert.match(uiSource, /한 곡에서 다음 취향으로, 5단계/);
  assert.match(uiSource, /steps: 5/);
  assert.match(coreSource, /deeper:/);
  assert.match(coreSource, /newer:/);
  assert.match(coreSource, /stranger:/);
  assert.match(uiSource, /data-jp-rabbit-start/);
  assert.match(uiSource, /data-jp-rabbit-direction/);
});

test('negative feedback applies to daily discovery and rabbit candidates', () => {
  assert.match(coreSource, /!hidden\.has\(song\.id\)/);
  assert.match(uiSource, /data-jp-dismiss/);
  assert.match(uiSource, /관심 없음 .*곡 초기화/);
  assert.match(uiSource, /오늘의 추천과 Rabbit Hole 후보에서 제외/);
});

test('taste and rabbit direction controls are keyboard operable radios', () => {
  assert.match(uiSource, /role="radiogroup" aria-label="추천의 새로움"/);
  assert.match(uiSource, /role="radiogroup" aria-label="Rabbit Hole 방향"/);
  assert.match(uiSource, /ArrowRight.*ArrowDown.*ArrowLeft.*ArrowUp.*Home.*End/s);
});

test('signature listening reuses the existing preferred platform and catalog contracts', () => {
  assert.match(uiSource, /jplaylist-listen-platform-v1/);
  assert.match(uiSource, /#platformSettings/);
  assert.match(uiSource, /music\.youtube\.com\/search/);
  assert.match(uiSource, /open\.spotify\.com\/search/);
  assert.match(uiSource, /#searchInput/);
});

test('signature controls retain mobile touch targets in static CSS', () => {
  assert.match(cssSource, /\.jp-quiet-button,[\s\S]*?min-height: 44px/);
  assert.match(cssSource, /\.jp-direction/);
  assert.match(cssSource, /\.jp-daily-hole/);
  assert.match(cssSource, /@media \(max-width: 360px\)/);
});
