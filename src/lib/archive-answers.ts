import { termStrength } from './archive-meaning';
import { searchTerms, type SearchPassage } from './archive-search';

type AnswerCandidate = {
  path: string;
  title: string;
  passage: SearchPassage;
  terms: Map<string, { exact: boolean; words: Set<string> }>;
};

export function findArchiveAnswers(
  essays: Array<{ path: string; title: string }>,
  archive: Map<string, SearchPassage[]>,
  question: string,
) {
  const terms = searchTerms(question).filter((term) => term.length > 2);
  if (!terms.length) return [];

  const candidates: AnswerCandidate[] = [];
  const occurrences = new Map<string, number>();
  let passageCount = 0;
  for (const { path, title } of essays) {
    for (const passage of archive.get(path) ?? []) {
      if (!passage.anchor) continue;
      passageCount += 1;
      const matches = new Map<string, { exact: boolean; words: Set<string> }>();
      for (const { value } of passage.words) {
        for (const term of terms) {
          const strength = termStrength(value, term);
          if (!strength) continue;
          const match = matches.get(term) ?? { exact: false, words: new Set() };
          match.exact ||= strength >= 3;
          match.words.add(value);
          matches.set(term, match);
        }
      }
      if (!matches.size) continue;
      for (const term of matches.keys()) occurrences.set(term, (occurrences.get(term) ?? 0) + 1);
      candidates.push({ path, title, passage, terms: matches });
    }
  }

  if (occurrences.size < Math.min(terms.length, 2)) return [];
  const ranked = candidates
    .filter(({ terms: matches }) => matches.size >= (occurrences.size >= 4 ? 2 : 1))
    .map((candidate) => ({
      ...candidate,
      score: [...candidate.terms].reduce((total, [term, match]) => {
        const rarity = Math.log(1 + passageCount / (occurrences.get(term) ?? 1));
        return total + rarity * (match.exact ? 1.4 : .7);
      }, 0) + candidate.terms.size,
    })).sort((first, second) => second.score - first.score);
  const seen = new Set<string>();
  return ranked.flatMap(({ path, title, passage, terms: matches }) => {
    if (seen.has(path)) return [];
    seen.add(path);
    return [{ path, title, passage, words: [...new Set([...matches.values()].flatMap(({ words }) => [...words]))] }];
  }).slice(0, 3);
}
