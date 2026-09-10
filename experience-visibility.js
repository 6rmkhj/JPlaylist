function bindSignatureVisibility() {
  const signature = document.querySelector('#personalized');
  if (!signature) return false;

  const observer = new IntersectionObserver(([entry]) => {
    document.body.classList.toggle('jp-signature-active', Boolean(entry?.isIntersecting));
  }, {
    root: null,
    rootMargin: '-4% 0px -4% 0px',
    threshold: 0,
  });

  observer.observe(signature);
  return true;
}

if (!bindSignatureVisibility()) {
  const observer = new MutationObserver(() => {
    if (!bindSignatureVisibility()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
