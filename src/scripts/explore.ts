import { track } from '../lib/analytics';
import { indexPassage, matchEssay, renderExcerpt, searchTerms, type SearchPassage } from '../lib/archive-search';
import { feelings, feelingCount } from '../lib/feelings';
import { readMoodWeather, type MoodWeather } from '../lib/mood-weather';
import { setupArchiveQuestions } from './archive-questions';

type Essay = {
  element: HTMLElement;
  path: string;
  postId: string;
  title: SearchPassage;
  metadata: SearchPassage;
  excerpt: HTMLParagraphElement;
  topics: string[];
  length: string;
  mood: string;
  kind: 'essay' | 'note';
};

function collectEssay(element: HTMLElement): Essay[] {
  const link = element.querySelector<HTMLAnchorElement>('.essay-row__title');
  const path = link?.getAttribute('href');
  if (!link || !path || !link.parentElement) return [];
  const excerpt = document.createElement('p');
  excerpt.className = 'archive__excerpt';
  excerpt.hidden = true;
  link.parentElement.append(excerpt);

  const minutes = Number(element.dataset.minutes);
  return [{
    element,
    path,
    postId: path.split('/').filter(Boolean).at(-1) ?? '',
    title: indexPassage(link.textContent ?? ''),
    metadata: indexPassage(element.dataset.search ?? ''),
    excerpt,
    topics: (element.dataset.topics ?? '').split(' '),
    length: minutes <= 5 ? 'quick' : minutes <= 10 ? 'steady' : 'long',
    mood: element.dataset.mood ?? '',
    kind: element.dataset.kind === 'note' ? 'note' : 'essay',
  }];
}

async function fetchArchive() {
  const response = await fetch('/explore/index.json');
  if (!response.ok) throw new Error('The essay index is unavailable.');
  const passages: Record<string, string[]> = await response.json();
  return new Map(Object.entries(passages).map(([path, text]) => [path, text.map((value) => indexPassage(value))]));
}

