import { readerIdentity, readReaderStorage, writeReaderStorage } from '../lib/reader-identity';
import { readerApi } from '../lib/reader-api';
import { stances, type Stance, type StanceCounts } from '../lib/stances';

const api = readerApi('stance');
const choices = stances.map(({ id }) => id);

interface StanceSnapshot {
  total: number;
  stances: StanceCounts;
  mine: Stance;
}

function hasSnapshot(data: unknown): data is StanceSnapshot {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<StanceSnapshot>;
  return Number.isSafeInteger(candidate.total)
    && typeof candidate.mine === 'string' && choices.includes(candidate.mine)
    && !!candidate.stances
    && choices.every((choice) => Number.isSafeInteger(candidate.stances?.[choice]));
}

function isLinkedPassage(take: HTMLElement) {
  if (new URLSearchParams(location.search).get('resume') === '1') return true;
  let target = location.hash.slice(1);
  try { target = decodeURIComponent(target); } catch { /* Leave malformed anchors alone. */ }
  return target === 'reply' || target === 'after-reading'
    || /^passage-\d+$/.test(target)
    || !!target && take.contains(document.getElementById(target));
}

function setupStance(section: HTMLElement) {
  const postId = section.dataset.stancePost;
  const take = section.closest('[data-reader]')?.querySelector<HTMLElement>('[data-reader-take]');
  const prompt = section.querySelector<HTMLElement>('[data-stance-prompt]');
  const form = section.querySelector<HTMLFormElement>('[data-stance-form]');
  const skip = section.querySelector<HTMLButtonElement>('[data-stance-skip]');
  const status = section.querySelector<HTMLElement>('[data-stance-status]');
  const map = section.querySelector<HTMLElement>('[data-stance-map]');
  const receipt = section.querySelector<HTMLElement>('[data-stance-receipt]');
  if (!take) return;
  const reveal = (focus = false) => {
    if (take.hidden) {
      take.hidden = false;
      take.dispatchEvent(new CustomEvent('second-ink:take-revealed', { bubbles: true }));
    }
    if (focus) {
      take.tabIndex = -1;
      take.focus();
    }
  };
  if (!postId || !prompt || !form || !skip || !status || !map || !receipt) {
    reveal();
    return;
  }
  const flag = `second-ink:stance:${postId}`;
  const buttons = [...form.querySelectorAll<HTMLButtonElement>('[type="submit"]')];
  let mode: 'prompt' | 'loading' | 'sending' | 'done' = 'prompt';
  const tell = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };
  const showMap = (snapshot: StanceSnapshot) => {
    const voters = Math.max(0, snapshot.total);
    const own = { agree: 'agreed', unsure: 'weren’t sure yet', disagree: 'disagreed' }[snapshot.mine];
    receipt.textContent = `You ${own}. ${voters} ${voters === 1 ? 'reader answered' : 'readers answered'}.`;
    for (const choice of choices) {
      const row = map.querySelector(`[data-stance-row="${choice}"]`);
      const bar = row?.querySelector('progress');
      const count = row?.querySelector('[data-stance-count]');
      const amount = Math.max(0, snapshot.stances[choice]);
      if (bar) {
        bar.max = Math.max(1, voters);
        bar.value = amount;
      }
      if (count) count.textContent = String(amount);
    }
    writeReaderStorage(flag, 'answered');
    prompt.hidden = true;
    map.hidden = false;
    section.setAttribute('aria-labelledby', 'before-read-map');
    section.hidden = false;
    mode = 'done';
    tell('');
    section.dispatchEvent(new CustomEvent('second-ink:first-impression', { bubbles: true }));
    reveal();
  };
  const skipPrompt = (focus = false) => {
    writeReaderStorage(flag, 'skipped');
    section.hidden = true;
    mode = 'done';
    reveal(focus);
  };

  async function restoreMap(identity: string) {
    mode = 'loading';
    try {
      const response = await fetch(`${api}?post=${encodeURIComponent(postId!)}`, {
        headers: { 'X-Second-Ink-Reader': identity },
        cache: 'no-store',
      });
      const snapshot: unknown = await response.json();
      if (response.ok && hasSnapshot(snapshot)) showMap(snapshot);
    } catch {
      // A previously revealed essay stays open if the map is unavailable.
    } finally {
      if (mode === 'loading') mode = 'done';
    }
  }

  const remembered = readReaderStorage(flag);
  const identity = readerIdentity(false);
  if (remembered === 'answered' && identity) {
    reveal();
    void restoreMap(identity);
  } else if (remembered === 'skipped' || isLinkedPassage(take)) {
    if (!remembered) writeReaderStorage(flag, 'skipped');
    reveal();
  } else {
    section.hidden = false;
  }

  skip.addEventListener('click', () => skipPrompt(true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mode !== 'prompt') return;
    const stance = event.submitter instanceof HTMLButtonElement ? event.submitter.value : '';
    if (!choices.includes(stance as Stance)) return;
    const voter = readerIdentity();
    if (!voter) {
      tell('This browser couldn’t send your answer. You can still read the essay.', true);
      return;
    }
    mode = 'sending';
    for (const button of buttons) button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const fields = new FormData(form);
    tell('Saving your first take…');
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Second-Ink-Reader': voter },
        body: JSON.stringify({ postId, stance, website: fields.get('website') }),
      });
      const snapshot: unknown = await response.json();
      if ((response.ok || response.status === 409) && hasSnapshot(snapshot)) {
        const skipped = readReaderStorage(flag) === 'skipped' && !take.hidden;
        showMap(snapshot);
        if (!skipped) {
          const mapTitle = map.querySelector<HTMLElement>('h3');
          if (mapTitle) {
            mapTitle.tabIndex = -1;
            mapTitle.focus();
          }
        }
      } else if (take.hidden) {
        tell('Your answer didn’t reach the desk. Try again or keep reading.', true);
      }
    } catch {
      if (take.hidden) tell('Your answer didn’t reach the desk. Try again or keep reading.', true);
    } finally {
      if (mode === 'sending') mode = 'prompt';
      for (const button of buttons) button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

document.querySelectorAll<HTMLElement>('[data-before-read]').forEach(setupStance);
