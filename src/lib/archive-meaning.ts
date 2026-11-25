const filler = new Set((
  "a about all also am an and any archive are as ask at be because been being both but by " +
  "can can't could did do does doing don't each essay essays find for from get give had has have " +
  "he her here him his how i if in into is it its just know like look may me might more much my " +
  "need no of on one only or our out over please post posts said say says see she should show so " +
  "some such than that the their them then there these they this those through to too try under up " +
  "us use was we well were what when where which while who whom why will with would written wrote you your"
).split(' '));

const concepts = [
  ['choice', 'decision', 'decide', 'choose'],
  ['start', 'begin', 'beginning'],
  ['routine', 'habit', 'custom', 'default'],
  ['interrupt', 'snag', 'friction', 'obstacle'],
  ['attention', 'focus', 'notice', 'distraction'],
  ['assumption', 'guess', 'uncertainty', 'doubt'],
  ['draft', 'sketch', 'rough'],
  ['society', 'social', 'societal', 'culture', 'cultural', 'community'],
  ['person', 'people', 'individual', 'human', 'population'],
  ['shape', 'influence', 'impact', 'affect', 'effect', 'determine', 'form'],
  ['villain', 'evildoer', 'wrongdoer', 'antisocial'],
  ['behavior', 'behaviour', 'conduct'],
  ['geopolitics', 'geopolitical', 'international', 'global', 'worldwide'],
  ['petrol', 'gasoline', 'fuel', 'oil'],
  ['expense', 'price', 'cost', 'payment'],
  ['tariff', 'duty', 'tax', 'levy'],
  ['worker', 'labour', 'labor', 'workforce'],
  ['migration', 'immigration', 'emigration', 'migrant'],
  ['software', 'application', 'program', 'app'],
];

function stem(value: string) {
  const word = value.replace(/'s$/, '');
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && /(?:sh|ch|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  return word.length > 3 && /[^sui]s$/.test(word) ? word.slice(0, -1) : word;
}

const related = new Map<string, Set<string>>();
for (const concept of concepts) {
  const words = new Set(concept.map(stem));
  for (const word of words) related.set(word, words);
}

export function meaningfulTerms(words: string[]) {
  const query = [...new Set(words)];
  const meaningful = query.filter((word) => !filler.has(word));
  return meaningful.length ? meaningful : query;
}

export function termStrength(word: string, term: string, allowPrefix = false): number {
  if (word === term) return 4;
  const evidence = stem(word);
  const query = stem(term);
  if (evidence === query) return 3;
  if (related.get(query)?.has(evidence)) return 2;
  if (allowPrefix && term.length > 3 && word.startsWith(term)) return 1;
  return 0;
}
