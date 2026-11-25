interface DigestComposition {
  subject: string;
  introduction: string;
  posts: string[];
}

interface DigestPreview { id: string; subject: string; body: string }
interface DeliveryCounts { queued: number; sent: number; skipped: number; review: number }
interface DeliveryResult extends DeliveryCounts { id: string; processed: number; paused: boolean }
interface DigestSummary extends DeliveryCounts { id: string; subject: string; approvedAt: number }
interface DeskSummary {
  enabled: boolean;
  counts: { confirmed: number; pending: number; legacy: number };
  posts: { id: string; title: string }[];
  digests: DigestSummary[];
}

class DeskError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const endpoint = '/api/admin/newsletter/';
const sessionEndpoint = '/api/admin/session/';
const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

async function request<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  try {
    const response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      const message = typeof result?.message === 'string' ? result.message : 'The newsletter desk is unavailable. Try again in a moment.';
      throw new DeskError(message, response.status);
    }
    return result as T;
  } catch (error) {
    if (error instanceof DeskError) throw error;
    throw new DeskError('The newsletter desk is unavailable. Try again in a moment.', 0);
  }
}

function deliveryStatus({ sent, queued, skipped, review }: DeliveryCounts): string {
  const parts = [`${sent} sent`];
  if (queued) parts.push(`${queued} queued`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (review) parts.push(`${review} need review`);
  return parts.join(' · ');
}

function setup(root: HTMLElement) {
  const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  const login = find<HTMLFormElement>('[data-newsletter-login]');
  const password = find<HTMLInputElement>('#newsletter-password');
  const loginButton = login.querySelector('button')!;
  const logout = find<HTMLButtonElement>('[data-newsletter-logout]');
  const status = find<HTMLElement>('[data-newsletter-status]');
  const content = find<HTMLElement>('[data-newsletter-content]');
  const compose = find<HTMLFormElement>('[data-newsletter-compose]');
  const composeFields = find<HTMLFieldSetElement>('[data-compose-fields]');
  const subject = find<HTMLInputElement>('#newsletter-subject');
  const posts = find<HTMLElement>('[data-newsletter-posts]');
  const previewButton = find<HTMLButtonElement>('[data-newsletter-preview-button]');
  const preview = find<HTMLElement>('[data-newsletter-preview]');
  const send = find<HTMLButtonElement>('[data-newsletter-send]');
  const recent = find<HTMLElement>('[data-newsletter-recent]');
  let summary: DeskSummary | undefined;
  let approved: { input: DigestComposition; previewId: string } | undefined;
  let busy = false;

  function tell(message: string, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }

  function updateControls() {
    loginButton.disabled = busy;
    logout.disabled = busy;
    composeFields.disabled = busy;
    previewButton.disabled = busy || !summary?.posts.length;
    send.disabled = busy || !approved || !summary?.enabled || !summary.counts.confirmed;
    for (const button of recent.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy || !summary?.enabled;
  }

  function closePreview() {
    approved = undefined;
    preview.hidden = true;
    find<HTMLElement>('[data-preview-subject]').textContent = '';
    find<HTMLElement>('[data-preview-body]').textContent = '';
    find<HTMLElement>('[data-preview-audience]').textContent = '';
    updateControls();
  }

  function closeDesk() {
    content.hidden = true;
    summary = undefined;
    logout.hidden = true;
    login.hidden = false;
    compose.reset();
    closePreview();
    posts.replaceChildren();
    recent.replaceChildren();
  }

  function renderDesk(value: DeskSummary) {
    summary = value;
    for (const kind of ['confirmed', 'pending', 'legacy'] as const) {
      find<HTMLElement>(`[data-subscription-${kind}]`).textContent = value.counts[kind].toLocaleString();
    }
    find<HTMLElement>('[data-newsletter-availability]').textContent = value.enabled
      ? '' : 'Email delivery needs to be configured. You can still preview a digest.';

    const selected = new Set([...posts.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value));
    posts.replaceChildren(...value.posts.map(({ id, title }) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      const name = document.createElement('span');
      checkbox.type = 'checkbox';
      checkbox.name = 'posts';
      checkbox.value = id;
      checkbox.checked = selected.has(id);
      name.textContent = title;
      label.append(checkbox, name);
      return label;
    }));
    find<HTMLElement>('[data-newsletter-no-posts]').hidden = value.posts.length > 0;

    recent.replaceChildren(...value.digests.map((digest) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = digest.subject;
      const date = document.createElement('time');
      const approvedDate = new Date(digest.approvedAt);
      date.dateTime = approvedDate.toISOString();
      date.textContent = formatDate.format(approvedDate);
      const progress = document.createElement('p');
      progress.textContent = deliveryStatus(digest);
      item.append(title, ' · ', date, progress);
      if (digest.queued > 0) {
        const resume = document.createElement('button');
        resume.type = 'button';
        resume.className = 'newsletter-desk__link';
        resume.textContent = 'Continue sending';
        resume.setAttribute('aria-label', `Continue sending ${digest.subject}`);
        resume.addEventListener('click', () => void deliver({ action: 'continue', id: digest.id }));
        item.append(resume);
      }
      return item;
    }));
    find<HTMLElement>('[data-newsletter-no-sends]').hidden = value.digests.length > 0;
    login.hidden = true;
    logout.hidden = false;
    content.hidden = false;
    updateControls();
  }

  async function run(task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    updateControls();
    try {
      await task();
    } catch (error) {
      if (error instanceof DeskError && error.status === 401) closeDesk();
      tell(error instanceof DeskError ? error.message : 'The newsletter desk could not complete that request.', true);
    } finally {
      busy = false;
      updateControls();
    }
  }

  async function deliver(action: Record<string, unknown>) {
    await run(async () => {
      tell('Sending the approved digest…');
      const first = await request<DeliveryResult>(endpoint, 'POST', action);
      closePreview();
      status.focus();
      let latest = first;
      while (latest.queued > 0 && latest.processed > 0 && !latest.paused) {
        tell(deliveryStatus(latest));
        const next = await request<DeliveryResult>(endpoint, 'POST', { action: 'continue', id: first.id });
        const progressed = next.queued < latest.queued;
        latest = next;
        if (!progressed) break;
      }
      renderDesk(await request<DeskSummary>(endpoint));
      const message = deliveryStatus(latest);
      if (latest.queued > 0) {
        tell(`${message}. Use Continue sending after a minute to try the remaining deliveries.`, latest.paused);
      } else {
        tell(`Digest processing finished. ${message}.`);
      }
    });
  }

  login.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const input = password.value;
    password.value = '';
    void run(async () => {
      tell('Signing in…');
      await request(sessionEndpoint, 'POST', { password: input });
      renderDesk(await request<DeskSummary>(endpoint));
      tell('');
    }).then(() => (content.hidden ? password : subject).focus());
  });

  logout.addEventListener('click', () => void run(async () => {
    await request(sessionEndpoint, 'DELETE');
    closeDesk();
    tell('You’re signed out.');
    password.focus();
  }));

  compose.addEventListener('input', closePreview);
  compose.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(compose);
    const input: DigestComposition = {
      subject: String(form.get('subject') ?? '').trim(),
      introduction: String(form.get('introduction') ?? '').trim(),
      posts: form.getAll('posts').map(String),
    };
    if (input.posts.length < 1 || input.posts.length > 8) {
      tell('Choose one to eight published essays for the digest.', true);
      posts.querySelector('input')?.focus();
      return;
    }
    void run(async () => {
      closePreview();
      tell('Preparing a preview…');
      const { preview: draft } = await request<{ preview: DigestPreview }>(endpoint, 'POST', { action: 'preview', ...input });
      approved = { input, previewId: draft.id };
      find<HTMLElement>('[data-preview-subject]').textContent = draft.subject;
      find<HTMLElement>('[data-preview-body]').textContent = draft.body;
      const confirmed = summary?.counts.confirmed ?? 0;
      find<HTMLElement>('[data-preview-audience]').textContent = !summary?.enabled
        ? 'Email delivery is unavailable until a sender is configured.'
        : confirmed === 0 ? 'There are no confirmed subscribers yet.'
        : `${confirmed.toLocaleString()} confirmed ${confirmed === 1 ? 'subscriber' : 'subscribers'}.`;
      preview.hidden = false;
      tell('');
      find<HTMLElement>('#newsletter-preview-title').focus();
    });
  });

  send.addEventListener('click', () => {
    if (busy || !approved || send.disabled) return;
    void deliver({ action: 'send', previewId: approved.previewId, ...approved.input });
  });

  void run(async () => {
    tell('Opening the newsletter desk…');
    try {
      renderDesk(await request<DeskSummary>(endpoint));
      tell('');
    } catch (error) {
      if (!(error instanceof DeskError) || error.status !== 401) throw error;
      closeDesk();
      tell('Sign in to open the newsletter desk.');
    }
  });
}

const root = document.querySelector<HTMLElement>('[data-newsletter-desk]');
if (root) setup(root);
