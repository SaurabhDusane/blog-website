import { feelingCount, feelingLabel, feelings, type Feeling, type FeelingCounts } from '../lib/feelings';
import { stances, type StanceCounts } from '../lib/stances';
import { setupFieldNoteInbox } from './desk-field-notes';

type Essay = { id: string; title: string; total: number; feelings: FeelingCounts; stanceTotal: number; stances: StanceCounts };
type DailyCount = { date: string; postId: string; count: number };
type Note = {
  id: number;
  postId: string;
  feeling: Feeling;
  note: string | null;
  answer: string | null;
  submittedAt: string;
  pinned: boolean;
  featureConsent: boolean;
};
type PrivateReply = { postId: string; message: string; email: string | null; receivedAt: string };
type MonthlyNote = { month: string; postId: string; excerpt: string; attribution: string };
type DeskData = {
  ok: true;
  posts: Essay[];
  trends: DailyCount[];
  responses: Note[];
  inbox: PrivateReply[];
  month: string;
  featuredNote: MonthlyNote | null;
};
type ActionResult = { ok: boolean; message?: string };
type MonthlyResult = ActionResult & { month?: string; featuredNote?: MonthlyNote | null };

const deskEndpoint = '/api/admin/feedback/';
const featureEndpoint = '/api/admin/monthly-note/';
const sessionEndpoint = '/api/admin/session/';
const day = 86_400_000;
const period = 30;
const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fullMonth = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function find<T extends HTMLElement>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error('Response desk element missing');
  return element;
}

function namedCount(count: number) {
  return `${count} ${count === 1 ? 'response' : 'responses'}`;
}

function namedVotes(count: number) {
  return `${count} ${count === 1 ? 'vote' : 'votes'}`;
}

function fillDate(time: HTMLTimeElement, value: string) {
  if (!Number.isFinite(Date.parse(value))) return;
  time.dateTime = value;
  time.textContent = fullDate.format(new Date(value));
}

function fillCount(row: HTMLElement, selector: string, count: number, total: number) {
  const meter = find<HTMLProgressElement>(row, 'progress');
  meter.max = Math.max(1, total);
  meter.value = count;
  find(row, selector).textContent = String(count);
}

function fillTrends(root: HTMLElement, trends: DailyCount[]) {
  const byDay = new Map<string, number>();
  for (const { date, count } of trends) {
    byDay.set(date, (byDay.get(date) ?? 0) + count);
  }

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = Array.from({ length: period }, (_, index) => new Date(today - (period - 1 - index) * day));
  const counts = dates.map((date) => byDay.get(date.toISOString().slice(0, 10)) ?? 0);
  const peak = Math.max(1, ...counts);
  const graph = find(root, '[data-desk-trend-graph]');
  const table = find(root, '[data-desk-trend-table]');
  const bars = document.createDocumentFragment();
  const rows = document.createDocumentFragment();
  for (const [index, date] of dates.entries()) {
    const count = counts[index];
    const bar = document.createElement('span');
    bar.style.blockSize = `${(count / peak) * 100}%`;
    bars.append(bar);

    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const valueCell = document.createElement('td');
    dateCell.textContent = fullDate.format(date);
    valueCell.textContent = String(count);
    row.append(dateCell, valueCell);
    rows.append(row);
  }
  graph.replaceChildren(bars);
  table.replaceChildren(rows);
  find(root, '[data-desk-trend-start]').textContent = shortDate.format(dates[0]);
  find(root, '[data-desk-trend-end]').textContent = shortDate.format(dates[period - 1]);
  const total = counts.reduce((sum, count) => sum + count, 0);
  find(root, '[data-desk-trend-summary]').textContent = total ? `${namedCount(total)} in this window.` : 'No responses in this window yet.';
}

