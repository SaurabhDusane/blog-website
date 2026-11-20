import { handleSubmission, submissionRoute } from './submissions.mjs';
import { digest, randomToken, sameDigest, sign } from './reader-crypto.mjs';
import { checkReadingProof, checkTurnstile, createReadingProof, readingWaitMs, turnstileSettings } from './reader-check.mjs';
import { backupWeek, getWeeklyBackup, listWeeklyBackups, saveWeeklyBackup, weeklyBackupStatus } from './response-backups.mjs';
import { logOperation } from './operations-log.mjs';
import { sortEssay } from './essay-classifier.mjs';

export const readerFeelings = ['inspired', 'thoughtful', 'challenged', 'comforted', 'surprised', 'not-convinced'];
const readerStances = ['agree', 'unsure', 'disagree'];
const reconsiderationStances = [...readerStances, 'still-thinking'];
const stanceMovements = ['kept', 'changed', 'thinking'];
const minimumMovementReaders = 5;
const fieldNotePrompts = new WeakMap();
const fieldNoteStatuses = ['new', 'reviewed', 'archived'];
const fieldNotePageSize = 40;
const validPostId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validReader = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validToken = /^[0-9a-f]{64}$/;
const sessionSeconds = 4 * 60 * 60;
const hour = 60 * 60 * 1000;
const day = 24 * hour;

function routeName(pathname) {
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path === '/api/feedback') return 'feedback';
  if (path === '/api/reading') return 'reading';
  if (path === '/api/stance') return 'stance';
  if (path === '/api/reconsideration') return 'reconsideration';
  if (path === '/api/field-notes') return 'field-notes';
  if (path === '/api/moods') return 'moods';
  if (path === '/api/admin/feedback') return 'dashboard';
  if (path === '/api/admin/field-notes') return 'field-notes-desk';
  if (path === '/api/admin/monthly-note') return 'monthly-note';
  if (path === '/api/admin/session') return 'session';
  if (path === '/api/admin/publishing/sort') return 'essay-sort';
  if (path === '/api/admin/export') return 'export';
  if (path === '/api/admin/backups') return 'backups';
  if (path === '/api/maintenance/weekly-backup') return 'weekly-backup';
  if (path === '/api/health') return 'health';
  return submissionRoute(pathname);
}

export function isApiPath(pathname) {
  return Boolean(routeName(pathname));
}

export function parsePostCatalog(data) {
  if (!Array.isArray(data)) throw new Error('Invalid published post catalog');
  const posts = new Map();
  const prompts = new Map();
  for (const item of data) {
    if (typeof item?.id === 'string' && validPostId.test(item.id)
      && typeof item.title === 'string' && item.title.trim()) {
      posts.set(item.id, item.title);
      const prompt = typeof item.fieldNotePrompt === 'string' && item.fieldNotePrompt.trim();
      if (prompt && prompt.length <= 240 && !prompt.includes('\0')) prompts.set(item.id, prompt);
    }
  }
  fieldNotePrompts.set(posts, prompts);
  return posts;
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}

function reject(status, message, code, headers) {
  return json({ ok: false, code, message }, status, headers);
}

function methodNotAllowed(allow) {
  return reject(405, 'Open the form on Second Ink and try again.', 'method', { Allow: allow });
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site'
    && (origin === null || origin === new URL(request.url).origin);
}

export async function readJson(request, maxBytes = 4096) {
  const type = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return { response: reject(415, 'Open the form on Second Ink and try again.', 'content-type') };
  }
  const tooLarge = () => reject(413, 'This came through a little too long. Try again with less text.', 'too-large');
  if (Number(request.headers.get('Content-Length')) > maxBytes) return { response: tooLarge() };

  const body = request.body?.getReader();
  if (!body) return { response: reject(400, 'The form arrived empty. Try again.', 'invalid') };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    let bytes = 0;
    let source = '';
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void body.cancel().catch(() => {});
        return { response: tooLarge() };
      }
      source += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(source + decoder.decode());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid form object');
    return { data };
  } catch {
    return { response: reject(400, 'The form got a little smudged. Try again.', 'invalid') };
  } finally {
    body.releaseLock();
  }
}

