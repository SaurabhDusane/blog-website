import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { registerNewsletter } from './scripts/dev-newsletter.mjs';
import { remarkSearchPassages } from './scripts/remark-search-passages.mjs';
import { offlineAssets } from './scripts/offline-assets.mjs';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const vercelSite = process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const site = process.env.SITE_URL || env.SITE_URL || vercelSite || process.env.URL || 'https://blog-website-cstz.netlify.app';
const preview = process.env.SECOND_INK_INCLUDE_DRAFTS === '1';
let redirectedPaths = new Set();

const redirects = {
  name: 'second-ink-document-redirects',
  hooks: {
    'astro:build:done': ({ dir }) => {
      // Astro ignores route files beginning with an underscore.
      const source = new URL('posts/redirects.txt', dir);
      const target = new URL('_redirects', dir);
      renameSync(source, target);
      redirectedPaths = new Set(readFileSync(target, 'utf8').trim().split('\n')
        .filter(Boolean).map((line) => line.split(' ')[0]));
    },
  },
};

function isIndexable(url) {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/desk/') || ['/saved/', '/offline/', '/under-the-blotter/', '/document-template/'].includes(pathname)) return false;
  return !redirectedPaths.has(pathname);
}

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  markdown: { remarkPlugins: [remarkSearchPassages] },
  integrations: [
    mdx(),
    redirects,
    ...(!preview ? [sitemap({ filter: isIndexable }), offlineAssets()] : []),
    registerNewsletter(),
  ],
});
