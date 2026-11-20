import { readerIdentity } from '../lib/reader-identity';
import { readerApi } from '../lib/reader-api';
import { requestReadingProof } from '../lib/reading-proof';
import { getFeedbackToken } from '../lib/turnstile';

const api = readerApi('field-notes');
const fallback = 'Your note didn’t reach the desk. Try sending it again.';

function setupFieldNote(section: HTMLDetailsElement) {
  const postId = section.dataset.fieldNote;
  const prompt = section.dataset.fieldNotePrompt;
  const summary = section.querySelector('summary');
  const form = section.querySelector<HTMLFormElement>('[data-field-note-form]');
  const status = section.querySelector<HTMLElement>('[data-field-note-status]');
  const checkContainer = section.querySelector<HTMLElement>('[data-field-note-check]');
  const submit = form?.querySelector<HTMLButtonElement>('button[type=submit]');
  if (!postId || !prompt || !summary || !form || !status || !checkContainer || !submit) return;

  let busy = false;
  let checked = false;
  let renew = false;
  const tell = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };
  const showReceipt = (focus = false) => {
    form.reset();
    form.hidden = true;
    tell('Your field note is with the author. Thanks for writing.');
    if (focus) summary.focus({ preventScroll: true });
  };

  form.hidden = false;
  section.addEventListener('toggle', async () => {
    if (!section.open || checked) return;
    checked = true;
    const identity = readerIdentity();
    if (!identity) return;
    // Start the quiet reading check while the reader is composing their note.
    void requestReadingProof(postId, identity).catch(() => {});
    try {
      const response = await fetch(`${api}?post=${encodeURIComponent(postId)}`, {
        headers: { 'X-Second-Ink-Reader': identity },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok && (await response.json()).submitted === true && !busy) {
        showReceipt(form.contains(document.activeElement));
      }
    } catch {
      // The send endpoint can recover the receipt on a retry.
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || form.hidden) return;

    const fields = new FormData(form);
    const note = String(fields.get('note') ?? '').trim();
    if (!note) {
      tell('Write a few words before sending your note.', true);
      return;
    }
    const identity = readerIdentity();
    if (!identity) {
      tell('Open Second Ink over a secure connection to leave a note.', true);
      return;
    }

    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    tell('Getting your note ready…');
    try {
      const check = await requestReadingProof(postId, identity, renew);
      renew = false;
      const remaining = check.readyAt - performance.now();
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining + 25));
      let turnstileToken: string | undefined;
      if (check.turnstileSiteKey) {
        try {
          turnstileToken = await getFeedbackToken(checkContainer, check.turnstileSiteKey);
        } catch {
          tell('The quiet check didn’t finish. Give your note another try.', true);
          return;
        }
      }
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Second-Ink-Reader': identity },
        body: JSON.stringify({
          postId, prompt, note, quoteConsent: fields.has('quoteConsent'), website: fields.get('website'),
          proof: check.proof, turnstileToken,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (response.ok && data.submitted === true) {
        showReceipt(section.open && (form.contains(document.activeElement) || document.activeElement === document.body));
      } else {
        renew = data.code === 'reading-proof';
        tell(typeof data.message === 'string' ? data.message : fallback, true);
      }
    } catch {
      tell(fallback, true);
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

document.querySelectorAll<HTMLDetailsElement>('[data-field-note]').forEach(setupFieldNote);