async function passwordMatches(actual, expected) {
  const [first, second] = await Promise.all([digest(actual), digest(expected)]);
  return sameDigest(first, second);
}

async function useRateSlot(storage, scope, ip, windowLength, maximum, fallbackMaximum, now) {
  const address = typeof ip === 'string' ? ip.trim().toLowerCase() : '';
  const windowStart = Math.floor(now / windowLength) * windowLength;
  let subject = 'unidentified';
  if (address && address.length <= 100) {
    const salt = await storage.rateSalt(randomToken);
    if (!salt) throw new Error('Missing feedback rate salt');
    subject = await sign(salt, `${scope}\0${windowStart}\0${address}`);
  }
  await storage.pruneRateLimits(now - day);
  const available = await storage.takeRateSlot(
    scope, subject, windowStart, subject === 'unidentified' ? fallbackMaximum : maximum,
  );
  if (available) return null;
  return reject(429, 'There have been a few too many tries. Come back in a little while.', 'rate-limit', {
    'Retry-After': String(Math.ceil((windowStart + windowLength - now) / 1000)),
  });
}

function countChoices(rows, field, choices) {
  const counts = Object.fromEntries(choices.map((choice) => [choice, 0]));
  let total = 0;
  for (const row of rows) {
    const choice = row[field];
    if (!choices.includes(choice)) continue;
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0) continue;
    counts[choice] += count;
    total += count;
  }
  return { total, counts };
}

function feelingCounts(rows) {
  const { total, counts } = countChoices(rows, 'feeling', readerFeelings);
  return { total, feelings: counts };
}

function rowsByPost(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.postId) ?? [];
    group.push(row);
    groups.set(row.postId, group);
  }
  return groups;
}

async function getCatalog(catalog) {
  const posts = typeof catalog === 'function' ? await catalog() : catalog;
  return posts instanceof Map ? posts : parsePostCatalog(posts);
}

function monthAt(now) {
  return new Date(now).toISOString().slice(0, 7);
}

function publicMonthlyNote(note, posts) {
  if (!note || !posts.has(note.postId)) return null;
  const { month, postId, excerpt } = note;
  return { month, postId, excerpt, attribution: 'Anonymous reader' };
}

async function handleMoods(request, { storage, catalog }) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const [posts, rows, note] = await Promise.all([
    getCatalog(catalog), storage.allFeelingCounts(), storage.monthlyNote(monthAt(Date.now())),
  ]);
  const byPost = new Map();
  const included = [];
  for (const [postId, group] of rowsByPost(rows)) {
    if (!posts.has(postId)) continue;
    const { total, feelings } = feelingCounts(group);
    if (total < 3) continue;
    byPost.set(postId, feelings);
    included.push(...group);
  }
  return json({
    ok: true,
    totals: feelingCounts(included).feelings,
    byPost: Object.fromEntries(byPost),
    featuredNote: publicMonthlyNote(note, posts),
  });
}

function privateText(raw) {
  return raw === undefined || raw === null || typeof raw === 'string';
}

async function readPostReader(request, catalog, maxBytes) {
  const reader = request.headers.get('X-Second-Ink-Reader');
  if (!reader || !validReader.test(reader)) {
    return { response: reject(400, 'Open the essay again to start a fresh response.', 'reader-required') };
  }

  const sending = request.method === 'POST';
  const { data, response } = sending ? await readJson(request, maxBytes) : {};
  if (response) return { response };

  const postId = sending ? data.postId : new URL(request.url).searchParams.get('post');
  if (typeof postId !== 'string' || !validPostId.test(postId) || !(await getCatalog(catalog)).has(postId)) {
    return { response: reject(404, 'This piece is missing from the reading desk.', 'unknown-post') };
  }
  return { postId, data, readerKey: await digest(`${postId}\0${reader.toLowerCase()}`) };
}

