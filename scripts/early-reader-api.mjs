import { authorizeDesk, readJson } from './api.mjs';
import { digest, randomToken, sameDigest } from './reader-crypto.mjs';
import { logOperation } from './operations-log.mjs';

const day = 24 * 60 * 60 * 1000;
const tokenShape = /^[a-f0-9]{64}$/;
const id = (value) => Number.isSafeInteger(value) && value > 0;
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const reply = (value, status = 200) => Response.json(value, { status, headers });
const error = (message, status) => reply({ message }, status);

export function reviewOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}

async function guestAllowed(request, env) {
  const supplied = request.headers.get('X-Second-Ink-Review-Bridge');
  if (supplied !== null) {
    const expected = env.SECOND_INK_REVIEW_BRIDGE_SECRET;
    return tokenShape.test(supplied) && tokenShape.test(expected ?? '') && sameDigest(supplied, expected);
  }
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site'
    && request.headers.get('Origin') === new URL(request.url).origin;
}

async function handleGuest(request, context) {
  if (request.method !== 'POST') return error('Open the invitation in your browser.', 405);
  if (!await guestAllowed(request, context.env)) return error('Open the invitation again to continue.', 403);
  const { data, response } = await readJson(request, 16000);
  if (response) return response;
  if (typeof data.token !== 'string' || !tokenShape.test(data.token)) return error('This invitation is unavailable.', 404);
  const hash = await digest(data.token);
  const now = Date.now();
  const draft = await context.storage.earlyDraft(hash, now);
  if (!draft) return error('This invitation expired or was turned off.', 404);
  if (data.action === 'read') return reply({ draft: { ...draft, responded: Boolean(draft.responded) } });
  if (data.action !== 'reply') return error('Choose how to use the invitation.', 422);
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!note || note.length > 3000) return error('Write a note up to 3,000 characters.', 422);
  if (draft.responded || !await context.storage.leaveEarlyNote(hash, note, now)) {
    return error('This invitation already has a reply or is closed.', 409);
  }
  return reply({ ok: true }, 201);
}

async function handleOwner(request, url, context) {
  const denied = await authorizeDesk(request, context);
  if (denied) return denied;
  const publicOrigin = tokenShape.test(context.env.SECOND_INK_REVIEW_BRIDGE_SECRET ?? '')
    ? reviewOrigin(context.env.SECOND_INK_REVIEW_ORIGIN) : null;
  const { storage } = context;
  if (request.method === 'GET') {
    const revision = Number(url.searchParams.get('revision'));
    if (!id(revision)) return error('Open a saved version first.', 422);
    return reply({ invites: await storage.earlyInvites(revision), externalReview: Boolean(publicOrigin) });
  }
  if (request.method !== 'POST' && request.method !== 'DELETE') return error('Open a saved version first.', 405);
  const { data, response } = await readJson(request);
  if (response) return response;
  if (!id(data.revision)) return error('Open a saved version first.', 422);
  const now = Date.now();
  if (request.method === 'DELETE') {
    if (!id(data.invite)) return error('Choose an invitation to close.', 422);
    return await storage.revokeEarlyInvite(data.revision, data.invite, now)
      ? reply({ ok: true }) : error('This invitation is unavailable.', 404);
  }
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (label.length > 100 || ![1, 3, 7, 14].includes(data.days)) return error('Choose how long the link should work.', 422);
  const token = randomToken();
  const invite = await storage.createEarlyInvite(data.revision, await digest(token), label || 'Early reader', now, now + data.days * day);
  if (!invite) return error('Save this version and close any unused links before creating another.', 409);
  return reply({ invite, href: `${publicOrigin ?? url.origin}/early-reader/#${token}` }, 201);
}

export async function handleEarlyReader(request, url, context) {
  const path = url.pathname.replace(/\/$/, '');
  if (path !== '/api/admin/early-readers' && path !== '/api/early-reader') return;
  try {
    return path === '/api/early-reader' ? await handleGuest(request, context) : await handleOwner(request, url, context);
  } catch {
    logOperation('error', 'early-reader', 'unavailable');
    return error('Early reader access is briefly unavailable.', 503);
  }
}
