const endpoint = '/api/admin/field-notes/';
const statuses = {
  new: 'New',
  reviewed: 'Reviewed',
  archived: 'Archived',
} as const;
type Status = keyof typeof statuses;
type FieldNote = {
  id: number;
  postId: string;
  prompt: string;
  note: string;
  quoteConsent: boolean;
  status: Status;
  submittedAt: string;
};
type Page = { notes: FieldNote[]; nextBefore: number | null };
type InboxView = { postId: string; titles: Map<string, string> };
const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function find<T extends HTMLElement>(parent: ParentNode, selector: string) {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error('Field note inbox element missing');
  return element;
}

export function setupFieldNoteInbox(root: HTMLElement) {
  const details = find<HTMLDetailsElement>(root, '[data-desk-field-notes]');
  const filter = find<HTMLSelectElement>(details, '[data-field-note-filter]');
  const list = find(details, '[data-field-note-inbox-list]');
  const status = find(details, '[data-field-note-inbox-status]');
  const more = find<HTMLButtonElement>(details, '[data-field-note-inbox-more]');
  const retry = find<HTMLButtonElement>(details, '[data-field-note-inbox-retry]');
  const template = find<HTMLTemplateElement>(details, '[data-field-note-inbox-row]');

  let view: InboxView | undefined;
  let session = new AbortController();
  let pending: AbortController | undefined;
  let nextBefore: number | null = null;

  const tell = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };

  function render(note: FieldNote, title: string) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = find<HTMLLIElement>(fragment, 'li');
    find(item, '[data-field-note-essay]').textContent = title;
    find(item, '[data-field-note-current-prompt]').textContent = note.prompt;
    find(item, '[data-field-note-text]').textContent = note.note;
    find(item, '[data-field-note-permission]').textContent = note.quoteConsent
      ? 'Permission to quote anonymously'
      : 'Private · Keep the words in this inbox';
    const time = find<HTMLTimeElement>(item, 'time');
    time.dateTime = note.submittedAt;
    if (Number.isFinite(Date.parse(note.submittedAt))) time.textContent = date.format(new Date(note.submittedAt));
    const form = find<HTMLFormElement>(item, '[data-field-note-moderation]');
    const choice = find<HTMLSelectElement>(form, 'select');
    const save = find<HTMLButtonElement>(form, 'button');
    let saved = note.status;
    choice.value = saved;
    save.disabled = true;
    choice.addEventListener('change', () => { save.disabled = choice.value === saved; });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!view || save.disabled || choice.value === saved) return;
      const selected = choice.value as Status;
      const signal = session.signal;
      const focus = () => form.contains(document.activeElement) || document.activeElement === document.body;
      choice.disabled = true;
      save.disabled = true;
      form.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: note.id, status: selected }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        if (signal.aborted) return;
        if (!response.ok) throw new Error('Field note status unavailable');
        saved = selected;
        if (!item.isConnected) {
          if (details.open) await load();
        } else if (filter.value && filter.value !== selected) {
          if (focus()) filter.focus({ preventScroll: true });
          item.remove();
        }
        if (!signal.aborted) tell(list.childElementCount || nextBefore ? `Moved to ${statuses[selected].toLowerCase()}.` : 'All caught up in this view.');
      } catch {
        if (!signal.aborted) tell('The status didn’t save. Give it another try.', true);
      } finally {
        choice.disabled = false;
        save.disabled = choice.value === saved;
        form.removeAttribute('aria-busy');
      }
    });
    return fragment;
  }

  async function load(before: number | null = null) {
    if (!view) return;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    const url = new URL(endpoint, location.origin);
    if (view.postId) url.searchParams.set('post', view.postId);
    if (filter.value) url.searchParams.set('status', filter.value);
    if (before) url.searchParams.set('before', String(before));
    if (!before) {
      nextBefore = null;
      more.hidden = true;
      list.replaceChildren();
    }
    retry.hidden = true;
    more.disabled = true;
    list.setAttribute('aria-busy', 'true');
    tell('Looking through the field notes…');
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error('Field note inbox unavailable');
      const page: Page = await response.json();
      if (request.signal.aborted || !view) return;
      const nodes = page.notes.map((note) => render(note, view?.titles.get(note.postId) ?? note.postId));
      list.append(...nodes);
      nextBefore = page.nextBefore;
      more.hidden = !nextBefore;
      if (before && more.hidden && document.activeElement === more) filter.focus({ preventScroll: true });
      tell(list.childElementCount ? '' : 'There are no field notes in this view.');
    } catch {
      if (!request.signal.aborted) {
        tell('The inbox is out of reach. Try opening it again.', true);
        retry.hidden = Boolean(before);
      }
    } finally {
      if (!request.signal.aborted) {
        pending = undefined;
        more.disabled = false;
        list.removeAttribute('aria-busy');
      }
    }
  }

  details.addEventListener('toggle', () => { if (details.open) void load(); });
  filter.addEventListener('change', () => { void load(); });
  more.addEventListener('click', () => { if (nextBefore) void load(nextBefore); });
  retry.addEventListener('click', () => { filter.focus({ preventScroll: true }); void load(); });

  return {
    show(postId: string, titles: Map<string, string>) {
      const previous = view?.postId;
      view = { postId, titles };
      if (details.open && previous !== postId) void load();
    },
    clear() {
      view = undefined;
      session.abort();
      session = new AbortController();
      pending?.abort();
      pending = undefined;
      nextBefore = null;
      details.open = false;
      filter.value = 'new';
      more.hidden = true;
      more.disabled = false;
      retry.hidden = true;
      tell('');
      list.removeAttribute('aria-busy');
      list.replaceChildren();
    },
  };
}
