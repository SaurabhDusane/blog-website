import { getCollection, type CollectionEntry } from 'astro:content';
import { getPosts, postRedirects } from './content';

export const questionPath = ({ id }: CollectionEntry<'questions'>) => `/questions/${id}/`;

export async function questionEntries() {
  const [questions, posts] = await Promise.all([getCollection('questions'), getPosts()]);
  const byId = new Map(posts.map((post) => [post.id, post]));
  const aliases = postRedirects(posts);
  return questions.map((question) => {
    const seen = new Set<string>();
    const entries = question.data.posts.flatMap(({ post, addedAt, note }) => {
      const target = byId.get(post) ?? aliases.get(post);
      if (!target || target.data.locale !== question.data.locale || seen.has(target.id)) return [];
      seen.add(target.id);
      return [{ post: target, addedAt, note }];
    });
    return { question, entries };
  });
}
