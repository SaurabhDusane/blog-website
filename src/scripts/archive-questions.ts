import { findArchiveAnswers } from '../lib/archive-answers';
import { indexPassage, renderExcerpt, type SearchPassage } from '../lib/archive-search';

async function fetchPassages() {
  const response = await fetch('/explore/passages.json');
  if (!response.ok) throw new Error('The passage index is unavailable.');
  const entries: Record<string, Array<{ text: string; anchor: string; heading?: string }>> = await response.json();
  return new Map(Object.entries(entries).map(([path, passages]) => [
    path,
    passages.map(({ text, anchor, heading }) => indexPassage(text, anchor, heading)),
  ]));
}

export function setupArchiveQuestions(
  page: HTMLElement,
  essays: Array<{ path: string; title: string }>,
) {
  const part = page.querySelector<HTMLElement>('[data-archive-questions]');
  const form = part?.querySelector<HTMLFormElement>('form');
  const input = form?.querySelector<HTMLInputElement>('input');
  const results = part?.querySelector<HTMLOListElement>('[data-question-results]');
  const status = part?.querySelector<HTMLElement>('[data-question-status]');
  if (!form || !input || !results || !status) return;
  form.hidden = false;
  let revision = 0;
  let request: Promise<Map<string, SearchPassage[]>> | undefined;

  const clearResults = (message: string) => {
    results.replaceChildren();
    results.hidden = true;
    status.textContent = message;
  };

  input.addEventListener('input', () => {
    revision += 1;
    clearResults('');
    results.removeAttribute('aria-busy');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) {
      clearResults('Add a question to look through the archive.');
      input.focus();
      return;
    }
    const submitted = ++revision;
    clearResults('Looking through the essays…');
    results.setAttribute('aria-busy', 'true');
    try {
      request ??= fetchPassages().catch((error: unknown) => {
        request = undefined;
        throw error;
      });
      const archive = await request;
      if (submitted !== revision) return;
      const answers = findArchiveAnswers(essays, archive, question);
      if (!answers.length) {
        clearResults('I couldn’t find a passage for that question. Try a shorter question or a specific word.');
        return;
      }
      const items = answers.map(({ path, title, passage, words }) => {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = path + '#' + encodeURIComponent(passage.anchor ?? '');
        link.textContent = passage.heading ? title + ' · ' + passage.heading : title;
        const quote = document.createElement('blockquote');
        quote.append(renderExcerpt(passage, words));
        row.append(link, quote);
        return row;
      });
      results.replaceChildren(...items);
      results.hidden = false;
      status.textContent = answers.length === 1
        ? 'One passage from the archive.'
        : answers.length + ' passages from the archive.';
    } catch {
      if (submitted === revision) clearResults('The archive didn’t load. Give it another try.');
    } finally {
      if (submitted === revision) results.removeAttribute('aria-busy');
    }
  });
}