function checkUnavailable() {
  return reject(503, 'The quiet check is taking a break. Try again shortly.', 'reader-check-unavailable');
}

async function handleReading(request, { storage, catalog, env, ip }) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { readerKey, response } = await readPostReader(request, catalog, 2048);
  if (response) return response;

  const settings = turnstileSettings(env);
  if (settings.incomplete) return checkUnavailable();

  const now = Date.now();
  const limited = await useRateSlot(storage, 'reading-start', ip, hour, 120, 600, now);
  if (limited) return limited;
  return json({
    ok: true,
    proof: await createReadingProof(storage, readerKey, now),
    waitMs: readingWaitMs,
    ...(settings.siteKey ? { turnstileSiteKey: settings.siteKey } : {}),
  });
}

async function handleStance(request, { storage, catalog, ip }) {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  const { data, postId, readerKey, response } = await readPostReader(request, catalog, 2048);
  if (response) return response;
  if (data && (data.website || !readerStances.includes(data.stance))) {
    return reject(422, 'Pick the answer closest to your first thought.', 'invalid-stance');
  }

  const previous = await storage.ownStance(postId, readerKey);
  const result = async (mine, status = 200) => {
    const { total, counts } = countChoices(await storage.stanceCounts(postId), 'stance', readerStances);
    return json({
      ok: status < 400,
      total,
      stances: counts,
      mine,
      ...(status === 409 ? {
        code: 'already-responded',
        message: 'Your first thought is already in the tally.',
      } : {}),
    }, status);
  };
  if (!data) {
    if (!previous) return reject(404, 'Share your first thought to see how others answered.', 'no-response');
    return result(previous);
  }
  if (previous) return result(previous, 409);

  const now = Date.now();
  const limited = await useRateSlot(storage, 'stance', ip, hour, 24, 120, now);
  if (limited) return limited;
  const saved = await storage.saveStance(postId, readerKey, data.stance, new Date(now).toISOString());
  return saved ? result(data.stance, 201) : result(await storage.ownStance(postId, readerKey), 409);
}

async function handleReconsideration(request, { storage, catalog, env, ip }) {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  const { data, postId, readerKey, response } = await readPostReader(request, catalog, 4096);
  if (response) return response;
  if (data && (data.website || !reconsiderationStances.includes(data.stance))) {
    return reject(422, 'Pick the answer that fits where you are now.', 'invalid-stance');
  }

  const before = await storage.ownStance(postId, readerKey);
  if (!before) return reject(404, 'There’s no first impression to compare on this device.', 'no-first-impression');

  const result = async (after, status = 200) => {
    const movement = after
      ? countChoices(await storage.reconsiderationCounts(postId, readerKey), 'movement', stanceMovements)
      : null;
    return json({
      ok: status < 400,
      before,
      after: after ?? null,
      movement: movement && movement.total >= minimumMovementReaders ? movement : null,
      ...(status === 409 ? { code: 'already-responded' } : {}),
    }, status);
  };
  const previous = await storage.ownReconsideration(postId, readerKey);
  if (!data) return result(previous);
  if (previous) return result(previous, 409);

  const now = Date.now();
  const proof = await checkReadingProof(storage, readerKey, data.proof, now);
  if (proof === 'reading-time') return reject(425, 'Give the essay a moment before answering again.', proof);
  if (proof) return reject(422, 'The reading check expired. Try again to open it afresh.', proof);
  const limited = await useRateSlot(storage, 'reconsideration', ip, hour, 16, 80, now);
  if (limited) return limited;
  const turnstile = await checkTurnstile(turnstileSettings(env), data.turnstileToken, new URL(request.url).hostname);
  if (turnstile === 'reader-check-unavailable') return checkUnavailable();
  if (turnstile) return reject(422, 'The quiet check didn’t finish. Give the answer another try.', turnstile);

  const saved = await storage.saveReconsideration(postId, readerKey, data.stance, new Date(now).toISOString());
  return saved ? result(data.stance, 201) : result(await storage.ownReconsideration(postId, readerKey), 409);
}

