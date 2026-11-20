import type { APIContext } from 'astro';
import { draftsEnabled } from '../lib/content';

export function GET({ site, url }: APIContext) {
  if (draftsEnabled()) {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap-index.xml', site ?? url)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
