import type { APIContext } from 'astro';
import { getPosts } from '../../../lib/content';
import { editionEssays, editionNewsletter, getEditions } from '../../../lib/editions';

export async function getStaticPaths() {
  const [editions, posts] = await Promise.all([getEditions(), getPosts()]);
  return editions.map((edition) => ({
    params: { slug: edition.id },
    props: { edition, essays: editionEssays(edition, posts) },
  }));
}

export function GET({ props, site, url }: APIContext) {
  const { edition, essays } = props as Awaited<ReturnType<typeof getStaticPaths>>[number]['props'];
  return new Response(editionNewsletter(edition, essays, site ?? url), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