async function handleFieldNote(request, { storage, catalog, env, ip }) {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  const posts = await getCatalog(catalog);
  const { data, postId, readerKey, response } = await readPostReader(request, posts, 16 * 1024);
  if (response) return response;
  const prompt = fieldNotePrompts.get(posts)?.get(postId);
  if (!prompt) return reject(404, 'This essay isn’t gathering field notes.', 'no-prompt');

  const submitted = await storage.ownFieldNote(postId, readerKey);
  if (!data || submitted) return json({ ok: true, submitted });
  if (data.prompt !== prompt) {
    return reject(409, 'The field note prompt changed. Reload the essay before sending.', 'prompt-changed');
  }
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (data.website || !note || note.length > 2000 || note.includes('\0') || typeof data.quoteConsent !== 'boolean') {
    return reject(422, 'Leave a field note of 2,000 characters or fewer.', 'invalid-field-note');
  }

  const now = Date.now();
  const proof = await checkReadingProof(storage, readerKey, data.proof, now);
  if (proof === 'reading-time') return reject(425, 'Give the essay a moment before sending your note.', proof);
  if (proof) return reject(422, 'The reading check expired. Try again to open it afresh.', proof);

  const limited = await useRateSlot(storage, 'field-notes', ip, hour, 8, 40, now);
  if (limited) return limited;
  const turnstile = await checkTurnstile(turnstileSettings(env), data.turnstileToken, new URL(request.url).hostname);
  if (turnstile === 'reader-check-unavailable') return checkUnavailable();
  if (turnstile) return reject(422, 'The quiet check didn’t finish. Give your note another try.', turnstile);

  const saved = await storage.saveFieldNote(postId, readerKey, prompt, note, data.quoteConsent, new Date(now).toISOString());
  return json({ ok: true, submitted: true }, saved ? 201 : 200);
}

async function handleFeedback(request, { storage, catalog, env, ip }) {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  const { data, postId, readerKey, response } = await readPostReader(request, catalog, 8192);
  if (response) return response;

  let entry;
  if (data) {
    if (data.website || !readerFeelings.includes(data.feeling) || !privateText(data.note) || !privateText(data.answer)) {
      return reject(422, 'Pick a feeling and check the note before sending.', 'invalid-feedback');
    }
    const note = data.note?.trim();
    const answer = data.answer?.trim();
    if ((note?.length ?? 0) > 400 || (answer?.length ?? 0) > 400) {
      return reject(422, 'Keep your note and answer to 400 characters each.', 'invalid-feedback');
    }
    entry = {
      feeling: data.feeling,
      note: note || null,
      answer: answer || null,
      featureConsent: Boolean(note) && data.featureConsent === true,
    };
  }

  const previous = await storage.ownFeedback(postId, readerKey);
  const feedbackResult = async (mine, status = 200) => json({
    ok: status < 400,
    ...feelingCounts(await storage.feelingCounts(postId)),
    mine,
    ...(status === 409 ? {
      code: 'already-responded',
      message: 'Your feeling is already on this map.',
    } : {}),
  }, status);
  if (!data) {
    if (!previous) return reject(404, 'Leave a feeling to see the map.', 'no-response');
    return feedbackResult(previous);
  }
  if (previous) return feedbackResult(previous, 409);

  const now = Date.now();
  const proof = await checkReadingProof(storage, readerKey, data.proof, now);
  if (proof === 'reading-time') return reject(425, 'Give the piece a moment before leaving a feeling.', proof);
  if (proof) return reject(422, 'The reading check expired. Open the essay again and try once more.', proof);

  const limited = await useRateSlot(storage, 'feedback', ip, hour, 12, 60, now);
  if (limited) return limited;
  const turnstile = await checkTurnstile(turnstileSettings(env), data.turnstileToken, new URL(request.url).hostname);
  if (turnstile === 'reader-check-unavailable') return checkUnavailable();
  if (turnstile) return reject(422, 'The quiet check didn’t finish. Give the send button another try.', turnstile);

  const saved = await storage.saveFeedback(
    postId, readerKey, entry.feeling, entry.note, entry.answer, new Date(now).toISOString(), entry.featureConsent,
  );
  if (!saved) return feedbackResult(await storage.ownFeedback(postId, readerKey), 409);
  return feedbackResult(entry.feeling, 201);
}

