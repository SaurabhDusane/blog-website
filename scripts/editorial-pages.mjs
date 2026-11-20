import { micromark } from 'micromark';
import { parseFragment } from 'parse5';
import { serveEditorialMedia } from './editorial-media.mjs';
import { logOperation } from './operations-log.mjs';
import { essayTopics } from './essay-classifier.mjs';
import { journalAuthorPath } from '../src/lib/journal-author.mjs';

const deskPost = /^\/posts\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/index\.html|\/)?$/;
const originalPath = /^\/document-originals\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
const characters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => characters[char]);
const privateHeaders = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
const templatePath = '/document-template/';

function response(request, body, type) {
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { ...privateHeaders, 'Content-Type': type },
  });
}

function article(template, publication) {
  const { slug, title, description, body, documentKey, publishedAt, topics = [], mood = 'reflective' } = publication;
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(publishedAt));
  const minutes = Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 220));
  const values = {
    'DESK-TITLE': escape(title),
    'DESK-DESCRIPTION': escape(description),
    'DESK-DATE': escape(date),
    'DESK-PUBLISHED': escape(publishedAt),
    'DESK-SLUG': slug,
    'DESK-MINUTES': String(minutes),
    'DESK-TOPICS': topics.length ? `<div class="reader-header__topics">${topics.filter((id) => Object.hasOwn(essayTopics, id))
      .map((id) => `<a class="eyebrow" href="/topics/${id}/">${escape(essayTopics[id])}</a>`).join('')}</div>` : '',
    'DESK-MOOD': escape(mood),
    'DESK-DOCUMENT': documentKey?.endsWith('.pdf') ? `<p class="desk-essay__original"><a href="/document-originals/${slug}/">Download the original PDF</a></p>` : '',
    'DESK-PROSE': micromark(body),
    'document-template/': `posts/${slug}/`,
  };
  return template.replace(/DESK-(?:TITLE|DESCRIPTION|DATE|PUBLISHED|SLUG|MINUTES|TOPICS|MOOD|DOCUMENT|PROSE)|document-template\//g, (token) => values[token]);
}

function feed(request, asset, rows, path) {
  const canonical = asset.body.match(path === '/rss.xml' ? /<link>(https?:\/\/[^<]+)<\/link>/ : /<loc>(https?:\/\/[^<]+)<\/loc>/)?.[1];
  const origin = new URL(canonical ?? request.url).origin;
  if (path === '/rss.xml') {
    const items = rows.map(({ slug, title, description, publishedAt }) => {
      const link = `${origin}/posts/${slug}/`;
      return `<item><title>${escape(title)}</title><description>${escape(description)}</description><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(publishedAt).toUTCString()}</pubDate></item>`;
    }).join('');
    return response(request, asset.body.replace(/<item>|<\/channel>/, (match) => items + match), asset.type);
  }
  const items = rows.map(({ slug, updatedAt }) => `<url><loc>${origin}/posts/${slug}/</loc><lastmod>${escape(updatedAt)}</lastmod></url>`).join('');
  return response(request, asset.body.replace('</urlset>', () => items + '</urlset>'), asset.type);
}

function archiveRows(page, rows, collection) {
  const template = /<template\b[^>]*\bid="desk-essay-row"[^>]*>([\s\S]*?)<\/template>/;
  const count = /(<p\b[^>]*\bdata-result-count\b[^>]*>)(\d+) (essay|note|piece)s?(<\/p>)/;
  if (!template.test(page)) return page;
  const rendered = page.replace(template, (_match, html) => rows.map(({ slug, title, description, body, mood = 'reflective', topics = [] }) => {
    const minutes = Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 220));
    const ids = topics.filter((id) => Object.hasOwn(essayTopics, id));
    const values = { SLUG: slug, TITLE: escape(title), DESCRIPTION: escape(description), MOOD: escape(mood), TOPICS: ids.join(' '),
      LABELS: escape(ids.map((id) => essayTopics[id]).join(' ')) };
    return html.replace(/DESK-ROW-(SLUG|TITLE|DESCRIPTION|MOOD|TOPICS|LABELS)|data-minutes="0"|>0 min</g, (placeholder, field) => (
      field ? values[field] : placeholder.replace('0', String(minutes))
    ));
  }).join(''));
  if (collection) return rendered.replace(/<p\b[^>]*\bdata-desk-essay-empty\b[^>]*>[^<]*<\/p>/, '');
  return rendered.replace(count, (_match, start, base, label, end) => {
    const total = Number(base) + rows.length;
    const noun = label === 'essay' ? 'essay' : 'piece';
    return `${start}${total} ${noun}${total === 1 ? '' : 's'}${end}`;
  });
}

