import { trainingEssays } from './essay-classifier-training.mjs';

export const essayTopics = Object.freeze({
  tools: 'Tools & Technology',
  politics: 'Politics & Civic Life',
  'odd-thoughts': 'Odd Thoughts',
  attention: 'Attention',
  'creative-practice': 'Creative Practice',
  'reading-notes': 'Reading Notes',
  'everyday-life': 'Everyday Life',
  'culture-and-place': 'Culture & Place',
});

const moods = ['reflective', 'practical', 'curious'];
const commonWords = new Set((
  'a an as at are be by for from in is it its of on or so than the this that to was with'
).split(' '));
const topicStopWords = new Set([...commonWords, ...(
  'about all also am and any been can could do does each get had has have how i if into me more my no ' +
  'not one only our out some their them then there these they think through up us use very we were ' +
  'what when where which who will would you your'
).split(' ')]);

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function prose(value) {
  return value
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ' ')
    .replace(/^ *(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ *\1 *\r?$/gm, ' ')
    .replace(/!\[[^\]\n]*\]\([^()\n]*\)/g, ' ')
    .replace(/\[([^\]\n]+)\]\([^()\n]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)>]+/gi, ' ')
    .replace(/<\/?[a-z][^<>\n]{0,200}>/gi, ' ');
}

function normalizedWord(word) {
  const value = word.replace(/['’]s$/u, '').replace(/’/g, "'");
  if (value.length > 4 && /^[a-z]+$/.test(value)) {
    if (value.endsWith('ies')) return value.slice(0, -3) + 'y';
    if (/(?:ches|shes|xes|zes|sses)$/.test(value)) return value.slice(0, -2);
    if (value.endsWith('s') && !/(?:ss|us|is)$/.test(value)) return value.slice(0, -1);
  }
  return value;
}

function features(text, isMood) {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? [];
  const stopWords = isMood ? commonWords : topicStopWords;
  const found = new Set();
  if (isMood && text.includes('?')) found.add('?');
  let previous = '';
  for (const token of words) {
    const word = normalizedWord(token);
    const meaningful = !stopWords.has(word);
    if (meaningful && (word.length > 1 || isMood)) found.add(word);
    if (previous && (isMood ? meaningful || !stopWords.has(previous) : meaningful && !stopWords.has(previous))) {
      found.add(previous + ' ' + word);
    }
    previous = word;
  }
  return found;
}

function train(labels, isMood) {
  const labelCounts = labels.map(() => 0);
  const vocabulary = new Map();
  let documentCount = 0;
  for (const [topic, examples] of Object.entries(trainingEssays)) {
    for (const [mood, example] of examples) {
      const label = labels.indexOf(isMood ? mood : topic);
      labelCounts[label] += 1;
      documentCount += 1;
      for (const term of features(example, isMood)) {
        if (!vocabulary.has(term)) {
          vocabulary.set(term, { counts: labels.map(() => 0), topics: new Set(), total: 0 });
        }
        const evidence = vocabulary.get(term);
        evidence.counts[label] += 1;
        evidence.topics.add(topic);
        evidence.total += 1;
      }
    }
  }

  const smoothing = isMood ? labels.length * 2 : labels.length / 2;
  const priors = labelCounts.map((count) => count / documentCount);
  const weights = new Map();
  for (const [term, { counts, topics, total }] of vocabulary) {
    if (isMood && topics.size < 2) continue;
    // By Bayes' rule, the ratio of posterior to prior is the term's class
    // likelihood relative to its background likelihood. Smooth sparse terms.
    weights.set(term, counts.map((count, index) => {
      const prior = priors[index];
      const posterior = (count + smoothing * prior) / (total + smoothing);
      return Math.log(posterior / prior);
    }));
  }
  return { labels, weights, isMood };
}

const topicModel = train(Object.keys(essayTopics), false);
const moodModel = train(moods, true);

function rank(model, fields) {
  const terms = new Map();
  for (const [text, multiplier] of fields) {
    for (const term of features(text, model.isMood)) {
      if (model.weights.has(term)) terms.set(term, Math.max(terms.get(term) ?? 0, multiplier));
    }
  }

  const ranking = model.labels.map((label) => ({ label, score: 0, signals: 0 }));
  let mass = 0;
  for (const [term, importance] of terms) {
    const phrase = term.includes(' ');
    const weight = importance * (phrase ? 0.75 : 1);
    const values = model.weights.get(term);
    mass += weight;
    for (const [index, candidate] of ranking.entries()) {
      candidate.score += weight * values[index];
      if (values[index] >= 0.24) candidate.signals += 1;
    }
  }
  if (mass) {
    for (const candidate of ranking) candidate.score /= mass;
  }
  return ranking.sort((first, second) => second.score - first.score);
}

function topicsFor([first, ...others]) {
  const margin = first.score - others[0].score;
  const hasEvidence = first.score >= 0.19 || (first.score >= 0.15 && first.signals >= 3 && margin >= 0.09);
  if (!hasEvidence || !first.signals) return { labels: [], confidence: 'low' };
  const threshold = Math.max(0.13, first.score * 0.42);
  const matches = others.filter((candidate) => candidate.score >= threshold && candidate.signals >= 2).slice(0, 2);
  const clear = margin >= 0.09 || matches.length > 0;
  let confidence = 'low';
  if (first.signals >= 5 && first.score >= 0.26 && clear) confidence = 'high';
  else if (first.signals >= 2) confidence = 'medium';
  return { labels: [first.label, ...matches.map((candidate) => candidate.label)], confidence };
}

function moodFor([first, second]) {
  const margin = first.score - second.score;
  if (first.signals === 0 || margin < 0.035) return { label: 'reflective', confidence: 'low' };
  let confidence = 'low';
  if (first.signals >= 4 && margin >= 0.18) confidence = 'high';
  else if (first.signals >= 2 && margin >= 0.085) confidence = 'medium';
  return { label: first.label, confidence };
}

/** Confidence summarizes the amount and separation of evidence in the corpus. */
export function sortEssay({ title, description, body } = {}) {
  const heading = prose(boundedText(title, 400));
  const summary = prose(boundedText(description, 800));
  const draft = prose(boundedText(body, 24_000));
  const topical = topicsFor(rank(topicModel, [[heading, 2.5], [summary, 1.65], [draft, 1]]));
  const tone = moodFor(rank(moodModel, [[heading, 1], [summary, 1.15], [draft, 1.25]]));
  return {
    topics: topical.labels,
    mood: tone.label,
    confidence: { topics: topical.confidence, mood: tone.confidence },
  };
}
