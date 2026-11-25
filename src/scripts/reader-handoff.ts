import { copyText } from '../lib/clipboard';

export function initReaderHandoff(reader: HTMLElement, title: string, passageLink: () => string, signal: AbortSignal) {
  const dialog = reader.querySelector<HTMLDialogElement>('[data-reader-handoff]');
  const open = reader.querySelector<HTMLButtonElement>('[data-reader-handoff-open]');
  const field = dialog?.querySelector<HTMLTextAreaElement>('textarea');
  const copy = dialog?.querySelector<HTMLButtonElement>('[data-reader-handoff-copy]');
  const share = dialog?.querySelector<HTMLButtonElement>('[data-reader-handoff-share]');
  const status = dialog?.querySelector<HTMLElement>('[role="status"]');
  if (!dialog || typeof dialog.showModal !== 'function' || !open || !field || !copy || !share || !status) return;

  const settings = open.closest('details');
  const returnFocus = settings?.querySelector('summary') ?? open;
  open.hidden = false;
  share.hidden = typeof navigator.share !== 'function';

  open.addEventListener('click', () => {
    field.value = passageLink();
    status.textContent = '';
    if (settings) settings.open = false;
    dialog.showModal();
  }, { signal });

  copy.addEventListener('click', async () => {
    const copied = await copyText(field.value, dialog);
    status.textContent = copied ? 'Link copied.' : 'The link is selected for copying.';
  }, { signal });

  share.addEventListener('click', async () => {
    try {
      await navigator.share({ title, url: field.value });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status.textContent = 'Sharing didn’t open. You can copy the link instead.';
    }
  }, { signal });

  dialog.addEventListener('close', () => returnFocus.focus({ preventScroll: true }), { signal });
  signal.addEventListener('abort', () => {
    if (dialog.open) dialog.close();
  }, { once: true });
}
