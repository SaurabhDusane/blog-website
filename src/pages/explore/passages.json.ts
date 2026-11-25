import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import mdxRenderer from '@astrojs/mdx/server.js';
import { renderedArchivePassages } from '../../../scripts/archive-passages.mjs';
import { getPosts, postPath } from '../../lib/content';

// Passage IDs are assigned in the same order as the reader. Render the prose so
// MDX components, document markup and heading IDs match the published article.
export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: mdxRenderer });
  const entries = await Promise.all(posts.map(async (post) => {
    const { Content } = await render(post);
    try {
      return [postPath(post), renderedArchivePassages(await container.renderToString(Content))] as const;
    } catch (error) {
      console.warn('Could not index rendered passages for ' + post.id, error);
      return [postPath(post), []] as const;
    }
  }));
  return Response.json(Object.fromEntries(entries));
};
