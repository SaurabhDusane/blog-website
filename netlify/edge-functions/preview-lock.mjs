export const config = { path: '/*', onError: 'fail' };

const blockedPath = /^\/(?:api|\.netlify|desk|offline|offline-worker\.js|manifest\.webmanifest)(?:\/|$)/i;

function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Netlify-CDN-Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default async function previewLock(request, context) {
  const url = new URL(request.url);
  // This authenticated identity is supplied by Netlify for a native private project.
  // A change to public visibility must leave both production and preview content locked.
  if (url.protocol !== 'https:' || !context.user?.id) {
    return privateResponse(new Response('Sign in to the private Second Ink project on Netlify.', { status: 401 }));
  }
  if (context.deploy?.context === 'production' && context.deploy.published === true) return;

  let path = '';
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+/g, '/');
  } catch {
    // Leave invalid path encoding blocked.
  }
  if (!path || /%(?:2f|5c)/i.test(url.pathname)
    || blockedPath.test(path) || !['GET', 'HEAD'].includes(request.method)) {
    return privateResponse(new Response('This route is unavailable in the preview.', { status: 404 }));
  }

  return privateResponse(await context.next());
}
