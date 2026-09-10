import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, app, css, fixes, bootstrap, workflow] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
  readFile(new URL('fixes.css', root), 'utf8'),
  readFile(new URL('bootstrap.js', root), 'utf8'),
  readFile(new URL('.github/workflows/pages.yml', root), 'utf8'),
]);

test('search input has a real accessible label and clear button is outside the label', () => {
  assert.match(html, /<label class="visually-hidden" for="searchInput">곡명 또는 아티스트 검색<\/label>/);
  assert.doesNotMatch(html, /<label[^>]*class="search-box"/);
});

test('genre filters expose a named group and use stable taxonomy ordering', () => {
  assert.match(html, /id="genreFilters" role="group" aria-labelledby="genreFilterLabel"/);
  assert.match(app, /genreSortIndex/);
  assert.match(app, /getGenreTags/);
});

test('platform radiogroup implements roving tabindex and Arrow navigation', () => {
  assert.match(html, /id="platformOptions" role="radiogroup"/);
  assert.match(html, /role="radio" aria-checked="false" data-platform="spotify"/);
  assert.match(app, /button\.tabIndex = selected \|\| \(!selectedPlatform && index === 0\) \? 0 : -1/);
  assert.match(app, /\['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'\]/);
});

test('preview player exposes coverage, time, and stops before external listening', () => {
  assert.match(html, /id="previewTime"/);
  assert.match(html, /id="previewCoverageNote"/);
  assert.match(app, /function updatePreviewTime/);
  assert.match(app, /function openOnPlatform[\s\S]*?stopPreview\(\)/);
});

test('image fallbacks and responsive artwork are implemented', () => {
  assert.match(app, /artworkSrcSet/);
  assert.match(app, /function artworkFailed/);
  assert.match(css, /\.artwork-fallback/);
});

test('mobile layout remains dense and core touch controls have 44px minimum targets', () => {
  assert.doesNotMatch(css, /@media \(max-width: 360px\)[\s\S]*?\.song-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(fixes, /\.song-artist,[\s\S]*?min-height: 44px/);
  assert.match(fixes, /\.search-clear \{ min-width: 44px; \}/);
});

test('programmatic scrolling respects reduced motion and saves history scroll state', () => {
  assert.match(app, /behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
  assert.match(app, /scrollRestoration = 'manual'/);
  assert.match(app, /saveCurrentScroll/);
});

test('navigation state is serialized, deep-linked to discovery, and restored on popstate', () => {
  assert.match(app, /serializeViewParams\(view\)/);
  assert.match(app, /hasShareableDiscoveryState\(view\).*'#discovery'/s);
  assert.match(app, /addEventListener\('popstate'/);
});

test('favorites reset stays local and removal/import both provide recovery paths', () => {
  assert.match(app, /function resetFilters\(\{ sync = true \} = \{\}\)/);
  assert.doesNotMatch(app, /function resetFilters[\s\S]{0,500}favoritesOnly = false/);
  assert.match(html, /id="favoriteUndoButton"/);
  assert.match(html, /id="backupReview"/);
  assert.match(html, /id="undoImport"/);
});

test('loading has timeout, cache-first path, source detail, and diagnostics', () => {
  assert.match(app, /DATA_TIMEOUT_MS = 12_000/);
  assert.match(app, /const cached = readCachedPayload\(\)/);
  assert.match(app, /AbortController/);
  assert.match(html, /id="statusDetails"/);
  assert.match(html, /id="diagnosticCopy"/);
  assert.match(fixes, /\.loading-grid/);
});

test('IME composition and whitespace-normalized search are explicit', () => {
  assert.match(app, /addEventListener\('compositionstart'/);
  assert.match(app, /addEventListener\('compositionend'/);
  assert.match(app, /cleanSearchQuery/);
});

test('release context and favorites sorting are user-visible', () => {
  assert.match(html, /id="latestSort"/);
  assert.match(html, /id="favoritesSort"/);
  assert.match(app, /data-release-id/);
  assert.match(app, /collectionName/);
});

test('startup fallback and legacy favorite lookup are independent of the module app', () => {
  assert.match(html, /<noscript>/);
  assert.match(html, /src="\.\/bootstrap\.js"/);
  assert.match(bootstrap, /STARTUP_TIMEOUT_MS/);
  assert.match(bootstrap, /itunes\.apple\.com\/lookup/);
  assert.match(bootstrap, /jplaylist-likes-v1/);
});

test('metadata includes canonical, social preview, and favicon assets', () => {
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /rel="icon" href="\.\/favicon\.svg"/);
});

test('production workflow permanently runs browser UX regressions and packages new assets', () => {
  assert.match(workflow, /Run browser UX regressions/);
  assert.match(workflow, /playwright\.config\.mjs/);
  assert.match(workflow, /fixes\.css/);
  assert.match(workflow, /bootstrap\.js/);
  assert.match(workflow, /favicon\.svg/);
  assert.match(workflow, /og-card\.svg/);
});