function adminCookie(request) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
  const name = secure ? '__Host-second-ink-admin' : 'second-ink-admin';
  const current = request.headers.get('Cookie')?.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))?.slice(name.length + 1);
  const header = (value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  return { token: current && validToken.test(current) ? current : undefined, header };
}

function unauthorized() {
  return reject(401, 'Sign in to open your response desk.', 'signed-out');
}

function sessionKey(password, token) {
  return sign(password, `second-ink-admin-session\0${token}`);
}

function deskCredentials(request, env) {
  const password = env?.SECOND_INK_ADMIN_PASSWORD;
  const cookie = adminCookie(request);
  if (typeof password !== 'string' || password.length < 16 || password.length > 256 || !cookie) {
    return { response: reject(503, 'The owner’s desk hasn’t been set up for this address.', 'admin-unavailable') };
  }
  return { password, cookie };
}

export async function authorizeDesk(request, context) {
  if (!sameOrigin(request)) return reject(403, 'Open the form from Second Ink and try again.', 'origin');
  const { password, cookie, response } = deskCredentials(request, context.env);
  if (response) return response;
  try {
    if (cookie.token && await context.storage.hasAuthorSession(await sessionKey(password, cookie.token), Date.now())) return null;
    return unauthorized();
  } catch {
    logOperation('error', 'session', 'unavailable');
    return reject(503, 'The desk is closed for a moment. Try again shortly.', 'unavailable');
  }
}

async function handleSession(request, storage, password, cookie, ip) {
  if (request.method === 'DELETE') {
    if (cookie.token) await storage.deleteAuthorSession(await sessionKey(password, cookie.token));
    return json({ ok: true }, 200, { 'Set-Cookie': cookie.header('', 0) });
  }
  if (request.method !== 'POST') return methodNotAllowed('POST, DELETE');

  const { data, response } = await readJson(request, 2048);
  if (response) return response;
  const candidate = data.password;
  const now = Date.now();
  const limited = await useRateSlot(storage, 'login', ip, 15 * 60 * 1000, 8, 25, now);
  if (limited) return limited;
  if (typeof candidate !== 'string' || candidate.length > 256 || !await passwordMatches(candidate, password)) {
    return reject(401, 'That password didn’t open the desk.', 'incorrect-password');
  }
  if (cookie.token) await storage.deleteAuthorSession(await sessionKey(password, cookie.token));
  const token = randomToken();
  await storage.pruneAuthorSessions(now);
  await storage.addAuthorSession(await sessionKey(password, token), now + sessionSeconds * 1000);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie.header(token, sessionSeconds) });
}

