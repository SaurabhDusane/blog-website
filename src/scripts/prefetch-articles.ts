interface ConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

const articlePath = /^\/posts\/[a-z0-9-]+\/$/;
const requested = new Set<string>();
const slowNetworks = ['slow-2g', '2g', '3g'];

function mayPrefetch() {
  const network = (navigator as Navigator & { connection?: ConnectionHints }).connection;
  return navigator.onLine
    && !network?.saveData
    && !slowNetworks.includes(network?.effectiveType ?? '')
    && !window.matchMedia('(prefers-reduced-data: reduce)').matches;
}

function articleLink(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
}

function prefetch(anchor: HTMLAnchorElement) {
  if (!mayPrefetch() || requested.size >= 3 || anchor.hasAttribute('download')) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  let url: URL;
  try {
    url = new URL(anchor.href, document.baseURI);
  } catch {
    return false;
  }
  if (url.origin !== location.origin || !articlePath.test(url.pathname)
    || url.pathname === location.pathname || url.search) return false;

  url.hash = '';
  if (requested.has(url.href)) return false;
  requested.add(url.href);
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.href = url.href;
  document.head.append(hint);
  return true;
}

function enableArticlePrefetch() {
  if (/^\/(desk|saved|offline)(?:\/|$)/.test(location.pathname)
    || !document.createElement('link').relList.supports('prefetch')) return;

  let hoverTimer = 0;
  document.addEventListener('pointerover', (event) => {
    const anchor = articleLink(event.target);
    if (!anchor || event.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (anchor.matches(':hover')) prefetch(anchor);
    }, 110);
  });
  document.addEventListener('focusin', (event) => {
    const anchor = articleLink(event.target);
    if (anchor?.matches(':focus-visible')) prefetch(anchor);
  });

  function observeNearbyArticles() {
    if (!mayPrefetch() || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting || !(target instanceof HTMLAnchorElement)) continue;
        observer.unobserve(target);
        if (prefetch(target)) {
          observer.disconnect();
          break;
        }
      }
    }, { rootMargin: '160px 0px' });
    const articles = document.querySelectorAll<HTMLAnchorElement>('main a[href^="/posts/"]');
    for (const anchor of Array.from(articles).slice(0, 12)) observer.observe(anchor);
  }

  function queueNearbyArticles() {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(observeNearbyArticles);
    else window.setTimeout(observeNearbyArticles, 250);
  }

  if (document.readyState === 'complete') queueNearbyArticles();
  else window.addEventListener('load', queueNearbyArticles, { once: true });
}

enableArticlePrefetch();
