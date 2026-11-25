type Activity = { title: string; finished: number; saved: number; reactions: number; replies: number };
type Readership = { essays: Activity[]; start: string; end: string };
type Release = { release: { revision: string; checkedAt: string; url: string } | null };
const localDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const phoenixDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Phoenix' });

export function setupDeskOperations(parent: HTMLElement) {
  const root = parent.querySelector<HTMLElement>('[data-desk-operations]');
  const readership = root?.querySelector<HTMLDetailsElement>('[data-desk-readership]');
  const release = root?.querySelector<HTMLDetailsElement>('[data-desk-release]');
  const table = readership?.querySelector<HTMLElement>('[data-readership-table]');
  const rows = readership?.querySelector<HTMLTableSectionElement>('[data-readership-rows]');
  const link = release?.querySelector<HTMLAnchorElement>('[data-release-link]');
  if (!readership || !release || !table || !rows || !link) return { clear() {} };

  const controllers = new Map<HTMLDetailsElement, AbortController>();
  function load<T>(panel: HTMLDetailsElement, path: string, present: (value: T) => string) {
    const status = panel.querySelector<HTMLElement>('[data-operations-status]');
    panel.addEventListener('toggle', async () => {
      controllers.get(panel)?.abort();
      if (!panel.open || !status) return;
      const controller = new AbortController();
      controllers.set(panel, controller);
      status.textContent = 'Checking the desk…';
      try {
        const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const result = await response.json() as T;
        if (!controller.signal.aborted) status.textContent = present(result);
      } catch {
        if (!controller.signal.aborted) status.textContent = 'This information is unavailable. Try opening it again.';
      }
    });
  }

  load<Readership>(readership, '/api/admin/readership/', ({ essays, start, end }) => {
    rows.replaceChildren(...essays.map(({ title, finished, saved, replies, reactions }) => {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = title;
      row.append(name);
      for (const count of [finished, saved, reactions, replies]) {
        const value = document.createElement('td');
        value.textContent = String(count);
        row.append(value);
      }
      return row;
    }));
    table.hidden = essays.length === 0;
    const period = `${localDate.format(new Date(start))}–${localDate.format(new Date(end))} in Phoenix`;
    return essays.length ? period : `No recorded activity from ${period}.`;
  });

  load<Release>(release, '/api/admin/release/', ({ release: latest }) => {
    link.hidden = true;
    if (!latest) return 'A live verification report will appear here after the first successful release check.';
    const { revision, checkedAt, url } = latest;
    if (/^https:\/\/github\.com\/[\w-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(url)) {
      link.href = url;
      link.hidden = false;
    }
    return `Verified commit ${revision.slice(0, 7)} on ${phoenixDate.format(new Date(checkedAt))} Phoenix time.`;
  });

  return { clear() {
    for (const panel of [readership, release]) {
      controllers.get(panel)?.abort();
      panel.open = false;
      panel.querySelector('[data-operations-status]')?.replaceChildren();
    }
    rows.replaceChildren();
    table.hidden = true;
    link.hidden = true;
    link.removeAttribute('href');
  } };
}