async function handleDashboard(request, { storage, catalog }, now) {
  if (request.method !== 'GET' && request.method !== 'PATCH') return methodNotAllowed('GET, PATCH');
  if (request.method === 'PATCH') {
    const { data, response } = await readJson(request);
    if (response) return response;
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.pinned !== 'boolean') {
      return reject(422, 'Choose a note to keep.', 'invalid-note');
    }
    const updated = await storage.pinFeedback(data.id, data.pinned);
    return updated ? json({ ok: true }) : reject(404, 'This note is missing.', 'unknown-note');
  }

  const since = new Date(now - 29 * day).toISOString().slice(0, 10);
  const month = monthAt(now);
  const [catalogPosts, rows, stanceRows, trends, notes, inbox, monthlyNote] = await Promise.all([
    getCatalog(catalog), storage.allFeelingCounts(), storage.allStanceCounts(),
    storage.feedbackTrends(since), storage.feedbackNotes(), storage.privateReplies(), storage.monthlyNote(month),
  ]);
  const posts = new Map(catalogPosts);
  const feelingsByPost = rowsByPost(rows);
  const stancesByPost = rowsByPost(stanceRows);
  for (const postId of [...feelingsByPost.keys(), ...stancesByPost.keys(), ...inbox.map((reply) => reply.postId)]) {
    if (!posts.has(postId)) posts.set(postId, postId);
  }
  return json({
    ok: true,
    posts: Array.from(posts, ([id, title]) => {
      const { total: stanceTotal, counts: stances } = countChoices(stancesByPost.get(id) ?? [], 'stance', readerStances);
      return { id, title, ...feelingCounts(feelingsByPost.get(id) ?? []), stanceTotal, stances };
    }),
    trends,
    responses: notes.map((note) => ({
      ...note,
      pinned: Boolean(note.pinned),
      featureConsent: Boolean(note.featureConsent) && catalogPosts.has(note.postId),
    })),
    inbox,
    month,
    featuredNote: publicMonthlyNote(monthlyNote, catalogPosts),
  });
}

async function handleMonthlyNote(request, { storage, catalog }, now) {
  const month = monthAt(now);
  if (request.method === 'DELETE') {
    await storage.removeMonthlyNote(month);
    return json({ ok: true, featuredNote: null, month });
  }
  if (request.method !== 'PUT') return methodNotAllowed('PUT, DELETE');

  const { data, response } = await readJson(request);
  if (response) return response;
  const excerpt = typeof data.excerpt === 'string' ? data.excerpt.trim() : '';
  if (data.confirmed !== true || !Number.isSafeInteger(data.id) || data.id <= 0
    || typeof data.postId !== 'string' || !excerpt || excerpt.length > 240) {
    return reject(422, 'Choose an excerpt and confirm you’ve checked it for identifying details.', 'invalid-excerpt');
  }
  if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:^|\s)@[\w.-]+|(?:\+?\d[\s().-]*){7,}/i.test(excerpt)) {
    return reject(422, 'Choose a shorter excerpt without links or contact details.', 'contact-details');
  }
  const posts = await getCatalog(catalog);
  if (!posts.has(data.postId) || !await storage.featureMonthlyNote(month, data.id, data.postId, excerpt)) {
    return reject(422, 'Choose exact words from a note whose reader agreed to share it.', 'unavailable-excerpt');
  }
  return json({ ok: true, featuredNote: publicMonthlyNote({ month, postId: data.postId, excerpt }, posts), month });
}

async function handleFieldNoteDesk(request, { storage }) {
  if (request.method === 'PATCH') {
    const { data, response } = await readJson(request, 2048);
    if (response) return response;
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || !fieldNoteStatuses.includes(data.status)) {
      return reject(422, 'Choose a field note and a review status.', 'invalid-field-note');
    }
    if (!await storage.moderateFieldNote(data.id, data.status)) {
      return reject(404, 'This field note is missing.', 'unknown-note');
    }
    return json({ ok: true, status: data.status });
  }
  if (request.method !== 'GET') return methodNotAllowed('GET, PATCH');

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const postId = searchParams.get('post');
  const beforeId = searchParams.get('before');
  const before = beforeId === null ? null : Number(beforeId);
  if ((status !== null && !fieldNoteStatuses.includes(status))
    || (postId !== null && !validPostId.test(postId))
    || (beforeId !== null && (!/^\d+$/.test(beforeId) || !Number.isSafeInteger(before) || before <= 0))) {
    return reject(400, 'Choose an essay, a review status, or a page of field notes.', 'invalid-inbox-filter');
  }

  const rows = await storage.fieldNotes({ status, postId, before }, fieldNotePageSize + 1);
  const notes = rows.slice(0, fieldNotePageSize).map((note) => ({ ...note, quoteConsent: Boolean(note.quoteConsent) }));
  return json({ ok: true, notes, nextBefore: rows.length > fieldNotePageSize ? notes.at(-1).id : null });
}

