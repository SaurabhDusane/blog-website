import { authorizeDesk, readJson } from './api.mjs';
import { mediaKey, serveEditorialMedia, uploadEditorialMedia } from './editorial-media.mjs';
import { logOperation } from './operations-log.mjs';
import { essayTopics } from './essay-classifier.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validSlug = (value) => typeof value === 'string' && value.length <= 80 && slugPattern.test(value);
const numericId = (value) => Number.isSafeInteger(value) && value > 0;
const clean = (value, length) => typeof value === 'string' ? value.trim().slice(0, length + 1) : '';
const cache = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...cache, 'X-Robots-Tag': 'noindex', ...headers } });
const error = (message, status) => json({ message }, status);
const missing = () => error('This page has slipped out of the journal.', 404);
const method = (allow) => json({ message: 'Open the form from Second Ink.' }, 405, { Allow: allow });
const isRead = (request) => request.method === 'GET' || request.method === 'HEAD';
const now = () => new Date().toISOString();

function documentName(value) {
  const name = clean(value, 220);
  return name.length <= 220 && /^[^/\\\x00-\x1f\x7f]+\.(pdf|docx)$/i.test(name) ? name : null;
}

async function availableEssay({ storage, catalog }, slug) {
  return validSlug(slug) && ((await catalog()).has(slug) || Boolean(await storage.deskPublication(slug)));
}

async function handleDrafts(request, url, context) {
  const { storage, bucket, exists, catalog } = context;
  const slug = url.searchParams.get('post');
  if (request.method === 'GET') {
    if (!slug) {
      const [entries, posts, published] = await Promise.all([storage.deskEntries(), catalog(), storage.deskPublications()]);
      const voicePosts = [...posts.entries(), ...published.filter(({ slug }) => !posts.has(slug)).map(({ slug, title }) => [slug, title])];
      return json({ entries, voicePosts, essayTopics });
    }
    if (!validSlug(slug)) return missing();
    const revisionId = Number(url.searchParams.get('revision'));
    const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    if ((url.searchParams.has('revision') && !numericId(revisionId)) || !numericId(before)) return missing();
    const revision = await storage.deskRevision(slug, revisionId);
    if (!revision) return missing();
    if (url.searchParams.has('download')) {
      return mediaKey(revision.documentKey, 'document')
        ? serveEditorialMedia(request, bucket, revision.documentKey, revision.filename) : missing();
    }
    const [latest, published, history] = await Promise.all([
      revisionId ? storage.deskRevision(slug) : revision,
      storage.deskPublication(slug), storage.deskHistory(slug, before),
    ]);
    const live = published && await storage.deskRevision(slug, published.revision);
    return json({ revision, latest: latest.id, live, history: history.slice(0, 25), nextBefore: history.length > 25 ? history[24].id : null });
  }
  if (request.method !== 'POST' && request.method !== 'PATCH') return method('GET, POST, PATCH');
  const { data, response } = await readJson(request, 256 * 1024);
  if (response) return response;
  if (!validSlug(data.slug)) return error('Use a web address with letters, numbers, and single dashes.', 422);
  if (exists(`/posts/${data.slug}/`)) return error('That address is already used by an essay in the repository.', 409);
  const conflict = () => error('The essay changed in another tab. Open its latest draft and try again.', 409);
  if (request.method === 'PATCH' && data.action === 'publish' && numericId(data.revision)) {
    const published = await storage.publishDeskRevision(data.slug, data.revision, now());
    const live = published || (await storage.deskPublication(data.slug))?.revision === data.revision;
    return live ? json({ slug: data.slug, revision: data.revision }) : conflict();
  }
  if (request.method === 'PATCH' && data.action === 'withdraw' && numericId(data.revision)) {
    const withdrawn = await storage.withdrawDeskPublication(data.slug, data.revision);
    return withdrawn ? json({ ok: true }) : conflict();
  }
  if (!Number.isSafeInteger(data.base) || data.base < 0) return error('Choose a draft to edit.', 422);
  let snapshot;
  if (request.method === 'PATCH') {
    if (data.action !== 'restore' || !numericId(data.revision)) return error('Choose a version to restore.', 422);
    snapshot = await storage.deskRevision(data.slug, data.revision);
    if (!snapshot) return missing();
  } else {
    const title = clean(data.title, 180);
    const description = clean(data.description, 450);
    const body = clean(data.body, 48000);
    if (!title || title.length > 180 || !description || description.length > 450 || !body || body.length > 48000) {
      return error('Add an essay title, a short summary, and up to 48,000 characters of text.', 422);
    }
    let documentKey = null;
    let filename = null;
    if (data.documentKey || data.filename) {
      filename = documentName(data.filename);
      if (!filename || !mediaKey(data.documentKey, 'document') || !data.documentKey.endsWith('.' + filename.split('.').at(-1).toLowerCase())
        || !await bucket.head(data.documentKey)) return error('Upload the original document again before saving it.', 422);
      documentKey = data.documentKey;
    }
    snapshot = { title, description, body, documentKey, filename };
  }
  const revision = await storage.saveDeskRevision(data.slug, data.base, snapshot, now());
  return revision ? json({ revision }, 201) : conflict();
}

