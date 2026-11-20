import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { journalAuthorId } from './journal-author.mjs';

type Post = CollectionEntry<'posts'>;
type ReadingPath = CollectionEntry<'series'>;

function byPublication(first: Post, second: Post) {
  return second.data.publishedAt.getTime() - first.data.publishedAt.getTime()
    || first.id.localeCompare(second.id);
}

export function draftsEnabled() {
  return process.env.SECOND_INK_INCLUDE_DRAFTS === '1';
}

export async function getPosts() {
  return (await getCollection('posts', (post) => !post.data.documentSource?.draft)).sort(byPublication);
}

export async function getDraftPosts() {
  if (!draftsEnabled()) return [];
  return (await getCollection('posts', (post) => post.data.documentSource?.draft === true)).sort(byPublication);
}

export function postRedirects(posts: Post[]) {
  const taken = new Set(posts.map(({ id }) => id));
  const redirects = new Map<string, Post>();
  for (const post of posts) {
    for (const alias of post.data.redirectFrom ?? []) {
      if (taken.has(alias)) continue;
      taken.add(alias);
      redirects.set(alias, post);
    }
  }
  return redirects;
}

export function readingPathPosts(path: ReadingPath, posts: Post[]) {
  const authoredPositions = new Map(path.data.posts.map(({ id }, index) => [id, index]));
  const included = posts.filter((post) => authoredPositions.has(post.id) || post.data.readingPaths?.includes(path.id));
  return included.sort((first, second) => {
    // Authored stops keep their original order. Uploaded notes follow in publication order.
    const firstPosition = authoredPositions.get(first.id) ?? Infinity;
    const secondPosition = authoredPositions.get(second.id) ?? Infinity;
    return firstPosition === secondPosition ? byPublication(second, first) : firstPosition - secondPosition;
  });
}

export async function getTopics() {
  const topics = await getCollection('topics');
  return topics.sort((first, second) => first.data.name.localeCompare(second.data.name));
}

export async function getJournalAuthor() {
  const author = await getEntry('authors', journalAuthorId);
  if (!author) throw new Error('Second Ink is missing its author profile.');
  return author;
}

export async function getSeries() {
  const series = await getCollection('series');
  return series.sort((first, second) => first.data.title.localeCompare(second.data.title));
}

export async function getPages() {
  const pages = await getCollection('pages');
  return pages.sort((first, second) => first.data.title.localeCompare(second.data.title));
}

export function postPath(post: Post) {
  return `/posts/${post.id}/`;
}

export async function getRelatedPosts(post: Post) {
  const candidates = (await getPosts()).filter((candidate) => {
    return candidate.id !== post.id && candidate.data.locale === post.data.locale;
  });
  const postsById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const authoredIds = new Set(post.data.related?.map(({ id }) => id));
  const authored = [...authoredIds].flatMap((id) => {
    const candidate = postsById.get(id);
    return candidate ? [candidate] : [];
  });
  const topicIds = new Set(post.data.topics.map(({ id }) => id));
  const suggestions = candidates
    .filter((candidate) => !authoredIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      matches: candidate.data.topics.filter(({ id }) => topicIds.has(id)).length,
    }))
    .filter(({ matches }) => matches > 0)
    .sort((first, second) => second.matches - first.matches)
    .map(({ candidate }) => candidate);

  return [...authored, ...suggestions].slice(0, 3);
}
