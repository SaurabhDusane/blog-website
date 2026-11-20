import { getCollection, type CollectionEntry } from 'astro:content';
import { getPosts, postPath, postRedirects } from './content';

type Edition = CollectionEntry<'editions'>;
type Post = CollectionEntry<'posts'>;

export async function getEditions() {
  const editions = await getCollection('editions');
  return editions.sort((first, second) =>
    second.data.publishedAt.getTime() - first.data.publishedAt.getTime() || first.id.localeCompare(second.id),
  );
}

export function editionPath(edition: Edition) {
  return '/editions/' + edition.id + '/';
}

export function editionEssays(edition: Edition, posts: Post[]) {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const aliases = postRedirects(posts);
  const seen = new Set<string>();
  return edition.data.posts.flatMap(({ post, note }) => {
    const entry = byId.get(post) ?? aliases.get(post);
    if (!entry || entry.data.locale !== edition.data.locale || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [{ entry, note }];
  });
}

export async function editionEntries(published?: Post[]) {
  const [editions, posts] = await Promise.all([getEditions(), published ?? getPosts()]);
  return editions.map((edition) => {
    const essays = editionEssays(edition, posts);
    const discoverable = essays.filter(({ entry }) => !entry.data.looseThread).length >= 2;
    return { edition, essays, discoverable };
  });
}

export function editionNewsletter(edition: Edition, essays: ReturnType<typeof editionEssays>, site: URL) {
  const title = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/[\\[\]*_<>#]/g, '\\$&');
  const parts = ['# ' + title(edition.data.title), edition.body?.trim() || edition.data.description];
  if (essays.length) {
    parts.push(essays.map(({ entry, note }, index) => {
      const link = new URL(postPath(entry), site);
      const line = String(index + 1) + '. [' + title(entry.data.title) + '](' + link.href + ') · ' + entry.data.minutes + ' min';
      return note ? line + '\n   ' + note.replace(/\s+/g, ' ').trim() : line;
    }).join('\n\n'));
  }
  parts.push('[Open this edition](' + new URL(editionPath(edition), site).href + ')');
  return parts.join('\n\n') + '\n';
}

export const editionDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
