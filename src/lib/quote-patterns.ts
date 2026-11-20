import type { SavedQuote } from './reader-state';

const themes = [
  ['trust', /\b(?:trust(?:s|ed|ing|worthy)?|distrust|credibility|reliability|broken promises?)\b/i],
  ['attention', /\b(?:attention|attentive|distraction(?:s)?|distracted|concentrat(?:e|ion|ing)|focus(?:ed|ing)?)\b/i],
  ['power and authority', /\b(?:power|authority|influence|hierarch(?:y|ies)|leverage|who decides)\b/i],
  ['doubt and certainty', /\b(?:doubt|uncertaint(?:y|ies)|uncertain|certainty|assumption(?:s)?|skeptic(?:al|ism)?)\b/i],
  ['freedom and choice', /\b(?:freedom|liberty|autonomy|agency|choice(?:s)?|consent)\b/i],
  ['belonging', /\b(?:belong(?:ing|s)?|community|communities|solidarity|loneliness|excluded)\b/i],
  ['changing a habit', /\b(?:habit(?:s|ual)?|routine(?:s)?|friction|defaults?|rituals?)\b/i],
  ['memory', /\b(?:memory|memories|remember(?:s|ed|ing)?|forget(?:s|ting)?|forgot(?:ten)?)\b/i],
] as const;

interface QuoteWithTopics {
  quote: SavedQuote;
  topics: string;
}

export function findQuotePattern(entries: QuoteWithTopics[]) {
  if (new Set(entries.map(({ quote }) => quote.postId)).size < 3) return;
  let strongest: { theme: string; quotes: SavedQuote[]; diversity: number; count: number } | undefined;
  for (const [theme, matches] of themes) {
    const byEssay = new Map<string, QuoteWithTopics>();
    for (const entry of entries) {
      if (!byEssay.has(entry.quote.postId) && matches.test(entry.quote.text)) {
        byEssay.set(entry.quote.postId, entry);
      }
    }
    if (byEssay.size < 3) continue;

    const candidates = [...byEssay.values()];
    const seenTopics = new Set<string>();
    const varied = candidates.filter(({ topics }) => {
      if (!topics || seenTopics.has(topics)) return false;
      seenTopics.add(topics);
      return true;
    }).slice(0, 3);
    const diversity = varied.length;
    if (strongest && (strongest.diversity > diversity
      || strongest.diversity === diversity && strongest.count >= byEssay.size)) continue;

    for (const entry of candidates) {
      if (varied.length >= 3) break;
      if (!varied.includes(entry)) varied.push(entry);
    }
    strongest = { theme, quotes: varied.map(({ quote }) => quote), diversity, count: byEssay.size };
  }
  return strongest;
}
