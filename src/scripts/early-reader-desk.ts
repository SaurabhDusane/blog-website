import { copyText } from '../lib/clipboard';

type Invitation = { id: number; label: string; expiresAt: number; revokedAt: number | null; note: string | null };
const endpoint = '/api/admin/early-readers/';
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function setupEarlyReaderDesk(root: HTMLElement) {
  const panel = root.querySelector<HTMLDetailsElement>('[data-early-desk]')!;
  const form = panel.querySelector<HTMLFormElement>('form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  const status = panel.querySelector<HTMLElement>('[data-early-status]')!;
  const list = panel.querySelector<HTMLUListElement>('[data-early-list]')!;
  const link = panel.querySelector<HTMLElement>('[data-early-link]')!;
  const address = link.querySelector<HTMLInputElement>('input')!;
  const access = panel.querySelector<HTMLElement>('[data-early-access]')!;
  const version = panel.querySelector<HTMLElement>('[data-early-version]')!;
  let revision: number | undefined;
  let dirty = false;
  let busy = false;
  let requestNumber = 0;

  async function call<T>(method: string, value?: Record<string, unknown>) {
    const response = await fetch(method === 'GET' ? `${endpoint}?revision=${revision}` : endpoint, {
      method,
      ...(value ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, ...value }) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Error(data?.message || 'The draft review is briefly unavailable.');
    return data as T;
  }

  async function refresh() {
    if (!revision || !panel.open) return;
    const request = ++requestNumber;
    try {
      const { invites, externalReview } = await call<{ invites: Invitation[]; externalReview: boolean }>('GET');
      if (request !== requestNumber) return;
      access.textContent = externalReview ? 'Anyone with a valid link can read only this version.'
        : location.protocol === 'http:' ? 'Test this link in another browser on this computer.'
          : 'These links use this site’s sign-in. Guest access requires a connected review page.';
      list.replaceChildren(...invites.map((invite) => {
        const item = document.createElement('li');
        const label = document.createElement('strong');
        const details = document.createElement('p');
        label.textContent = invite.label;
        const active = !invite.revokedAt && Date.now() < invite.expiresAt;
        details.textContent = invite.revokedAt ? 'Link closed' : active ? `Open until ${date.format(invite.expiresAt)}` : 'Expired';
        item.append(label, details);
        if (invite.note) {
          const note = document.createElement('blockquote');
          note.textContent = invite.note;
          item.append(note);
        }
        if (active) {
          const revoke = document.createElement('button');
          revoke.className = 'text-link';
          revoke.type = 'button';
          revoke.textContent = 'Close link';
          revoke.setAttribute('aria-label', `Close link for ${invite.label}`);
          revoke.addEventListener('click', async () => {
            const original = revision;
            revoke.disabled = true;
            try {
              await call('DELETE', { invite: invite.id });
              if (revision !== original) return;
              link.hidden = true;
              address.value = '';
              status.textContent = 'Link closed.';
              await refresh();
              button.focus();
            } catch (reason) {
              if (revision === original) status.textContent = (reason as Error).message;
              revoke.disabled = false;
            }
          });
          item.append(revoke);
        }
        return item;
      }));
    } catch (reason) {
      if (request === requestNumber) status.textContent = (reason as Error).message;
    }
  }

  function controls() { button.disabled = !revision || dirty || busy; }
  panel.addEventListener('toggle', () => void refresh());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!revision || dirty || busy) return;
    const original = revision;
    const values = new FormData(form);
    busy = true;
    controls();
    try {
      const created = await call<{ href: string }>('POST', { label: values.get('label'), days: Number(values.get('days')) });
      if (revision !== original) return;
      address.value = created.href;
      link.hidden = false;
      status.textContent = 'The review link is ready.';
      await refresh();
      address.focus();
      address.select();
    } catch (reason) {
      if (revision === original) status.textContent = (reason as Error).message;
    } finally { busy = false; controls(); }
  });
  panel.querySelector('[data-early-copy]')?.addEventListener('click', async () => {
    if (await copyText(address.value, null)) status.textContent = 'Link copied.';
    else { address.focus(); address.select(); status.textContent = 'Select and copy this link.'; }
  });
  return {
    show(id?: number) {
      if (id === revision) return;
      ++requestNumber;
      revision = id;
      panel.hidden = !id;
      version.textContent = id ? `Review copy of saved version ${id}.` : '';
      link.hidden = true;
      address.value = '';
      status.textContent = '';
      list.replaceChildren();
      form.reset();
      controls();
      void refresh();
    },
    edited(value: boolean) { dirty = value; controls(); },
  };
}