function downloadBackup(body, filename) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function handleExport(request, { storage }, now) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  return downloadBackup(await storage.exportReaderResponses(now), `second-ink-responses-${new Date(now).toISOString().slice(0, 10)}.json`);
}

async function handleBackupShelf(request, { backupBucket }) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (!backupBucket) return json({ enabled: false, weeks: [], nextAfter: null });
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week');
  if (week !== null) {
    const object = await getWeeklyBackup(backupBucket, week);
    return object
      ? downloadBackup(object.body, `second-ink-responses-${week}.json`)
      : reject(404, 'There is no backup for that week.', 'unknown-week');
  }
  const after = searchParams.get('after');
  if (after !== null && !/^\d{4}-\d{2}-\d{2}$/.test(after)) {
    return reject(400, 'Choose a week from the backup shelf.', 'invalid-week');
  }
  return json({ enabled: true, ...await listWeeklyBackups(backupBucket, after) });
}

async function handleWeeklyBackup(request, { backupBucket, storage }) {
  // The owner-only Sites ingress gates this endpoint. Only that deployment passes a bucket.
  if (!backupBucket) return reject(404, 'This piece slipped out of the stack.', 'not-found');
  const now = Date.now();
  const week = backupWeek(now);
  if (request.method === 'GET') return json({ week, saved: await weeklyBackupStatus(backupBucket, week) });
  if (request.method !== 'POST') return methodNotAllowed('GET, POST');
  const outcome = await saveWeeklyBackup(backupBucket, storage, now, week);
  logOperation('info', 'weekly-backup', outcome);
  return json({ week, saved: true, outcome }, outcome === 'saved' ? 201 : 200);
}

async function handleEssaySort(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { data, response } = await readJson(request, 256 * 1024);
  if (response) return response;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (!body || title.length > 180 || description.length > 450 || body.length > 48000) {
    return reject(422, 'Add essay text up to 48,000 characters.', 'invalid-essay');
  }
  return json(sortEssay({ title, description, body }));
}

export async function handleApi(request, context) {
  const route = routeName(new URL(request.url).pathname);
  if (route === 'newsletter' || route === 'reply') {
    return handleSubmission(request, route, context.storage);
  }
  if (!route) return reject(404, 'This piece slipped out of the stack.', 'not-found');
  if (!sameOrigin(request)) return reject(403, 'Open the form from Second Ink and try again.', 'origin');
  try {
    if (route === 'health') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      await context.storage.checkResponseStorage();
      return json({ ok: true });
    }
    if (route === 'weekly-backup') return await handleWeeklyBackup(request, context);
    if (route === 'reading') return await handleReading(request, context);
    if (route === 'stance') return await handleStance(request, context);
    if (route === 'reconsideration') return await handleReconsideration(request, context);
    if (route === 'field-notes') return await handleFieldNote(request, context);
    if (route === 'feedback') return await handleFeedback(request, context);
    if (route === 'moods') return await handleMoods(request, context);

    if (route === 'session') {
      const { password, cookie, response } = deskCredentials(request, context.env);
      return response ?? await handleSession(request, context.storage, password, cookie, context.ip);
    }
    const denied = await authorizeDesk(request, context);
    if (denied) return denied;
    if (route === 'essay-sort') return await handleEssaySort(request);
    const now = Date.now();
    if (route === 'export') return await handleExport(request, context, now);
    if (route === 'backups') return await handleBackupShelf(request, context);
    if (route === 'field-notes-desk') return await handleFieldNoteDesk(request, context);
    return await (route === 'monthly-note'
      ? handleMonthlyNote(request, context, now)
      : handleDashboard(request, context, now));
  } catch {
    logOperation('error', route, 'unavailable');
    return reject(503, 'The desk is closed for a moment. Try again shortly.', 'unavailable');
  }
}
