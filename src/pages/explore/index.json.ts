import type { APIRoute } from 'astro';
import { render } from 'astro:content';
import { getPosts, postPath } from '../../lib/content';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const entries = await Promise.all(posts.map(async (post) => {
    const imported = post.data.documentSource ?? post.data.wordSource;
    if (imported) return [postPath(post), imported.passages] as const;
    const { remarkPluginFrontmatter } = await render(post);
    const passages: unknown = remarkPluginFrontmatter.searchPassages;

    return [
      postPath(post),
      Array.isArray(passages) ? passages.filter((passage) => typeof passage === 'string') : [],
    ] as const;
  }));

  return Response.json(Object.fromEntries(entries));
};
