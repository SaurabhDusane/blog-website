const stop = new Set(('about after again also another because before being both could every first from have here just like made many more most much only other same should some such than that their them then there these they thing think this those through under very want were what when where which while will with would your').split(' '));
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function approvedConnections(value, current) {
  if (!Array.isArray(value) || value.length > 6) return null;
  const seen = new Set();
  const entries = [];
  for (const item of value) {
    const post = item?.post;
    const reason = typeof item?.reason === 'string' ? item.reason.trim() : '';
    if (typeof post !== 'string' || !slug.test(post) || post.length > 96 || post === current || seen.has(post)
      || !reason || reason.length > 600 || reason.includes('\0')) return null;
    seen.add(post);
    entries.push({ post, reason });
  }
  return entries;
}

function tokens(text) {
  return (text.normalize('NFKC').toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((word) => !stop.has(word));
}

export function suggestDeskConnections(draft, catalog, passages) {
  const language = tokens(`${draft.title} ${draft.description} ${draft.body}`);
  const frequencies = new Map();
  for (const word of language) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  if (!frequencies.size) return [];
  const result = [];
  for (const [post, title] of catalog) {
    if (post === draft.slug || !slug.test(post)) continue;
    const text = passages?.[`/posts/${post}/`];
    if (!Array.isArray(text)) continue;
    let best;
    for (const passage of text.slice(0, 90)) {
      if (typeof passage !== 'string' || passage.length < 24) continue;
      const relevant = passage.slice(0, 1800);
      const words = [...new Set(tokens(relevant))];
      const overlap = words.filter((word) => frequencies.has(word));
      if (overlap.length < 2) continue;
      const score = overlap.reduce((sum, word) => sum + Math.min(4, frequencies.get(word)), 0) / Math.sqrt(words.length);
      if (!best || score > best.score) best = { score, relevant, overlap };
    }
    if (!best) continue;
    const excerpt = best.relevant.length <= 300 ? best.relevant : best.relevant.slice(0, 295).replace(/\s+\S*$/, '') + '…';
    const words = best.overlap.sort((first, second) => frequencies.get(second) - frequencies.get(first)).slice(0, 3);
    result.push({ post, title, excerpt, score: best.score, reason: `These essays both touch on ${words.join(', ')}.` });
  }
  return result.sort((first, second) => second.score - first.score).slice(0, 4).map(({ score, ...entry }) => entry);
}
