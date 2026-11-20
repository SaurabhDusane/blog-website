import { indexPassage, type SearchPassage } from './archive-search';

const commonWords = new Set((
  "a about after all also am an and any archive are as ask at be because been before being both but by " +
  "can can't could did do does doing don’t don't down each essay essays even ever find for " +
  "from get give good had has have having he her here hers him his how i if in into is it its just " +
  "know like look made make many may me might more much my near need no nor not of on one only " +
  "or our out over own people piece please post posts really said say says see she should show " +
  "so some such take tell than that the their them then there these they thing things think " +
  "this those through to too try under up us use very want was we well were what when where " +
  "which while who whom why will with would write written wrote yet you your"
).split(' '));

const relatedWords = [
  ['choice', 'decision', 'decide', 'choose'],
  ['start', 'begin', 'beginning'],
  ['routine', 'habit', 'default'],
  ['interrupt', 'snag', 'friction', 'obstacle'],
  ['attention', 'focus', 'notice', 'distraction'],
  ['assumption', 'guess', 'uncertainty', 'doubt'],
  ['draft', 'sketch', 'rough'],
];

function root(word: string) {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  const stem = word.length > 5 ? word.replace(/(?:ing|ed)$/, '') : word;
  return stem.length > 3 ? stem.replace(/([^s])s$/, '$1') : stem;
}

const aliases = new Map<string, Set<string>>();
for (const group of relatedWords) {
  const words = new Set(group.map(root));
  for (const word of words) aliases.set(word, words);
}

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
  const terms = [...new Set(indexPassage(question).words
    .map(({ value }) => value.replace(/'s$/, ''))
    .filter((value) => value.length > 2 && !commonWords.has(value))
    .map(root))].slice(0, 12);
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
        const word = root(value);
        for (const term of terms) {
          if (word !== term && !aliases.get(term)?.has(word)) continue;
          const match = matches.get(term) ?? { exact: false, words: new Set() };
          match.exact ||= word === term;
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
