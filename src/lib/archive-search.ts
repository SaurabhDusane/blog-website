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

export function indexPassage(text: string, anchor?: string, heading?: string): SearchPassage {
  const words = Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu), (match) => ({
    value: match[0].normalize('NFKD').replace(/\p{M}/gu, '').replaceAll('’', "'").toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  })).filter(({ value }) => value.length > 0);

  return { text, words, anchor, heading };
}

export function searchTerms(query: string) {
  return [...new Set(indexPassage(query).words.map(({ value }) => value))];
}

function contains(words: SearchWord[], term: string) {
  return words.some(({ value }) => value.includes(term));
}

export function matchEssay(
  title: SearchPassage,
  metadata: SearchPassage,
  passages: SearchPassage[],
  terms: string[],
) {
  let score = 0;
  const remaining = new Set(terms);
  for (const term of terms) {
    if (contains(title.words, term)) {
      score += 5;
      remaining.delete(term);
    } else if (contains(metadata.words, term)) {
      score += 2;
      remaining.delete(term);
    }
  }

  let excerpt: SearchPassage | undefined;
  let excerptMatches = 0;
  for (const passage of passages) {
    const matchingTerms = terms.filter((term) => contains(passage.words, term));
    if (matchingTerms.length > excerptMatches) {
      excerpt = passage;
      excerptMatches = matchingTerms.length;
    }
    for (const term of matchingTerms) {
      if (remaining.delete(term)) score += 1;
    }
  }

  if (remaining.size > 0) return null;
  if (terms.length > 1 && title.words.map(({ value }) => value).join(' ').includes(terms.join(' '))) {
    score += 4;
  }
  return { score, excerpt };
}

export function renderExcerpt(passage: SearchPassage, terms: string[]) {
  const fragment = document.createDocumentFragment();
  const { text, words } = passage;
  const isMatch = (word: SearchWord) => terms.some((term) => word.value.includes(term));
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
