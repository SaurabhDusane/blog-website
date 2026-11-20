import { diffLines } from 'diff';
import { micromark } from 'micromark';

type Draft = { slug: string; title: string; description: string; body: string; documentKey: string | null; filename: string | null };
type Revision = Draft & { id: number; createdAt: string; topics: string[]; mood: string };
type HistoryEntry = Pick<Revision, 'id' | 'title' | 'createdAt'>;
type Entry = { slug: string; title: string; id: number; liveRevision: number | null };
type Details = { revision: Revision; latest: number; live?: Revision; history: HistoryEntry[]; nextBefore: number | null };
type VoiceNote = { src: string; audioKey: string; transcript: string };

const endpoint = '/api/admin/publishing/';
const session = '/api/admin/session/';
const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const blank = (): Draft => ({ slug: '', title: '', description: '', body: '', documentKey: null, filename: null });

class DeskError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = 'GET', data?: Record<string, unknown> | File): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(data instanceof File ? { body: data, headers: { 'Content-Type': 'application/octet-stream' } }
      : data ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new DeskError(result?.message ?? 'The desk is briefly closed. Try again shortly.', response.status);
  return result;
}

function essaySlug(title: string) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-|-$/g, '');
}

function report(element: HTMLElement, message: string, error = false) {
  element.textContent = message;
  element.toggleAttribute('data-error', error);
}

function updateOptions(select: HTMLSelectElement, options: [string, string][], placeholder: string) {
  const selected = select.value;
  select.replaceChildren(new Option(placeholder, ''), ...options.map(([value, label]) => new Option(label, value)));
  select.value = [...select.options].some(({ value }) => value === selected) ? selected : '';
}

function sectionUrl(slug: string, revision?: number, before?: number) {
  const params = new URLSearchParams({ post: slug });
  if (revision) params.set('revision', String(revision));
  if (before) params.set('before', String(before));
  return `${endpoint}?${params}`;
}

async function upload(file: File, kind: 'document' | 'audio') {
  const query = new URLSearchParams({ kind, filename: file.name });
  const { key } = await request<{ key: string }>(`${endpoint}upload/?${query}`, 'POST', file);
  return key;
}