function renderNote(template: HTMLTemplateElement, note: Note, title: string) {
  const row = template.content.cloneNode(true) as DocumentFragment;
  find(row, '[data-note-post]').textContent = title;
  find(row, '[data-note-feeling]').textContent = feelingLabel(note.feeling);

  fillDate(find<HTMLTimeElement>(row, '[data-note-date]'), note.submittedAt);

  const quote = find(row, '[data-note-quote]');
  quote.textContent = note.note ?? '';
  quote.hidden = !note.note;
  const followup = find(row, '[data-note-followup]');
  followup.hidden = !note.answer;
  find(followup, '[data-note-answer]').textContent = note.answer ?? '';

  const pin = find<HTMLButtonElement>(row, '[data-desk-pin]');
  pin.dataset.responseId = String(note.id);
  pin.setAttribute('aria-pressed', String(note.pinned));
  const feature = find<HTMLButtonElement>(row, '[data-desk-feature]');
  feature.dataset.responseId = String(note.id);
  feature.hidden = !note.featureConsent || !note.note;
  return row;
}

function renderReply(template: HTMLTemplateElement, reply: PrivateReply, title: string) {
  const row = template.content.cloneNode(true) as DocumentFragment;
  find(row, '[data-reply-post]').textContent = title;
  find(row, '[data-reply-message]').textContent = reply.message;
  fillDate(find<HTMLTimeElement>(row, '[data-reply-date]'), reply.receivedAt);
  if (reply.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply.email)) {
    const email = find<HTMLAnchorElement>(row, '[data-reply-email]');
    const [local, domain] = reply.email.split('@');
    email.href = `mailto:${encodeURIComponent(local)}@${encodeURIComponent(domain)}`;
    email.hidden = false;
  }
  return row;
}

