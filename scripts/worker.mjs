import { handleApi, isApiPath, parsePostCatalog } from './api.mjs';
import { createD1Storage } from './d1-storage.mjs';
import { handleEditorialApi } from './editorial-api.mjs';
import { handleEditorialPage } from './editorial-pages.mjs';
import { handleEarlyReader } from './early-reader-api.mjs';

function decodeAsset(body) {
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function respondWithAsset(request, pathname, asset, status = 200) {
  let cache = 'no-cache';
  if (pathname.startsWith('/_astro/')) cache = 'public, max-age=31536000, immutable';
  if (/^\/posts\/[a-z0-9-]+\/$/.test(pathname)) cache = 'private, max-age=60';
  if (/^\/og\/posts\/[a-z0-9-]+\.jpg$/.test(pathname)) cache = 'private, max-age=31536000, immutable';
  const headers = {
    'Content-Type': asset.type,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    ETag: asset.etag,
  };
  const knownEtags = request.headers.get('If-None-Match')?.split(',').map((etag) => etag.trim().replace(/^W\//, ''));
  if (status === 200 && (knownEtags?.includes(asset.etag) || knownEtags?.includes('*'))) {
    return new Response(null, { status: 304, headers });
  }
  const body = request.method === 'HEAD' ? null : asset.binary ? decodeAsset(asset.body) : asset.body;
  return new Response(body, { status, headers });
}

function respondWithText(request, text, status, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

function serveAsset(request, url, assets, redirects) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respondWithText(request, 'This page is here for reading.', 405, { Allow: 'GET, HEAD' });
  }
  const { pathname, search } = url;
  const canonical = pathname.endsWith('/index.html')
    ? pathname.slice(0, -'index.html'.length)
    : `${pathname}/`;
  if (assets[canonical] && pathname !== canonical) {
    return new Response(null, { status: 308, headers: { Location: canonical + search } });
  }
  const redirect = redirects[pathname];
  if (typeof redirect === 'string') return new Response(null, { status: 301, headers: { Location: redirect + search } });
  const asset = assets[pathname];
  if (asset && pathname !== '/404.html') return respondWithAsset(request, pathname, asset);

  const missing = assets['/404.html'];
  return missing
    ? respondWithAsset(request, '/404.html', missing, 404)
    : respondWithText(request, 'This page has slipped out of the journal.', 404);
}

export function createWorker(assets, redirects = {}) {
  const catalog = () => parsePostCatalog(JSON.parse(assets['/posts/catalog.json']?.body ?? '[]'));
  return {
    async fetch(request, env, local) {
      const url = new URL(request.url);
      const context = {
        storage: local?.storage ?? createD1Storage(env.DB),
        bucket: local?.bucket ?? env.BUCKET,
        env,
        catalog,
        exists: (pathname) => Object.hasOwn(assets, pathname) || Object.hasOwn(redirects, pathname),
        ip: local?.ip ?? request.headers.get('CF-Connecting-IP'),
      };
      const editorial = await handleEarlyReader(request, url, context) ?? await handleEditorialApi(request, context)
        ?? await handleEditorialPage(request, url, context, assets);
      if (editorial) return editorial;
      if (!isApiPath(url.pathname)) return serveAsset(request, url, assets, redirects);
      return handleApi(request, {
        ...context,
        backupBucket: env.BUCKET,
      });
    },
  };
}