function init(root: HTMLElement) {
  const get = <T extends Element>(name: string) => root.querySelector<T>(`[data-desk-${name}]`)!;
  const status = get<HTMLElement>('status');
  const content = get<HTMLElement>('content');
  const login = get<HTMLFormElement>('login');
  const logout = get<HTMLButtonElement>('logout');
  const entries = get<HTMLSelectElement>('entries');
  const editor = get<HTMLFormElement>('editor');
  const title = editor.elements.namedItem('title') as HTMLInputElement;
  const slug = editor.elements.namedItem('slug') as HTMLInputElement;
  const description = editor.elements.namedItem('description') as HTMLTextAreaElement;
  const body = editor.elements.namedItem('body') as HTMLTextAreaElement;
  const documentField = get<HTMLInputElement>('document');
  const importButton = get<HTMLButtonElement>('import');
  const publish = get<HTMLButtonElement>('publish');
  const save = editor.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const liveLink = get<HTMLAnchorElement>('live');
  const history = get<HTMLDetailsElement>('history');
  const historyList = get<HTMLElement>('history-list');
  const older = get<HTMLButtonElement>('history-next');
  const restore = get<HTMLButtonElement>('restore');
  const withdraw = get<HTMLButtonElement>('withdraw');
  const original = get<HTMLAnchorElement>('original');
  const mobile = get<HTMLButtonElement>('mobile');
  const preview = get<HTMLElement>('preview');
  const previewBody = get<HTMLElement>('preview-body');
  const editorStatus = get<HTMLElement>('editor-status');
  const reviewLinks = get<HTMLButtonElement>('links');
  const linkList = get<HTMLElement>('link-list');
  const linkStatus = get<HTMLElement>('link-status');
  const voice = get<HTMLFormElement>('voice');
  const voicePost = voice.elements.namedItem('post') as HTMLSelectElement;
  const audio = voice.elements.namedItem('audio') as HTMLInputElement;
  const transcript = voice.elements.namedItem('transcript') as HTMLTextAreaElement;
  const player = get<HTMLAudioElement>('voice-player');
  const removeVoice = get<HTMLButtonElement>('voice-remove');
  const voiceStatus = get<HTMLElement>('voice-status');

  let pendingDocument: File | null = null;
  let detail: Details | undefined;
  let snapshot = blank();
  let busy = false;
  let voiceBusy = false;
  let currentVoice: VoiceNote | null = null;
  let previewTimer = 0;
  let topicLabels: Record<string, string> = {};

  const draft = (): Draft => ({
    title: title.value, slug: slug.value, description: description.value, body: body.value,
    documentKey: snapshot.documentKey, filename: snapshot.filename,
  });
  const dirty = () => Boolean(pendingDocument || JSON.stringify(draft()) !== JSON.stringify({
    title: snapshot.title, slug: snapshot.slug, description: snapshot.description, body: snapshot.body,
    documentKey: snapshot.documentKey, filename: snapshot.filename,
  }));
  const historical = () => Boolean(detail && detail.revision.id !== detail.latest);

  function setEditorControls() {
    entries.disabled = busy;
    importButton.disabled = busy || historical();
    save.disabled = busy || historical() || (!!detail && !dirty());
    publish.disabled = busy || !detail || historical() || dirty() || detail.live?.id === detail.revision.id;
    restore.disabled = withdraw.disabled = older.disabled = busy;
    for (const field of [title, description, body]) field.readOnly = busy || historical();
    slug.readOnly = busy || Boolean(detail);
  }

  function renderPreview() {
    get<HTMLElement>('preview-title').textContent = title.value.trim() || 'Untitled essay';
    get<HTMLElement>('preview-description').textContent = description.value.trim();
    previewBody.innerHTML = body.value.trim() ? micromark(body.value) : '<p>The preview will appear as you write.</p>';
    const base = new URL(`/posts/${essaySlug(slug.value || title.value) || 'draft'}/`, location.origin);
    for (const link of previewBody.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (!href || href.startsWith('#')) continue;
      link.dataset.reviewHref = href;
      try { link.href = new URL(href, base).href; } catch { link.removeAttribute('href'); }
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    const before = detail?.live;
    const diff = get<HTMLElement>('diff');
    diff.replaceChildren();
    const changes = get<HTMLElement>('diff-status');
    if (!before) { changes.textContent = 'Publish a draft to start comparing.'; return; }
    const previous = [before.title, before.description, before.body].join('\n\n');
    const current = [title.value, description.value, body.value].join('\n\n');
    if (previous === current) { changes.textContent = 'The text matches the live essay.'; return; }
    const delta = diffLines(previous, current, { timeout: 100 });
    changes.textContent = delta ? 'Underlined lines were added. Crossed-out lines were removed.' : 'The full draft differs from the live essay.';
    if (!delta) return;
    for (const part of delta) {
      const node = document.createElement(part.added ? 'ins' : part.removed ? 'del' : 'span');
      node.textContent = part.value;
      diff.append(node);
    }
  }

  function renderHistory(items: HistoryEntry[], append = false) {
    if (!append) historyList.replaceChildren();
    for (const version of items) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-link';
      button.textContent = `Version ${version.id} · ${formatDate.format(new Date(version.createdAt))}`;
      if (detail?.revision.id === version.id) button.setAttribute('aria-current', 'true');
      const notes = [detail?.latest === version.id ? 'Latest' : '', detail?.live?.id === version.id ? 'Live' : ''].filter(Boolean).join(' · ');
      row.append(button, notes ? ` ${notes}` : '');
      button.addEventListener('click', () => {
        if (!mayDiscard()) return;
        void work(editorStatus, async () => open(snapshot.slug, version.id));
      });
      historyList.append(row);
    }
  }

  function loadDraft(value?: Details) {
    detail = value;
    snapshot = value?.revision ?? blank();
    pendingDocument = null;
    documentField.value = '';
    title.value = snapshot.title;
    slug.value = snapshot.slug;
    description.value = snapshot.description;
    body.value = snapshot.body;
    entries.value = snapshot.slug;
    history.hidden = !value;
    restore.hidden = !historical();
    older.hidden = !value?.nextBefore;
    withdraw.hidden = !value?.live;
    liveLink.hidden = !value?.live;
    liveLink.href = `/posts/${snapshot.slug}/`;
    original.hidden = !value?.revision.documentKey;
    original.href = value ? `${sectionUrl(snapshot.slug, value.revision.id)}&download=1` : '#';
    get<HTMLElement>('entry-status').textContent = historical() ? 'Viewing an earlier version.'
      : value ? value.live?.id === value.revision.id ? 'Live on Second Ink.' : 'Saved as a private draft.' : '';
    get<HTMLElement>('filename').textContent = snapshot.filename ? `Original file · ${snapshot.filename}` : '';
    const sorting = get<HTMLElement>('sorting');
    sorting.hidden = !value;
    if (value) {
      const { topics, mood } = value.revision;
      const names = topics.map((id) => topicLabels[id] ?? id);
      sorting.textContent = names.length ? `Sorted automatically · ${[...names, mood].join(' · ')}` : `Mood · ${mood}`;
    }
    linkList.replaceChildren();
    report(linkStatus, '');
    renderHistory(value?.history ?? []);
    renderPreview();
    setEditorControls();
  }

  async function open(post: string, version?: number) {
    loadDraft(post ? await request<Details>(sectionUrl(post, version)) : undefined);
  }

  function mayDiscard() {
    return !busy && (!dirty() || window.confirm('Leave this draft without saving your changes?'));
  }

  async function refreshShelf() {
    const { entries: list, voicePosts, essayTopics } = await request<{ entries: Entry[]; voicePosts: [string, string][]; essayTopics: Record<string, string> }>(endpoint);
    topicLabels = essayTopics;
    updateOptions(entries, list.map(({ slug, title, id, liveRevision }) => [slug, `${title} · ${id === liveRevision ? 'Live' : 'Draft'}`]), 'New essay');
    const previous = voicePost.value;
    updateOptions(voicePost, voicePosts, 'Choose an essay');
    if (voicePost.value !== previous) loadVoice();
    report(status, '');
    login.hidden = true;
    content.hidden = false;
  }

  function showError(target: HTMLElement, reason: unknown) {
    if (reason instanceof DeskError && reason.status === 401) {
      content.hidden = true;
      login.hidden = false;
      report(status, target === status ? '' : 'Sign in again to keep working.');
    } else report(target, reason instanceof Error ? reason.message : 'Try again shortly.', true);
  }

  async function work(target: HTMLElement, action: () => Promise<void>) {
    if (busy) return;
    report(target, '');
    busy = true;
    setEditorControls();
    try { await action(); } catch (reason) { showError(target, reason); }
    finally { busy = false; setEditorControls(); }
  }

  function loadVoice() {
    currentVoice = null;
    const post = voicePost.value;
    transcript.value = '';
    audio.value = '';
    player.hidden = removeVoice.hidden = true;
    player.removeAttribute('src');
    player.load();
    report(voiceStatus, '');
    if (!post) return;
    void request<{ note: VoiceNote | null }>(`${endpoint}voice/?post=${post}`).then(({ note }) => {
      if (voicePost.value !== post || !note) return;
      currentVoice = note;
      player.src = note.src;
      player.hidden = removeVoice.hidden = false;
      transcript.value = note.transcript;
    }).catch((reason) => { if (voicePost.value === post) showError(voiceStatus, reason); });
  }

  async function workVoice(action: (post: string) => Promise<void>) {
    if (voiceBusy || !voicePost.value) return;
    voiceBusy = true;
    const submit = voice.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = removeVoice.disabled = voicePost.disabled = true;
    try { await action(voicePost.value); } catch (reason) { showError(voiceStatus, reason); }
    finally { voiceBusy = false; submit.disabled = removeVoice.disabled = voicePost.disabled = false; }
  }

  login.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = new FormData(login).get('password');
    if (typeof password !== 'string') return;
    const button = login.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true;
    void request(session, 'POST', { password }).then(() => {
      login.reset();
      return refreshShelf();
    }).catch((reason) => report(status, reason.message, true)).finally(() => { button.disabled = false; });
  });
  logout.addEventListener('click', () => {
    if (!mayDiscard()) return;
    void work(status, async () => {
      await request(session, 'DELETE');
      window.location.reload();
    });
  });
  entries.addEventListener('change', () => {
    if (!mayDiscard()) { entries.value = snapshot.slug; return; }
    void work(editorStatus, async () => open(entries.value));
  });
  editor.addEventListener('input', () => {
    setEditorControls();
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, 140);
  });
  title.addEventListener('blur', () => {
    if (!detail && !slug.value) slug.value = essaySlug(title.value);
  });
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (historical()) return;
    void work(editorStatus, async () => {
      const data = draft();
      if (pendingDocument) {
        report(editorStatus, 'Keeping the original with your draft…');
        data.documentKey = await upload(pendingDocument, 'document');
        data.filename = pendingDocument.name;
      }
      await request(endpoint, 'POST', { ...data, base: detail?.latest ?? 0 });
      await refreshShelf();
      await open(data.slug);
      report(editorStatus, 'Draft saved.');
    });
  });
  importButton.addEventListener('click', () => {
    const file = documentField.files?.[0];
    if (!file) { report(editorStatus, 'Choose a Word document or PDF first.', true); return; }
    if (body.value.trim() && !window.confirm('Replace the current draft text with this document?')) return;
    void work(editorStatus, async () => {
      report(editorStatus, 'Reading the document in your browser…');
      const { importDeskDocument } = await import('../lib/desk-import');
      const imported = await importDeskDocument(file);
      title.value = imported.title;
      description.value = imported.description;
      body.value = imported.body;
      if (!slug.value) slug.value = essaySlug(imported.title);
      pendingDocument = file;
      get<HTMLElement>('filename').textContent = `Original file · ${file.name}`;
      renderPreview();
      report(editorStatus, 'Text imported. Read through the preview, then save the draft.');
    });
  });
  publish.addEventListener('click', () => {
    if (!detail || dirty()) return;
    const { slug, id } = detail.revision;
    void work(editorStatus, async () => {
      await request(endpoint, 'PATCH', { action: 'publish', slug, revision: id });
      await refreshShelf();
      await open(slug);
      report(editorStatus, 'The essay is live on Second Ink.');
    });
  });
  restore.addEventListener('click', () => {
    if (!detail || !historical()) return;
    const { slug, id } = detail.revision;
    void work(editorStatus, async () => {
      await request(endpoint, 'PATCH', { action: 'restore', slug, revision: id, base: detail?.latest });
      await refreshShelf();
      await open(slug);
      report(editorStatus, 'That version is now your latest draft.');
    });
  });
  withdraw.addEventListener('click', () => {
    if (!detail?.live || !mayDiscard() || !window.confirm('Take this essay down? Its versions will stay on the desk.')) return;
    const { slug, id } = detail.live;
    void work(editorStatus, async () => {
      await request(endpoint, 'PATCH', { action: 'withdraw', slug, revision: id });
      await refreshShelf();
      await open(slug);
      report(editorStatus, 'The essay is back on the desk.');
    });
  });
  older.addEventListener('click', () => {
    if (!detail?.nextBefore) return;
    void work(editorStatus, async () => {
      if (!detail) return;
      const page = await request<Details>(sectionUrl(snapshot.slug, detail.revision.id, detail.nextBefore ?? undefined));
      renderHistory(page.history, true);
      detail.nextBefore = page.nextBefore;
      older.hidden = !page.nextBefore;
    });
  });
  mobile.addEventListener('click', () => {
    const enabled = preview.toggleAttribute('data-phone');
    mobile.setAttribute('aria-pressed', String(enabled));
  });
  reviewLinks.addEventListener('click', () => {
    renderPreview();
    const links = [...previewBody.querySelectorAll<HTMLAnchorElement>('a')];
    linkList.replaceChildren();
    if (!links.length) { report(linkStatus, 'There are no links in this draft.'); return; }
    void work(linkStatus, async () => {
      const hrefs = links.slice(0, 100).map((link) => link.dataset.reviewHref ?? link.getAttribute('href') ?? '');
      const { results } = await request<{ results: string[] }>(`${endpoint}links/`, 'POST', { links: hrefs, post: slug.value });
      for (const [index, outcome] of results.entries()) {
        const row = document.createElement('li');
        const link = links[index];
        if (outcome === 'invalid' || outcome === 'missing') {
          row.textContent = `${link.textContent || 'Empty link'} · ${outcome === 'missing' ? 'Page missing' : 'Check this address'} `;
          const position = hrefs[index] ? body.value.indexOf(hrefs[index]) : -1;
          if (position >= 0 && !historical()) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'text-link';
            edit.textContent = 'Go to link';
            edit.addEventListener('click', () => {
              body.focus();
              body.setSelectionRange(position, position + hrefs[index].length);
            });
            row.append(edit);
          }
        } else {
          const copy = link.cloneNode(true) as HTMLAnchorElement;
          if (!copy.getAttribute('href')?.startsWith('#')) row.append(copy);
          else row.append(copy.textContent ?? 'Section link');
          row.append(outcome === 'found' ? ' · Page found' : ' · Open to review');
        }
        linkList.append(row);
      }
      report(linkStatus, `${results.length} ${results.length === 1 ? 'link' : 'links'} reviewed${links.length > results.length ? ' (first 100 shown)' : ''}.`);
    });
  });
  voicePost.addEventListener('change', loadVoice);
  voice.addEventListener('submit', (event) => {
    event.preventDefault();
    const file = audio.files?.[0];
    const words = transcript.value;
    void workVoice(async (post) => {
      if (!file && !currentVoice) { report(voiceStatus, 'Choose a recording first.', true); return; }
      if (file && file.size > 16 * 1024 * 1024) { report(voiceStatus, 'Choose a recording up to 16 MiB.', true); return; }
      report(voiceStatus, 'Saving the recording…');
      const audioKey = file ? await upload(file, 'audio') : currentVoice?.audioKey;
      await request(`${endpoint}voice/?post=${post}`, 'PUT', { audioKey, transcript: words });
      currentVoice = { audioKey: audioKey!, transcript: words, src: `/api/voice-note/?post=${post}&audio=1` };
      player.src = currentVoice.src;
      player.hidden = removeVoice.hidden = false;
      audio.value = '';
      report(voiceStatus, 'Voice note is live.');
    });
  });
  removeVoice.addEventListener('click', () => {
    if (!window.confirm('Remove this voice note from the essay?')) return;
    void workVoice(async (post) => {
      await request(`${endpoint}voice/?post=${post}`, 'DELETE');
      loadVoice();
      report(voiceStatus, 'Voice note removed.');
    });
  });

  loadDraft();
  void refreshShelf().catch((reason) => showError(status, reason));
}

const desk = document.querySelector<HTMLElement>('[data-publishing-desk]');
if (desk) init(desk);