function setupDesk(root: HTMLElement) {
  const login = find<HTMLFormElement>(root, '[data-desk-login]');
  const password = find<HTMLInputElement>(login, 'input[type="password"]');
  const loginButton = find<HTMLButtonElement>(login, 'button');
  const status = find(root, '[data-desk-status]');
  const content = find(root, '[data-desk-content]');
  const signOut = find<HTMLButtonElement>(root, '[data-desk-logout]');
  const filter = find<HTMLSelectElement>(root, '[data-desk-post]');
  const filterCount = find(root, '[data-desk-filter-count]');
  const posts = find(root, '[data-desk-posts]');
  const postsEmpty = find(root, '[data-desk-posts-empty]');
  const notes = find(root, '[data-desk-notes]');
  const notesEmpty = find(root, '[data-desk-notes-empty]');
  const notesHeading = find(root, '#desk-notes-heading');
  const template = find<HTMLTemplateElement>(root, '[data-desk-note-template]');
  const keptOnly = find<HTMLInputElement>(root, '[data-desk-kept]');
  const inbox = find(root, '[data-desk-inbox]');
  const fieldNotes = setupFieldNoteInbox(root);
  const inboxEmpty = find(root, '[data-inbox-empty]');
  const backups = find<HTMLDetailsElement>(root, '[data-desk-backups]');
  const backupStatus = find(root, '[data-backup-status]');
  const backupWeeks = find(root, '[data-backup-weeks]');
  const backupMore = find<HTMLButtonElement>(root, '[data-backup-more]');
  const replyTemplate = find<HTMLTemplateElement>(root, '[data-desk-reply-template]');
  const featureHeading = find(root, '#desk-feature-heading');
  const featureMonth = find(root, '[data-feature-month]');
  const featureCurrent = find(root, '[data-feature-current]');
  const featureQuote = find(root, '[data-feature-quote]');
  const featureCitation = find(root, '[data-feature-citation]');
  const featureEmpty = find(root, '[data-feature-empty]');
  const featureRemove = find<HTMLButtonElement>(root, '[data-feature-remove]');
  const featureForm = find<HTMLFormElement>(root, '[data-feature-form]');
  const featureSourceTitle = find(root, '[data-feature-source-title]');
  const featureSource = find(root, '[data-feature-source]');
  const featureExcerpt = find<HTMLTextAreaElement>(root, '#desk-feature-excerpt');
  const featurePublish = find<HTMLButtonElement>(root, '[data-feature-publish]');
  const featureCancel = find<HTMLButtonElement>(root, '[data-feature-cancel]');
  let data: DeskData | null = null;
  let featureDraft: Note | undefined;
  let featurePending = false;
  let backupRequest: AbortController | undefined;
  let nextWeek: string | null = null;

  const tell = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };

  function closeFeatureEditor() {
    featureDraft = undefined;
    featureForm.hidden = true;
    featureForm.reset();
    featureSourceTitle.textContent = '';
    featureSource.textContent = '';
  }

  function showFeature() {
    const note = data?.featuredNote;
    const date = new Date(`${data?.month ?? ''}-01T00:00:00Z`);
    featureMonth.textContent = Number.isFinite(date.getTime()) ? fullMonth.format(date) : '';
    featureCurrent.hidden = !note;
    featureQuote.textContent = note?.excerpt ?? '';
    featureCitation.textContent = note?.attribution ?? '';
    featureEmpty.hidden = !!note;
    featureRemove.hidden = !note;
    featurePublish.textContent = note ? 'Replace this month’s note' : 'Share this excerpt';
  }

  async function loadBackupShelf(after?: string) {
    backupRequest?.abort();
    const request = new AbortController();
    backupRequest = request;
    backupMore.disabled = true;
    backupStatus.textContent = 'Looking through the backup shelf…';
    try {
      const url = new URL('/api/admin/backups/', location.origin);
      if (after) url.searchParams.set('after', after);
      const response = await fetch(url, { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Backup shelf unavailable');
      const result: { enabled: boolean; weeks: string[]; nextAfter: string | null } = await response.json();
      if (request.signal.aborted) return;
      const items = [...result.weeks].reverse().map((week) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'text-link';
        link.href = `/api/admin/backups/?week=${encodeURIComponent(week)}`;
        link.download = '';
        link.textContent = `Week of ${fullDate.format(new Date(week))}`;
        item.append(link);
        return item;
      });
      if (after) backupWeeks.prepend(...items);
      else backupWeeks.replaceChildren(...items);
      nextWeek = result.nextAfter;
      backupMore.hidden = !nextWeek;
      backupStatus.textContent = result.enabled
        ? (backupWeeks.childElementCount ? '' : 'There are no weekly copies on the shelf yet.')
        : 'This host keeps fresh exports available on demand.';
    } catch {
      if (!request.signal.aborted) backupStatus.textContent = 'The shelf is out of reach. Try opening it again.';
    } finally {
      if (!request.signal.aborted) backupMore.disabled = false;
    }
  }

  backups.addEventListener('toggle', () => {
    if (backups.open && data) void loadBackupShelf();
  });
  backupMore.addEventListener('click', () => {
    if (nextWeek) void loadBackupShelf(nextWeek);
  });

  function clearDesk() {
    data = null;
    content.hidden = true;
    signOut.hidden = true;
    posts.replaceChildren();
    filter.replaceChildren(new Option('All essays', ''));
    notes.replaceChildren();
    inbox.replaceChildren();
    fieldNotes.clear();
    backupRequest?.abort();
    backups.open = false;
    backupStatus.textContent = '';
    backupWeeks.replaceChildren();
    backupMore.hidden = true;
    nextWeek = null;
    closeFeatureEditor();
    showFeature();
    filterCount.textContent = '';
    fillTrends(root, []);
    for (const { id } of feelings) {
      const row = find(root, `[data-desk-feeling="${id}"]`);
      fillCount(row, '[data-desk-feeling-count]', 0, 0);
    }
    for (const { id } of stances) {
      const row = find(root, `[data-desk-stance="${id}"]`);
      fillCount(row, '[data-desk-stance-count]', 0, 0);
    }
  }

  function showLogin(focus = false) {
    clearDesk();
    login.hidden = false;
    if (focus) password.focus();
  }

  function updateNotes() {
    if (!data) return;
    const titles = new Map(data.posts.map(({ id, title }) => [id, title]));
    const selected = filter.value;
    const matching = data.responses.filter((response) => (
      (response.note || response.answer) &&
      (!selected || response.postId === selected) &&
      (!keptOnly.checked || response.pinned)
    ));
    notes.replaceChildren(...matching.map((note) => renderNote(template, note, titles.get(note.postId) ?? note.postId)));
    notesEmpty.hidden = matching.length > 0;
    notesEmpty.textContent = keptOnly.checked ? 'No quotes kept here yet.' : 'No one has left a note here yet.';
  }

  function updateView() {
    if (!data) return;
    const selected = filter.value;
    const current = selected ? data.posts.filter(({ id }) => id === selected) : data.posts;
    const total = current.reduce((sum, essay) => sum + essay.total, 0);
    const votes = current.reduce((sum, essay) => sum + essay.stanceTotal, 0);
    filterCount.textContent = `${namedCount(total)} · ${namedVotes(votes)}`;

    for (const button of posts.querySelectorAll<HTMLButtonElement>('[data-desk-select]')) {
      button.setAttribute('aria-pressed', String(button.dataset.deskSelect === selected));
    }

    for (const { id } of feelings) {
      const row = find(root, `[data-desk-feeling="${id}"]`);
      const count = current.reduce((sum, essay) => sum + feelingCount(essay.feelings, id), 0);
      fillCount(row, '[data-desk-feeling-count]', count, total);
    }
    for (const { id } of stances) {
      const row = find(root, `[data-desk-stance="${id}"]`);
      const count = current.reduce((sum, essay) => sum + essay.stances[id], 0);
      fillCount(row, '[data-desk-stance-count]', count, votes);
    }

    fillTrends(root, data.trends.filter(({ postId }) => !selected || postId === selected));
    updateNotes();
    const titles = new Map(data.posts.map(({ id, title }) => [id, title]));
    const replies = data.inbox.filter(({ postId }) => !selected || postId === selected);
    inbox.replaceChildren(...replies.map((reply) => renderReply(replyTemplate, reply, titles.get(reply.postId) ?? reply.postId)));
    inboxEmpty.hidden = replies.length > 0;
    fieldNotes.show(selected, titles);
  }

  function revealDesk(result: DeskData) {
    data = result;
    const selected = filter.value;
    filter.replaceChildren(new Option('All essays', ''), ...result.posts.map(({ id, title }) => new Option(title, id)));
    if (result.posts.some(({ id }) => id === selected)) filter.value = selected;
    posts.replaceChildren(...result.posts.map(({ id, title, total, stanceTotal }) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      const titleNode = document.createElement('span');
      const countNode = document.createElement('span');
      button.type = 'button';
      button.className = 'response-desk__post';
      button.dataset.deskSelect = id;
      titleNode.textContent = title;
      countNode.textContent = `${namedCount(total)} · ${namedVotes(stanceTotal)}`;
      button.append(titleNode, countNode);
      row.append(button);
      return row;
    }));
    postsEmpty.hidden = result.posts.length > 0;
    login.hidden = true;
    signOut.hidden = false;
    content.hidden = false;
    updateView();
    showFeature();
  }

  async function changeFeature(method: 'PUT' | 'DELETE', payload?: object) {
    if (!data || featurePending) return;
    featurePending = true;
    featurePublish.disabled = true;
    featureRemove.disabled = true;
    featureCancel.disabled = true;
    try {
      const response = await fetch(featureEndpoint, {
        method,
        ...(payload && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      });
      if (response.status === 401) {
        showLogin(true);
        tell('Sign in again to change the featured note.');
        return;
      }
      const result: MonthlyResult = await response.json();
      if (!response.ok || !result.ok || !result.month) {
        tell(result.message ?? 'The featured note didn’t change. Try again.', true);
        return;
      }
      if (!data) return;
      data.month = result.month;
      data.featuredNote = result.featuredNote ?? null;
      closeFeatureEditor();
      showFeature();
      featureHeading.focus({ preventScroll: true });
      tell(method === 'PUT' ? 'The approved excerpt is on the home page.' : 'This month’s note is off the home page.');
    } catch {
      tell('The featured note didn’t change. Try again.', true);
    } finally {
      featurePending = false;
      featurePublish.disabled = false;
      featureRemove.disabled = false;
      featureCancel.disabled = false;
    }
  }

  async function loadDesk(focus = false) {
    tell('Opening the response book…');
    try {
      const response = await fetch(deskEndpoint, { cache: 'no-store' });
      if (response.status === 401) {
        tell('');
        showLogin();
        return;
      }
      const result: DeskData | ActionResult = await response.json();
      if (response.ok && result.ok && 'posts' in result) {
        tell('');
        revealDesk(result);
        if (focus) filter.focus();
      } else {
        clearDesk();
        login.hidden = response.status === 503;
        tell('message' in result && result.message ? result.message : 'The response desk didn’t open. Refresh to try again.', true);
      }
    } catch {
      clearDesk();
      login.hidden = false;
      tell('The response desk didn’t open. Try again in a moment.', true);
    }
  }

  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginButton.disabled) return;
    const value = password.value;
    password.value = '';
    loginButton.disabled = true;
    tell('Signing in…');
    try {
      const response = await fetch(sessionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      });
      if (response.ok) {
        await loadDesk(true);
      } else {
        const result: ActionResult = await response.json();
        tell(result.message ?? 'That sign-in didn’t go through. Try again.', true);
        password.focus();
      }
    } catch {
      tell('That sign-in didn’t go through. Try again.', true);
    } finally {
      loginButton.disabled = false;
    }
  });

  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const response = await fetch(sessionEndpoint, { method: 'DELETE' });
      if (!response.ok && response.status !== 401) throw new Error('Sign-out failed');
      showLogin(true);
      tell('You’re signed out.');
    } catch {
      tell('Couldn’t sign out. Try again in a moment.', true);
    } finally {
      signOut.disabled = false;
    }
  });

  filter.addEventListener('change', updateView);
  keptOnly.addEventListener('change', updateNotes);
  posts.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-desk-select]') : null;
    if (!target?.dataset.deskSelect) return;
    filter.value = filter.value === target.dataset.deskSelect ? '' : target.dataset.deskSelect;
    updateView();
  });

  notes.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-desk-pin], [data-desk-feature]') : null;
    const note = data?.responses.find(({ id }) => String(id) === target?.dataset.responseId);
    if (!target || !note || target.disabled) return;
    if (target.hasAttribute('data-desk-feature')) {
      if (!note.featureConsent || !note.note || featurePending) return;
      closeFeatureEditor();
      featureDraft = note;
      featureSourceTitle.textContent = data?.posts.find(({ id }) => id === note.postId)?.title ?? note.postId;
      featureSource.textContent = note.note;
      featureForm.hidden = false;
      featureExcerpt.focus();
      return;
    }
    target.disabled = true;
    const pinned = !note.pinned;
    try {
      const response = await fetch(deskEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id, pinned }),
      });
      if (response.status === 401) {
        showLogin(true);
        tell('Sign in again to keep a quote.');
        return;
      }
      const result: ActionResult = await response.json();
      if (!response.ok || !result.ok) {
        tell(result.message ?? 'That quote couldn’t be updated. Try again.', true);
        return;
      }
      note.pinned = pinned;
      if (keptOnly.checked && !pinned) {
        updateNotes();
        notesHeading.focus({ preventScroll: true });
      } else {
        target.setAttribute('aria-pressed', String(pinned));
      }
      tell(pinned ? 'Quote kept.' : 'Quote removed from the kept list.');
    } catch {
      tell('That quote couldn’t be updated. Try again.', true);
    } finally {
      target.disabled = false;
    }
  });

  featureForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!featureDraft) return;
    const fields = new FormData(featureForm);
    void changeFeature('PUT', {
      id: featureDraft.id,
      postId: featureDraft.postId,
      excerpt: fields.get('excerpt'),
      confirmed: fields.has('confirmed'),
    });
  });
  featureRemove.addEventListener('click', () => { void changeFeature('DELETE'); });
  featureCancel.addEventListener('click', () => {
    const id = featureDraft?.id;
    closeFeatureEditor();
    const button = notes.querySelector<HTMLButtonElement>(`[data-desk-feature][data-response-id="${id}"]`);
    (button ?? featureHeading).focus();
  });

  window.addEventListener('pagehide', () => {
    if (data) clearDesk();
    password.value = '';
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void loadDesk();
  });
  void loadDesk();
}

const desk = document.querySelector<HTMLElement>('[data-response-desk]');
if (desk) setupDesk(desk);
