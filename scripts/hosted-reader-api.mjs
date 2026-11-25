import { handleApi, parsePostCatalog } from './api.mjs';
import { sameDigest } from './reader-crypto.mjs';
import { readPublicCatalog } from './public-catalog.mjs';
import { publicReaderPrefix, publicReaderRoute, readReaderBytes, readerApiError, readerOrigin, readerSecretPattern } from './public-reader-relay.mjs';

export function createHostedReaderApi() {
  let catalog;
  let loadedAt = 0;
  let source;
  async function publicCatalog(origin) {
    if (source === origin.origin && Date.now() - loadedAt < 30_000) return catalog;
    catalog = parsePostCatalog(await readPublicCatalog(origin));
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
