type Entry = { postId: string; path: string; title: string; version?: string; changedAt?: string };
type Snapshot = Record<string, { version: string; time: number }>;

const key = 'second-ink:archive-visit:v1';

function readSnapshot(raw: string): Snapshot | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    return Object.fromEntries(Object.entries(value).filter(([id, saved]) => (
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && saved && typeof saved === 'object'
      && typeof saved.version === 'string' && Number.isFinite(saved.time)
    )));
  } catch { return undefined; }
}

export function setupArchiveVisits(page: HTMLElement, entries: Entry[], search: HTMLInputElement | null) {
  const panel = page.querySelector<HTMLDetailsElement>('[data-archive-changes]');
  const count = panel?.querySelector<HTMLElement>('[data-archive-changes-count]');
  const list = panel?.querySelector<HTMLUListElement>('[data-archive-changes-list]');
  const mark = panel?.querySelector<HTMLButtonElement>('[data-archive-changes-seen]');
  if (!panel || !count || !list || !mark) return;

  const current = entries.flatMap((entry) => {
    const time = Date.parse(entry.changedAt ?? '');
    return entry.postId && entry.version && Number.isFinite(time) ? [{ ...entry, version: entry.version, time }] : [];
  });
  if (!current.length) return;

  const record = (previous: Snapshot) => {
    const seen = new Map(Object.entries(previous));
    for (const { postId, version, time } of current) {
      if ((seen.get(postId)?.time ?? -Infinity) <= time) seen.set(postId, { version, time });
    }
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(seen)));
  };

  let previous: Snapshot | undefined;
  try {
    const stored = window.localStorage.getItem(key);
    previous = stored ? readSnapshot(stored) : undefined;
    record(previous ?? {});
  } catch { return; }
  if (!previous) return;

  const baseline = previous;
  const changed = current.filter(({ postId, time, version }) => {
    const before = Object.hasOwn(baseline, postId) ? baseline[postId] : undefined;
    return !before || (time >= before.time && version !== before.version);
  }).sort((a, b) => b.time - a.time);
  if (!changed.length) return;

  count.textContent = `(${changed.length})`;
  list.replaceChildren(...changed.map(({ postId, path, title }) => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    const kind = document.createElement('span');
    link.href = path;
    link.textContent = title;
    kind.textContent = Object.hasOwn(baseline, postId) ? 'Updated' : 'New';
    row.append(link, kind);
    return row;
  }));
  panel.hidden = false;
  mark.addEventListener('click', () => {
    panel.hidden = true;
    search?.focus();
  });
}
