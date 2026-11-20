import { feelingCount, feelingLabel, feelings, type Feeling, type FeelingCounts } from '../lib/feelings';
import { readerIdentity, readReaderStorage, writeReaderStorage } from '../lib/reader-identity';
import { requestReadingProof, type ReadingProof } from '../lib/reading-proof';
import { getFeedbackToken } from '../lib/turnstile';

type FeedbackSnapshot = { ok: boolean; total: number; feelings: FeelingCounts; mine: Feeling };
type FeedbackError = { ok: false; code?: string; message?: string };
type FeedbackResult = FeedbackSnapshot | FeedbackError;
const api = '/api/feedback/';
const waitingMessage = 'Take a moment with the essay. The form will open here.';

function hasMap(data: FeedbackResult): data is FeedbackSnapshot {
  return 'feelings' in data && !!data.feelings && typeof data.total === 'number' && Number.isFinite(data.total);
}

function setupFeedback(section: HTMLElement) {
  const postId = section.dataset.feedbackPost;
  const form = section.querySelector<HTMLFormElement>('[data-feedback-form]');
  const submit = form?.querySelector<HTMLButtonElement>('[type=submit]');
  const challenge = form?.querySelector<HTMLElement>('[data-feedback-check]');
  const intro = section.querySelector<HTMLElement>('[data-feedback-intro]');
  const status = section.querySelector<HTMLElement>('[data-feedback-status]');
  const retry = section.querySelector<HTMLButtonElement>('[data-feedback-retry]');
  const map = section.querySelector<HTMLElement>('[data-feedback-map]');
  const heading = map?.querySelector<HTMLElement>('h3');
  const receipt = map?.querySelector<HTMLElement>('[data-feedback-receipt]');
  const total = map?.querySelector<HTMLElement>('[data-feedback-total]');
  const reader = section.closest<HTMLElement>('[data-reader]');
  const prose = reader?.querySelector<HTMLElement>('[data-reader-prose]');
  const end = section.closest<HTMLElement>('[data-reader-end]');
  if (!postId || !form || !submit || !challenge || !intro || !status || !retry || !map || !heading || !receipt || !total || !reader || !prose || !end) return;

  const flag = `second-ink:feedback-sent:${postId}`;
  const minVisible = Math.min(30, Math.max(12, Number(section.dataset.readingWait) || 12)) * 1000;
  let busy = false;
  let reachedEnd = false;
  let started = false;
  let visibleSince: number | undefined;
  let visibleTime = 0;
  let gateTimer = 0;
  let proof: ReadingProof | undefined;
  let proofState: 'idle' | 'opening' | 'ready' | 'unavailable' = 'idle';
  let proofError = '';
  let observer: IntersectionObserver | undefined;
  let focusWhenOpen = false;

  const tell = (message: string, error = false) => {
    if (status.textContent !== message) status.textContent = message;
    status.toggleAttribute('data-error', error);
  };

  const remaining = () => {
    const now = performance.now();
    const elapsed = visibleTime + (visibleSince === undefined ? 0 : now - visibleSince);
    return Math.max(0, minVisible - elapsed, proof ? proof.readyAt - now : 0);
  };

  const renderGate = () => {
    window.clearTimeout(gateTimer);
    if (busy || !map.hidden || !reachedEnd) return;
    if (proofState === 'unavailable') {
      retry.hidden = false;
      retry.disabled = false;
      tell(proofError, true);
      return;
    }
    if (!proof || remaining() > 0) {
      tell(waitingMessage);
      if (proof && !document.hidden) gateTimer = window.setTimeout(renderGate, Math.ceil(remaining()) + 25);
      return;
    }
    if (form.hidden && !document.hidden) {
      form.hidden = false;
      retry.hidden = true;
      tell('You can leave a feeling now.');
      if (focusWhenOpen) {
        form.querySelector<HTMLInputElement>('input[name=feeling]')?.focus();
        focusWhenOpen = false;
      }
    }
  };

  const openProof = async (renew = false) => {
    if (proofState === 'opening' || !map.hidden) return;
    const identity = readerIdentity();
    if (!identity) {
      proofState = 'unavailable';
      proofError = 'This browser couldn’t open the response form. Try a secure connection.';
      renderGate();
      return;
    }
    proof = undefined;
    proofState = 'opening';
    retry.disabled = true;
    renderGate();
    try {
      proof = await requestReadingProof(postId, identity, renew);
      proofState = 'ready';
    } catch (error) {
      proofState = 'unavailable';
      proofError = error instanceof Error ? error.message : 'The form didn’t open. Give it another try in a moment.';
    } finally {
      renderGate();
    }
  };

  const updateClock = () => {
    const now = performance.now();
    if (document.hidden) {
      if (visibleSince !== undefined) visibleTime += now - visibleSince;
      visibleSince = undefined;
    } else if (started) {
      visibleSince ??= now;
    }
    renderGate();
  };

  const beginReading = () => {
    if (started) return;
    started = true;
    updateClock();
    void openProof();
  };

  const seeEnd = () => {
    if (reachedEnd) return;
    reachedEnd = true;
    beginReading();
    renderGate();
  };

  const watchArticle = () => {
    if (observer) return;
    observer = new IntersectionObserver((entries) => {
      for (const item of entries) {
        if (!item.isIntersecting) continue;
        observer?.unobserve(item.target);
        if (item.target === end) seeEnd();
        else beginReading();
      }
    });
    observer.observe(prose);
    observer.observe(end);
    // Focus and hash jumps reach the end for keyboard readers too.
    end.addEventListener('focusin', seeEnd);
    prose.addEventListener('focusin', beginReading);
    document.addEventListener('visibilitychange', updateClock);
  };

  const showMap = (data: FeedbackSnapshot, focus = false) => {
    const readers = Math.max(0, Math.floor(data.total));
    for (const { id } of feelings) {
      const row = map.querySelector(`[data-feeling-row="${id}"]`);
      const meter = row?.querySelector('progress');
      const count = row?.querySelector('[data-feeling-count]');
      const value = feelingCount(data.feelings, id);
      if (meter) {
        meter.max = Math.max(1, readers);
        meter.value = value;
      }
      if (count) count.textContent = String(value);
    }
    receipt.textContent = data.mine ? `You marked this ${feelingLabel(data.mine).toLowerCase()}.` : '';
    total.textContent = `${readers} ${readers === 1 ? 'reader left' : 'readers left'} a feeling.`;
    writeReaderStorage(flag, '1');
    form.hidden = true;
    retry.hidden = true;
    intro.hidden = true;
    map.hidden = false;
    observer?.disconnect();
    end.removeEventListener('focusin', seeEnd);
    prose.removeEventListener('focusin', beginReading);
    document.removeEventListener('visibilitychange', updateClock);
    window.clearTimeout(gateTimer);
    form.reset();
    if (focus) heading.focus();
  };

  const restoreMap = async () => {
    if (busy || !map.hidden) return;
    const identity = readerIdentity(false);
    if (!identity || !readReaderStorage(flag)) return;
    busy = true;
    form.hidden = true;
    tell('Unfolding the feeling map…');
    try {
      const response = await fetch(`${api}?post=${encodeURIComponent(postId)}`, {
        headers: { 'X-Second-Ink-Reader': identity },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const data: FeedbackResult = await response.json();
      if (response.ok && hasMap(data)) {
        tell('');
        showMap(data);
      } else if (response.status === 404) {
        writeReaderStorage(flag, '');
        tell('');
      } else {
        throw new Error('Feeling map unavailable');
      }
    } catch {
      tell('The feeling map didn’t open. Try again in a moment.', true);
    } finally {
      busy = false;
      if (map.hidden) {
        watchArticle();
        renderGate();
      }
    }
  };

  if (readReaderStorage(flag) && readerIdentity(false)) void restoreMap();
  else {
    tell(waitingMessage);
    watchArticle();
  }
  window.addEventListener('storage', (event) => {
    if (event.key === flag && event.newValue) void restoreMap();
  });
  retry.addEventListener('click', () => {
    focusWhenOpen = true;
    proofError = '';
    void openProof(true);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !proof || form.hidden || remaining() > 0) return;
    const fields = new FormData(form);
    const identity = readerIdentity();
    if (!identity) {
      tell('This browser couldn’t open the response form. Try a secure connection.', true);
      return;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    let token: string | undefined;
    try {
      if (proof.turnstileSiteKey) {
        tell('A quick check before sending…');
        try {
          token = await getFeedbackToken(challenge, proof.turnstileSiteKey);
        } catch {
          tell('The check didn’t go through. Your note is still here if you want to retry.', true);
          return;
        }
      }
      tell('Sending your feeling…');
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Second-Ink-Reader': identity },
        body: JSON.stringify({
          postId,
          feeling: fields.get('feeling'),
          note: fields.get('note'),
          answer: fields.get('answer'),
          featureConsent: fields.get('featureConsent') === 'yes',
          website: fields.get('website'),
          proof: proof.proof,
          turnstileToken: token,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data: FeedbackResult = await response.json();
      if ((response.ok || response.status === 409) && hasMap(data)) {
        tell(response.status === 409 ? 'You’ve already left a feeling for this essay.' : 'Thanks for leaving a feeling.');
        showMap(data, true);
      } else if ('code' in data && (data.code === 'reading-proof' || data.code === 'reading-time')) {
        form.hidden = true;
        proofState = 'unavailable';
        proofError = 'That reading check expired. Your note is still here if you want to retry.';
        focusWhenOpen = true;
      } else {
        tell('message' in data && data.message ? data.message : 'Your feeling didn’t reach the desk. Try again.', true);
      }
    } catch {
      tell('Your feeling didn’t reach the desk. Try again.', true);
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      renderGate();
      if (!retry.hidden && form.hidden) retry.focus();
    }
  });
}

document.querySelectorAll<HTMLElement>('[data-reader-feedback]').forEach(setupFeedback);
