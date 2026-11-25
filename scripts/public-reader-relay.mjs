import { sign } from './reader-crypto.mjs';

const routes = new Map([
  ['reading', 'POST'], ['feedback', 'GET, POST'], ['stance', 'GET, POST'],
  ['reconsideration', 'GET, POST'], ['field-notes', 'GET, POST'],
  ['moods', 'GET'], ['reply', 'POST'],
  ['readership', 'POST'],
  ['newsletter', 'POST'], ['newsletter-confirm', 'POST'], ['newsletter-unsubscribe', 'POST'],
]);

export const publicReaderPrefix = '/api/public-reader/';
export const readerSecretPattern = /^[a-f0-9]{64}$/;
const responseHeaders = {
  'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};

export function readerOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && value === url.origin && !url.port ? url : null;
  } catch { return null; }
}

export function publicReaderRoute(path, prefix = '/api/') {
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).replace(/\/$/, '');
  const methods = routes.get(name);
  return methods ? { name, methods } : null;
}

export async function readReaderBytes(message, limit) {
  const body = message.body;
  if (!body || Number(message.headers.get('Content-Length')) > limit) return null;
  const bytes = new Uint8Array(limit);
  const reader = body.getReader();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, length);
      if (length + value.length > limit) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, length);
      length += value.length;
    }
  } finally { reader.releaseLock(); }
}

export function readerApiError(message, status, code, headers) {
  return Response.json({ ok: false, message, code }, { status, headers: { ...responseHeaders, ...headers } });
}

export async function relayPublicReader(request, env) {
  const source = new URL(request.url);
  const route = publicReaderRoute(source.pathname);
  if (!route) return;

  const browser = readerOrigin(env.SECOND_INK_PUBLIC_READER_ORIGIN);
  if (!browser || request.headers.get('Origin') !== browser.origin) {
    return readerApiError('Open the essay on Second Ink to respond.', 403, 'origin', { Vary: 'Origin' });
  }
  const cors = {
    ...responseHeaders, Vary: 'Origin', 'Access-Control-Allow-Origin': browser.origin,
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  const unavailable = () => readerApiError('The reader forms are briefly unavailable.', 503, 'unavailable', cors);
  const methods = route.methods.split(', ');
  if (request.method === 'OPTIONS') {
    if (!methods.includes(request.headers.get('Access-Control-Request-Method'))) {
      return readerApiError('Open the form on Second Ink to respond.', 405, 'method', cors);
    }
    return new Response(null, { status: 204, headers: {
      ...cors, 'Access-Control-Allow-Methods': route.methods,
      'Access-Control-Allow-Headers': 'Content-Type, X-Second-Ink-Reader', 'Access-Control-Max-Age': '600',
    } });
  }
  if (!methods.includes(request.method)) return readerApiError('Open the form on Second Ink to respond.', 405, 'method', cors);

  const upstream = readerOrigin(env.SECOND_INK_REVIEW_UPSTREAM);
  const service = env.SECOND_INK_REVIEW_UPSTREAM_TOKEN;
  const secret = env.SECOND_INK_PUBLIC_READER_SECRET;
  if (!upstream?.hostname.endsWith('.chatgpt.site') || !service || !readerSecretPattern.test(secret ?? '')) return unavailable();

  const target = new URL(`${publicReaderPrefix}${route.name}/`, upstream);
  target.search = source.search;
  const headers = new Headers({
    Accept: 'application/json', 'OAI-Sites-Authorization': `Bearer ${service}`, 'X-Second-Ink-Public-Reader': secret,
  });
  for (const name of ['Content-Type', 'X-Second-Ink-Reader']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const address = request.headers.get('CF-Connecting-IP');
    if (address && /^[a-f0-9:.]{3,45}$/i.test(address)) {
      headers.set('X-Second-Ink-Reader-Rate-Key', await sign(secret, `reader-rate\0${address}`));
    }
    const limit = route.name === 'reply' ? 64 * 1024 : 16 * 1024;
    const body = request.method === 'POST' ? await readReaderBytes(request, limit) : undefined;
    if (body === null) return readerApiError('This response came through a little too full.', 413, 'too-large', cors);
    const result = await fetch(target, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if ((result.status >= 300 && result.status < 400) || result.status === 401
      || !result.headers.get('Content-Type')?.startsWith('application/json')) return unavailable();
    const retry = result.headers.get('Retry-After');
    if (retry) cors['Retry-After'] = retry;
    return new Response(result.body, { status: result.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch { return unavailable(); }
}
