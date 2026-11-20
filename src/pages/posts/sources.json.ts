import { getPosts } from '../../lib/content';
import { annotatedSources, sourceAnchor, sourceIndex } from '../../lib/annotated-sources';

export async function GET() {
  const [posts, index] = await Promise.all([getPosts(), sourceIndex()]);
  const sources = posts.flatMap((post) => {
    const { id, data } = post;
    const legacy = data.sourceUrl ? [{ id, url: data.sourceUrl, hasArchive: Boolean(data.archiveUrl) }] : [];
    return [...legacy, ...annotatedSources(post, index).map((source) => ({
      id: `${id}#${sourceAnchor(source.id)}`,
      url: source.url,
      hasArchive: Boolean(source.archiveUrl),
    }))];
  });

  return new Response(JSON.stringify(sources), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
