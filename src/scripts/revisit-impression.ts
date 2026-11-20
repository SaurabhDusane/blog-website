import { requestReadingProof } from '../lib/reading-proof';
import { readerApi } from '../lib/reader-api';
import { readerIdentity } from '../lib/reader-identity';
import { reconsiderationChoices, reconsiderationMovements } from '../lib/reconsiderations';
import { stances, type Stance } from '../lib/stances';
import { getFeedbackToken } from '../lib/turnstile';

const api = readerApi('reconsideration');
const firstAnswers = stances.map(({ id }) => id);
const nextAnswers = reconsiderationChoices.map(({ id }) => id);
type SecondAnswer = typeof nextAnswers[number];
type Movement = typeof reconsiderationMovements[number]['id'];
type Snapshot = {
  before: Stance;
  after: SecondAnswer | null;
  movement: { total: number; counts: Record<Movement, number> } | null;
};

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return firstAnswers.includes(data.before as Stance)
    && (data.after === null || nextAnswers.includes(data.after as SecondAnswer))
    && (data.movement === null || !!data.movement && data.movement.total >= 5
      && reconsiderationMovements.every(({ id }) => Number.isSafeInteger(data.movement?.counts?.[id])));
}

function setupRevisit(section: HTMLElement) {
  const postId = section.dataset.revisitPost;
  const reader = section.closest<HTMLElement>('[data-reader]');
  const heading = section.querySelector<HTMLElement>('h2');
  const form = section.querySelector<HTMLFormElement>('[data-revisit-form]');
  const before = section.querySelector<HTMLElement>('[data-revisit-before]');
  const afterWrap = section.querySelector<HTMLElement>('[data-revisit-after-wrap]');
  const after = section.querySelector<HTMLElement>('[data-revisit-after]');
  const movement = section.querySelector<HTMLElement>('[data-revisit-movement]');
  const waiting = section.querySelector<HTMLElement>('[data-revisit-waiting]');
  const status = section.querySelector<HTMLElement>('[data-revisit-status]');
  const challenge = section.querySelector<HTMLElement>('[data-revisit-check]');
  if (!postId || !reader || !heading || !form || !before || !after || !afterWrap || !movement || !waiting || !status || !challenge) return;

  const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[type=submit]')];
  let busy = false;
  let loading = false;
  let reload = false;
  let renewProof = false;

  const tell = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };

  const show = (data: Snapshot) => {
    before.textContent = stances.find(({ id }) => id === data.before)?.label ?? '';
    after.textContent = reconsiderationChoices.find(({ id }) => id === data.after)?.label ?? '';
    afterWrap.hidden = !data.after;
    form.hidden = !!data.after;
    waiting.hidden = !data.after || !!data.movement;
    movement.hidden = !data.movement;
    for (const { id } of reconsiderationMovements) {
      const count = movement.querySelector(`[data-revisit-count="${id}"]`);
      if (count) count.textContent = String(data.movement?.counts[id] ?? 0);
    }
    section.hidden = false;
  };

  const load = async () => {
    const identity = readerIdentity(false);
    if (!identity || busy || !section.hidden) return;
    if (loading) {
      reload = true;
      return;
    }
    loading = true;
    try {
      const response = await fetch(`${api}?post=${encodeURIComponent(postId)}`, {
        headers: { 'X-Second-Ink-Reader': identity },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const data: unknown = await response.json();
      if (response.ok && isSnapshot(data)) show(data);
    } catch {
      // This optional activity can stay out of the way if the response desk is offline.
    } finally {
      loading = false;
      if (reload) {
        reload = false;
        void load();
      }
    }
  };

  reader.addEventListener('second-ink:first-impression', () => { void load(); });
  void load();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || form.hidden) return;
    const stance = event.submitter instanceof HTMLButtonElement ? event.submitter.value : '';
    if (!nextAnswers.includes(stance as SecondAnswer)) return;
    const identity = readerIdentity(false);
    if (!identity) {
      tell('Reopen the essay to find your first answer.', true);
      return;
    }

    busy = true;
    const fields = new FormData(form);
    form.setAttribute('aria-busy', 'true');
    for (const button of buttons) button.disabled = true;
    tell('Getting your comparison ready…');
    try {
      const check = await requestReadingProof(postId, identity, renewProof);
      renewProof = false;
      const remaining = check.readyAt - performance.now();
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining + 25));
      let turnstileToken: string | undefined;
      if (check.turnstileSiteKey) {
        try {
          turnstileToken = await getFeedbackToken(challenge, check.turnstileSiteKey);
        } catch {
          tell('The check didn’t go through. Give the answer another try.', true);
          return;
        }
      }
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Second-Ink-Reader': identity },
        body: JSON.stringify({ postId, stance, website: fields.get('website'), proof: check.proof, turnstileToken }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if ((response.ok || response.status === 409) && isSnapshot(data) && data.after) {
        show(data);
        tell('Your second answer is saved.');
        heading.focus({ preventScroll: true });
      } else {
        renewProof = data?.code === 'reading-proof';
        tell(typeof data?.message === 'string' ? data.message : 'Your answer didn’t reach the desk. Try again.', true);
      }
    } catch (error) {
      tell(error instanceof Error && error.name === 'Error' ? error.message : 'Your answer didn’t reach the desk. Try again.', true);
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

document.querySelectorAll<HTMLElement>('[data-revisit-post]').forEach(setupRevisit);
