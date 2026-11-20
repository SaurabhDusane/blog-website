import { relayEarlyReader } from './early-reader-relay.mjs';
import { relayPublicReader } from './public-reader-relay.mjs';

export function createEarlyReaderSite(assets) {
  const security = {
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (['/api/early-reader', '/api/early-reader/'].includes(pathname)) return relayEarlyReader(request, env);
      const participation = await relayPublicReader(request, env);
      if (participation) return participation;
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: security });
      const asset = assets[pathname === '/' || pathname === '/early-reader' ? '/early-reader/' : pathname];
      if (!asset) return new Response('This page is only for draft invitations.', { status: 404, headers: security });
      const [type, content, binary] = asset;
      const body = request.method === 'HEAD' ? null : binary ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0)) : content;
      return new Response(body, { headers: {
        ...security, 'Content-Type': type,
        'Cache-Control': pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      } });
    },
  };
}
