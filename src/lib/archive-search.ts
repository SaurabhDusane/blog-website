import { meaningfulTerms, termStrength } from './archive-meaning';

type SearchWord = {
  value: string;
  start: number;
  end: number;
};

export type SearchPassage = {
  text: string;
  words: SearchWord[];
  anchor?: string;
  heading?: string;
};

type PassageEntry = { text: string; anchor?: string; heading?: string };

export function indexPassage(text: string, anchor?: string, heading?: string): SearchPassage {
  const words = Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu), (match) => ({
    value: match[0].normalize('NFKD').replace(/\p{M}/gu, '').replaceAll('’', "'").toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  })).filter(({ value }) => value.length > 0);

  return { text, words, anchor, heading };
}

export function searchTerms(query: string) {
  return meaningfulTerms(indexPassage(query).words.map(({ value }) => value)).slice(0, 16);
}

export function bestStrength(passage: SearchPassage, term: string, allowPrefix = false) {
  let strength = 0;
  for (const { value } of passage.words) {
    strength = Math.max(strength, termStrength(value, term, allowPrefix));
    if (strength === 4) break;
  }
  return strength;
}

export function matchEssay(
  title: SearchPassage,
  metadata: SearchPassage,
  passages: SearchPassage[],
  terms: string[],
) {
  const strengths = terms.map((term) => Math.max(bestStrength(title, term, true) * 1.4, bestStrength(metadata, term, true)));
  let excerpt: SearchPassage | undefined;
  let excerptScore = 0;
  for (const passage of passages) {
    const matches = terms.map((term, index) => {
      const strength = bestStrength(passage, term, true);
      strengths[index] = Math.max(strengths[index], strength);
      return strength;
    });
    const coverage = matches.filter(Boolean).length;
    const score = coverage * 3 + matches.reduce((sum, strength) => sum + strength, 0);
    if (score > excerptScore) {
      excerpt = passage;
      excerptScore = score;
    }
  }

  if (strengths.some((strength) => !strength)) return null;
  const words = title.words.map(({ value }) => value);
  const phrase = terms.length > 1 && ` ${words.join(' ')} `.includes(` ${terms.join(' ')} `);
  return { score: strengths.reduce((sum, strength) => sum + strength, 0) + excerptScore / 2 + (phrase ? 5 : 0), excerpt };
}

let passages: Promise<Map<string, SearchPassage[]>> | undefined;

export function loadArchivePassages() {
  passages ??= fetch('/explore/passages.json').then(async (response) => {
    if (!response.ok) throw new Error('The passage index is unavailable.');
    const entries: Record<string, PassageEntry[]> = await response.json();
    return new Map(Object.entries(entries).map(([path, entries]) => [
      path,
      entries.map(({ text, anchor, heading }) => indexPassage(text, anchor, heading)),
    ]));
  }).catch((error: unknown) => {
    passages = undefined;
    throw error;
  });
  return passages;
}

export function renderExcerpt(passage: SearchPassage, terms: string[]) {
  const fragment = document.createDocumentFragment();
  const { text, words } = passage;
  const isMatch = (word: SearchWord) => terms.some((term) => termStrength(word.value, term, true) > 0);
  const first = words.findIndex(isMatch);
  if (first === -1) return fragment;

  const startIndex = Math.max(0, first - 5);
  const endIndex = Math.min(words.length - 1, first + 20);
  const start = startIndex === 0 ? 0 : words[startIndex].start;
  const end = endIndex === words.length - 1 ? text.length : words[endIndex].end;
  let cursor = start;
  if (start > 0) fragment.append('…');

  for (const word of words.slice(startIndex, endIndex + 1)) {
    if (!isMatch(word)) continue;
    fragment.append(text.slice(cursor, word.start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(word.start, word.end);
    fragment.append(mark);
    cursor = word.end;
  }

  fragment.append(text.slice(cursor, end));
  if (end < text.length) fragment.append('…');
  return fragment;
}
