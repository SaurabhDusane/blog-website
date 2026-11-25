import { readerApi } from '../lib/reader-api';
import { libraryChangeEvent, readLibrary } from '../lib/reader-state';

type Kind = 'finished' | 'saved';
const sent = new Set<string>();
const receiptPrefix = 'second-ink:readership:';

function wasCounted(key: string) {
  if (sent.has(key)) return true;
  try { return localStorage.getItem(key) === '1'; }
  catch { return false; }
}

function countReadership(postId: string, kind: Kind) {
  const key = `${receiptPrefix}${kind}:${postId}`;
  const post = async () => {
    if (wasCounted(key)) return;
    sent.add(key);
    try {
      const response = await fetch(readerApi('readership'), {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, kind }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new Error('Count unavailable');
      try { localStorage.setItem(key, '1'); } catch { /* Per-page deduplication still applies. */ }
    } catch { sent.delete(key); }
  };
  if (navigator.locks?.request) void navigator.locks.request(key, post).catch(() => {});
  else void post();
}

export function trackReadership(postId: string, signal?: AbortSignal) {
  if (document.body.hasAttribute('data-documents-preview')) return;
  const read = () => {
    const library = readLibrary();
    return { saved: library.saved.includes(postId), finished: library.history[postId]?.completed === true };
  };
  let previous = read();
  window.addEventListener(libraryChangeEvent, () => {
    const current = read();
    for (const kind of ['saved', 'finished'] as const) {
      if (current[kind] && !previous[kind]) countReadership(postId, kind);
    }
    previous = current;
  }, { signal });
}
