import rawCatalog from '../../dist/posts/catalog.json' with { type: 'json' };
import { handleApi, isApiPath, parsePostCatalog } from '../../scripts/api.mjs';
import { createD1Storage } from '../../scripts/d1-storage.mjs';
import { createRestDatabase } from '../../scripts/netlify-d1.mjs';

const catalog = parsePostCatalog(rawCatalog);

export const config = { path: '/api/*' };

export default function journal(request, context) {
  if (context.deploy?.context !== 'production' || context.deploy.published !== true) {
    return new Response('This route is unavailable in the preview.', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    });
  }
  if (!isApiPath(new URL(request.url).pathname)) return new Response('Page missing.', { status: 404 });

  const accountId = process.env.SECOND_INK_D1_ACCOUNT_ID;
  const databaseId = process.env.SECOND_INK_D1_DATABASE_ID;
  const token = process.env.SECOND_INK_D1_TOKEN;
  if (!accountId || !databaseId || !token) {
    return Response.json({ ok: false, message: 'This desk is still being set up.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const storage = createD1Storage(createRestDatabase({ accountId, databaseId, token }));
  return handleApi(request, {
    storage,
    env: process.env,
    catalog,
    ip: context.ip,
  });
}
