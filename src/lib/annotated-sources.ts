import { getCollection, type CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;
type Source = CollectionEntry<'sources'>;

export function sourceAnchor(id: string) {
  return `source-${id}`;
}

export async function sourceIndex() {
  const entries = await getCollection('sources');
  return new Map(entries.map((entry) => [entry.id, entry]));
}

export function annotatedSources(post: Post, index: ReadonlyMap<string, Source>) {
  const seen = new Set<string>();
  return (post.data.sources ?? []).flatMap(({ source: { id }, role, note }) => {
    const record = index.get(id);
    if (!record || seen.has(id)) return [];
    seen.add(id);
    return [{ id, role, note, ...record.data }];
  });
}
