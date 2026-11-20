import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import mdxRenderer from '@astrojs/mdx/server.js';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { passageAnchor, passageTags } from '../../lib/article-passages';
import { getPosts, postPath } from '../../lib/content';

function textOf(node: DefaultTreeAdapterTypes.ChildNode): string {
  if ('value' in node) return node.value;
  if ('tagName' in node && (node.tagName === 'br' || node.tagName === 'hr')) return ' ';
  if (!('childNodes' in node)) return '';
  const separator = 'tagName' in node && ['ol', 'ul', 'li', 'table', 'tbody', 'thead', 'tfoot', 'tr'].includes(node.tagName) ? ' ' : '';
  return node.childNodes.map(textOf).join(separator);
}

function renderedPassages(html: string) {
  let heading: string | undefined;
  return parseFragment(html).childNodes
    .filter((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && passageTags.includes(node.tagName))
    .flatMap((node, index) => {
      const text = textOf(node).replace(/\s+/g, ' ').trim();
      if (!text) return [];
      if (/^h[2-6]$/.test(node.tagName)) {
        heading = text;
        return [];
      }
      const anchor = node.attrs.find(({ name }) => name === 'id')?.value || passageAnchor(index);
      return [{ text, anchor, heading }];
    });
}

// Passage IDs are assigned in the same order as the reader. Render the prose so
// MDX components, document markup and heading IDs match the published article.
export const GET: APIRoute = async () => {
  const posts = (await getPosts()).filter(({ data }) => !data.looseThread);
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: mdxRenderer });
  const entries = await Promise.all(posts.map(async (post) => {
    const { Content } = await render(post);
    try {
      return [postPath(post), renderedPassages(await container.renderToString(Content))] as const;
    } catch (error) {
      console.warn('Could not index rendered passages for ' + post.id, error);
      return [postPath(post), []] as const;
    }
  }));
  return Response.json(Object.fromEntries(entries));
};
