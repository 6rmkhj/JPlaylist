for (const href of ['./icons.css', './typography.css']) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = href;
  document.head.append(stylesheet);
}

const selectors = {
  badges: '.card-rank, #featuredRank',
  listen: '[data-listen-id], #featuredListen',
  favorites: '#favoritesFilter',
};

function classifyBadge(node) {
  const text = node.textContent.trim();
  const kind = text.startsWith('Apple JP #')
    ? 'rank'
    : text.startsWith('발매 ')
      ? 'release'
      : 'recommendation';
  if (node.dataset.badgeKind !== kind) node.dataset.badgeKind = kind;
}

function decorateListenButton(node) {
  const text = node.textContent;
  if (!text.includes('↗')) return;
  node.textContent = text.replace(/\s*↗/g, '');
  node.classList.add('external-action');
}

function decorateFavoritesNav() {
  const button = document.querySelector(selectors.favorites);
  if (!button) return;
  const text = button.textContent.trim();
  if (!/^[♡♥]/.test(text)) return;
  const label = text.replace(/^[♡♥]\s*/, '');
  button.textContent = label;
  button.dataset.icon = button.classList.contains('active') ? 'heart-filled' : 'heart';
}

function decorate() {
  document.querySelectorAll(selectors.badges).forEach(classifyBadge);
  document.querySelectorAll(selectors.listen).forEach(decorateListenButton);
  decorateFavoritesNav();
}

const observer = new MutationObserver(decorate);
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['class'],
});

decorate();
