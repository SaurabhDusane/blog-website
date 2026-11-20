import { handleApi, parsePostCatalog } from './api.mjs';
import { sameDigest } from './reader-crypto.mjs';
import { publicReaderPrefix, publicReaderRoute, readReaderBytes, readerApiError, readerOrigin, readerSecretPattern } from './public-reader-relay.mjs';

export function createHostedReaderApi() {
  let catalog;
  let loadedAt = 0;
  let source;
  async function publicCatalog(origin) {
    if (source === origin.origin && Date.now() - loadedAt < 30_000) return catalog;
    const response = await fetch(new URL('/posts/catalog.json', origin), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/json')) {
      throw new Error('Could not open the public essay catalog.');
    }
    const bytes = await readReaderBytes(response, 512 * 1024);
    if (!bytes) throw new Error('Public essay catalog exceeds its size limit.');
    catalog = parsePostCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    loadedAt = Date.now();
    source = origin.origin;
    return catalog;
  }

  return async function handleHostedReader(request, url, context) {
    if (!url.pathname.startsWith(publicReaderPrefix)) return;
    const route = publicReaderRoute(url.pathname, publicReaderPrefix);
    const origin = readerOrigin(context.env.SECOND_INK_PUBLIC_READER_ORIGIN);
    const expected = context.env.SECOND_INK_PUBLIC_READER_SECRET;
    const secret = request.headers.get('X-Second-Ink-Public-Reader');
    if (!route || !origin || !readerSecretPattern.test(expected ?? '') || !secret || !sameDigest(expected, secret)) {
      return readerApiError('Page missing.', 404, 'not-found');
    }
    if (!route.methods.split(', ').includes(request.method)) return readerApiError('Open the form on Second Ink to respond.', 405, 'method');

    const target = new URL(`/api/${route.name}/`, origin);
    target.search = url.search;
    const headers = new Headers({ Accept: 'application/json' });
    for (const name of ['Content-Type', 'X-Second-Ink-Reader']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const limit = route.name === 'reply' ? 64 * 1024 : 16 * 1024;
    const body = request.method === 'POST' ? await readReaderBytes(request, limit) : undefined;
    if (body === null) return readerApiError('This response came through a little too full.', 413, 'too-large');
    const rateKey = request.headers.get('X-Second-Ink-Reader-Rate-Key');
    const input = new Request(target, { method: request.method, headers, body });
    return handleApi(input, {
      ...context, catalog: () => publicCatalog(origin), publicRelay: true,
      ip: readerSecretPattern.test(rateKey ?? '') ? rateKey : undefined,
    });
  };
}