async function handleVoice(request, url, context, admin) {
  const { storage, bucket } = context;
  const slug = url.searchParams.get('post');
  if (!await availableEssay(context, slug)) return missing();
  if (isRead(request)) {
    const note = await storage.voiceNote(slug);
    if (url.searchParams.has('audio')) {
      if (!note) return missing();
      return serveEditorialMedia(request, bucket, note.audioKey);
    }
    if (request.method === 'HEAD') return new Response(null, { status: note ? 200 : 404, headers: cache });
    if (!note) return admin ? json({ note: null }) : missing();
    return json({ note: { transcript: note.transcript, src: `/api/voice-note/?post=${slug}&audio=1`, updatedAt: note.updatedAt,
      ...(admin ? { audioKey: note.audioKey } : {}) } });
  }
  if (!admin) return method('GET, HEAD');
  if (request.method === 'DELETE') {
    await storage.removeVoiceNote(slug);
    return json({ note: null });
  }
  if (request.method !== 'PUT') return method('GET, PUT, DELETE');
  const { data, response } = await readJson(request, 64 * 1024);
  if (response) return response;
  const transcript = clean(data.transcript, 12000);
  if (!transcript || transcript.length > 12000 || !mediaKey(data.audioKey, 'audio') || !await bucket.head(data.audioKey)) {
    return error('Choose a recording and include its transcript.', 422);
  }
  await storage.saveVoiceNote(slug, data.audioKey, transcript, now());
  return json({ ok: true });
}

async function handleLinks(request, context) {
  if (request.method !== 'POST') return method('POST');
  const { data, response } = await readJson(request, 24 * 1024);
  if (response) return response;
  if (!Array.isArray(data.links) || data.links.length > 100 || data.links.some((link) => typeof link !== 'string' || link.length > 400)) {
    return error('Check up to 100 links at a time.', 422);
  }
  const origin = new URL(validSlug(data.post) ? `/posts/${data.post}/` : '/', request.url);
  const published = new Set((await context.storage.deskPublications()).map(({ slug }) => `/posts/${slug}/`));
  const results = data.links.map((link) => {
    if (!link) return 'invalid';
    if (link.startsWith('#')) return 'review';
    let url;
    try { url = new URL(link, origin); } catch { return 'invalid'; }
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return 'invalid';
    if (url.origin !== origin.origin) return 'review';
    const path = url.pathname.replace(/\/index\.html$/, '/');
    if (context.exists(path) || context.exists(`${path}/`)) return 'found';
    return published.has(path.endsWith('/') ? path : `${path}/`) ? 'found' : 'missing';
  });
  return json({ results });
}

export async function handleEditorialApi(request, context) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const publishing = path === '/api/admin/publishing' || /^\/api\/admin\/publishing\/(?:upload|links|voice)$/.test(path);
  const publicVoice = path === '/api/voice-note';
  if (!publishing && !publicVoice) return;
  if (!context.bucket) return missing();
  try {
    if (publishing) {
      const denied = await authorizeDesk(request, context);
      if (denied) return denied;
      if (path.endsWith('/voice')) return await handleVoice(request, url, context, true);
      if (path.endsWith('/links')) return await handleLinks(request, context);
      if (path.endsWith('/upload')) {
        if (request.method !== 'POST') return method('POST');
        const kind = url.searchParams.get('kind');
        const filename = documentName(url.searchParams.get('filename'));
        if (kind !== 'audio' && (kind !== 'document' || !filename)) return error('Choose the original file to upload.', 422);
        const outcome = await uploadEditorialMedia(request, context.bucket, kind, filename);
        return outcome.error ? error(outcome.error, outcome.status) : json(outcome, 201);
      }
      return await handleDrafts(request, url, context);
    }
    return await handleVoice(request, url, context, false);
  } catch {
    logOperation('error', publishing ? 'publishing-desk' : 'voice-note', 'unavailable');
    return error('The desk is briefly closed. Try again shortly.', 503);
  }
}