function passageText(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.tagName === 'br' || node.tagName === 'hr') return ' ';
  const separator = ['ol', 'ul', 'li', 'table', 'tr'].includes(node.tagName) ? ' ' : '';
  return (node.childNodes ?? []).map(passageText).join(separator);
}

function archiveIndex(json, rows) {
  const entries = JSON.parse(json);
  for (const { slug, body } of rows) {
    const passages = parseFragment(micromark(body)).childNodes;
    entries[`/posts/${slug}/`] = passages.filter(({ tagName }) => tagName)
      .map((node) => passageText(node).replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  return JSON.stringify(entries);
}

export async function handleEditorialPage(request, url, context, assets) {
  const { pathname, search } = url;
  if (pathname === templatePath || pathname === '/document-template' || pathname === '/document-template/index.html') {
    return new Response(null, { status: 404 });
  }
  if (!context.bucket || (request.method !== 'GET' && request.method !== 'HEAD')) return;
  const post = deskPost.exec(pathname)?.[1];
  const original = originalPath.exec(pathname)?.[1];
  const isFeed = pathname === '/rss.xml' || pathname === '/sitemap-0.xml';
  const isArchive = pathname === '/explore/' || pathname === '/explore/index.json';
  const isAuthor = pathname === journalAuthorPath;
  const topic = /^\/topics\/([a-z0-9-]+)\/$/.exec(pathname)?.[1];
  const isTopic = Boolean(topic && Object.hasOwn(essayTopics, topic));
  if (!(isFeed || isArchive || isTopic || isAuthor || original || (post && post.length <= 80 && !context.exists(`/posts/${post}/`)))) return;
  try {
    if (isArchive || isTopic || isAuthor) {
      const asset = assets[pathname];
      if (!asset) return;
      const rows = (await context.storage.deskPublications({ includeBody: true }))
        .filter(({ slug, topics }) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
          && !context.exists(`/posts/${slug}/`) && (!isTopic || topics?.includes(topic)));
      if (!rows.length) return;
      const body = pathname === '/explore/index.json' ? archiveIndex(asset.body, rows) : archiveRows(asset.body, rows, isTopic || isAuthor);
      return response(request, body, asset.type);
    }
    if (isFeed) {
      const rows = (await context.storage.deskPublications()).filter(({ slug }) => !context.exists(`/posts/${slug}/`));
      if (rows.length && assets[pathname]) return feed(request, assets[pathname], rows, pathname);
      return;
    }
    const publication = await context.storage.deskPublication(post ?? original);
    if (!publication) return;
    if (original) {
      if (context.exists(`/posts/${original}/`) || !publication.documentKey?.endsWith('.pdf')) return;
      return serveEditorialMedia(request, context.bucket, publication.documentKey, publication.filename);
    }
    if (pathname !== `/posts/${post}/`) return new Response(null, { status: 308, headers: { Location: `/posts/${post}/${search}` } });
    if (assets[templatePath]) return response(request, article(assets[templatePath].body, publication), assets[templatePath].type);
  } catch {
    // A temporary desk outage should leave the original blog and feeds readable.
    logOperation('error', 'desk-essay', 'unavailable');
  }
}
