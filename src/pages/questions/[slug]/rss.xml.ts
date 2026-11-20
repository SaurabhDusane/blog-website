import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { postPath } from '../../../lib/content';
import { questionEntries } from '../../../lib/questions';

export async function getStaticPaths() {
  return (await questionEntries()).map((props) => ({ params: { slug: props.question.id }, props }));
}

export const GET: APIRoute = (context) => {
  const { question, entries } = context.props as Awaited<ReturnType<typeof questionEntries>>[number];
  return rss({
    title: question.data.title,
    description: question.data.description,
    site: context.site ?? context.url,
    items: entries.map(({ post, addedAt, note }) => ({ title: post.data.title, link: postPath(post), pubDate: addedAt, description: note ?? post.data.description })),
  });
};