function initExplore() {
  const page = document.querySelector<HTMLElement>('[data-explore]');
  const form = page?.querySelector<HTMLFormElement>('.archive__filters');
  const count = page?.querySelector<HTMLElement>('[data-result-count]');
  const empty = page?.querySelector<HTMLElement>('[data-no-results]');
  const clear = page?.querySelector<HTMLButtonElement>('[data-reset-filters]');
  const list = page?.querySelector<HTMLElement>('[data-essay-index]');
  const notice = page?.querySelector<HTMLElement>('[data-search-notice]');
  const feelingNotice = page?.querySelector<HTMLElement>('[data-feeling-notice]');
  if (!page || !form || !count || !empty || !clear || !list || !notice || !feelingNotice) return;

  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]')];
  const search = form.querySelector<HTMLInputElement>('input[name="q"]');
  const essays = [...list.querySelectorAll<HTMLElement>('[data-result]')].flatMap(collectEssay);
  const advanced = form.querySelector<HTMLDetailsElement>('[data-archive-filters]');
  const formatFilter = form.querySelector<HTMLElement>('[data-format-filter]');
  const topicFilter = form.querySelector<HTMLElement>('[data-topic-filter]');
  const hasNotes = essays.some(({ kind }) => kind === 'note');
  const hasTopics = essays.some(({ topics }) => topics.some(Boolean));
  let archive: Map<string, SearchPassage[]> | undefined;
  let archiveState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  let postFeelings: MoodWeather['byPost'] | undefined;
  let feelingState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  let inputDelay = 0;
  let reportResults = false;

  setupArchiveQuestions(page, essays.map(({ path, title }) => ({ path, title: title.text })));

  const showResults = () => {
    const filters = new FormData(form);
    const query = String(filters.get('q') ?? '').trim();
    const terms = searchTerms(query);
    const topic = String(filters.get('topic') ?? '');
    const time = String(filters.get('time') ?? '');
    const mood = String(filters.get('mood') ?? '');
    const feeling = feelings.find(({ id }) => id === filters.get('feeling'))?.id;
    const format = String(filters.get('kind') ?? '');
    if (formatFilter) formatFilter.hidden = !hasNotes && !format;
    if (topicFilter) topicFilter.hidden = !hasTopics && !topic;
    if (terms.length > 0 && archiveState === 'idle') {
      archiveState = 'loading';
      void fetchArchive().then((loaded) => {
        archive = loaded;
        archiveState = 'ready';
        showResults();
      }, () => {
        archiveState = 'unavailable';
        showResults();
      });
    }

    if (feeling && feelingState === 'idle') {
      feelingState = 'loading';
      void readMoodWeather().then(({ byPost }) => {
        postFeelings = byPost;
        feelingState = 'ready';
        showResults();
      }, () => {
        feelingState = 'unavailable';
        showResults();
      });
    }

    let matches = 0;
    let notes = 0;
    const ranked = essays.map((essay) => {
      const qualifies = (!topic || essay.topics.includes(topic))
        && (!format || format === `${essay.kind}s`)
        && (!time || essay.length === time)
        && (!mood || mood === essay.mood)
        && (!feeling || !postFeelings || feelingCount(postFeelings[essay.postId] ?? {}, feeling) > 0);
      const result = !qualifies ? null : terms.length > 0
        ? matchEssay(essay.title, essay.metadata, archive?.get(essay.path) ?? [], terms)
        : { score: 0, excerpt: undefined };

      essay.element.hidden = result === null;
      essay.excerpt.hidden = !result?.excerpt;
      if (result?.excerpt) essay.excerpt.replaceChildren(renderExcerpt(result.excerpt, terms));
      if (result) {
        matches += 1;
        if (essay.kind === 'note') notes += 1;
      }
      return { element: essay.element, score: result?.score ?? -1 };
    }).sort((first, second) => second.score - first.score);

    let next = list.firstElementChild;
    for (const { element } of ranked) {
      if (element === next) next = next.nextElementSibling;
      else list.insertBefore(element, next);
    }

    const pending = (terms.length > 0 && archiveState === 'loading') || (!!feeling && feelingState === 'loading');
    const noun = format === 'notes' || (notes > 0 && notes === matches) ? 'note' : notes > 0 ? 'piece' : 'essay';
    const status = pending ? 'Looking through the archive…' : `${matches} ${noun}${matches === 1 ? '' : 's'}`;
    if (count.textContent !== status) count.textContent = status;
    empty.hidden = matches !== 0 || pending;
    empty.textContent = feeling
      ? 'Nothing matches this mix yet. Feelings appear once an essay has at least three responses.'
      : 'Nothing in this stack. Try a wider search.';
    notice.hidden = terms.length === 0 || archiveState !== 'unavailable';
    feelingNotice.hidden = !feeling || feelingState !== 'unavailable';
    clear.hidden = !query && !topic && !time && !mood && !feeling && !format;
    if (!pending && reportResults) {
      track('explore', { results: matches, searched: Boolean(query) });
      reportResults = false;
    }
  };

  const readUrl = () => {
    const params = new URLSearchParams(window.location.search);
    for (const field of fields) {
      const value = params.get(field.name) ?? '';
      field.value = field === search ? value.slice(0, search.maxLength) : value;
      if (field instanceof HTMLSelectElement && field.selectedIndex === -1) field.value = '';
    }
    if (advanced && fields.some((field) => advanced.contains(field) && field.value)) advanced.open = true;
    showResults();
  };

  const writeUrl = (mode: 'push' | 'replace') => {
    const url = new URL(window.location.href);
    for (const field of fields) {
      const value = field.value.trim();
      if (value) url.searchParams.set(field.name, value);
      else url.searchParams.delete(field.name);
    }
    if (url.href === window.location.href) return false;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    return true;
  };

  const commitFilters = (mode: 'push' | 'replace') => {
    window.clearTimeout(inputDelay);
    reportResults = writeUrl(mode) || reportResults;
    showResults();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commitFilters('push');
  });

  search?.addEventListener('input', () => {
    window.clearTimeout(inputDelay);
    inputDelay = window.setTimeout(() => commitFilters('replace'), 110);
  });

  form.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    commitFilters('push');
  });

  clear.addEventListener('click', () => {
    form.reset();
    commitFilters('push');
    search?.focus();
  });

  window.addEventListener('popstate', () => {
    window.clearTimeout(inputDelay);
    reportResults = false;
    readUrl();
  });
  readUrl();
  form.hidden = false;
}

initExplore();
