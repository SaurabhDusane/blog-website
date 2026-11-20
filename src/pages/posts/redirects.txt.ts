import type { APIRoute } from 'astro';
import { getDraftPosts, getPosts, postPath, postRedirects } from '../../lib/content';

export const GET: APIRoute = async () => {
  const [posts, drafts] = await Promise.all([getPosts(), getDraftPosts()]);
  const draftIds = new Set(drafts.map(({ id }) => id));
  const lines = Array.from(postRedirects(posts), ([alias, post]) => (
    draftIds.has(alias) ? '' : `/posts/${alias}/ ${postPath(post)} 301!`
  )).filter(Boolean);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
