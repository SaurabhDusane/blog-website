import { logOperation } from './operations-log.mjs';

const maxFormBytes = 64 * 1024;
const allowedReturnPath = /^\/(?:newsletter\/|posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/)?(?:#[a-zA-Z0-9_-]+)?$/;
const postSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const insertSubscription = `
  INSERT INTO newsletter_subscriptions (email, subscribed_at) VALUES (?, ?)
  ON CONFLICT(email) DO NOTHING
`;

export const insertReply = `
  INSERT INTO author_replies (post_slug, message, email, received_at) VALUES (?, ?, ?, ?)
`;

export function submissionRoute(pathname) {
  if (pathname === '/api/newsletter/' || pathname === '/api/newsletter') return 'newsletter';
  if (pathname === '/api/reply/' || pathname === '/api/reply') return 'reply';
  return undefined;
}

function getText(form, field) {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function isEmail(email) {
  if (email.length > 254) return false;
  const [localPart, domain, extra] = email.split('@');
  if (!domain || extra !== undefined || localPart.length > 64) return false;
  const localPattern = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/i;
  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return localPattern.test(localPart) && domainPattern.test(domain);
}

const submissions = {
  newsletter: {
    title: 'Newsletter',
    successHeading: 'On the list',
    successMessage: 'You’re on the list. See you in the margins.',
    errorHeading: 'The newsletter desk',
    returnPath: '/newsletter/',
    parse(form) {
      const email = getText(form, 'email').toLowerCase();
      if (!isEmail(email)) return { error: 'Check the shape of your email address and give it another try.' };
      return { values: [email] };
    },
  },
  reply: {
    title: 'Reply to the author',
    successHeading: 'Your note is in',
    successMessage: 'Your note is in the author’s inbox.',
    errorHeading: 'Your reply',
    returnPath: '/explore/',
    parse(form) {
      const post = getText(form, 'post');
      if (post.length > 120 || !postSlugPattern.test(post)) {
        return { error: 'Open the essay you want to reply to and try again.' };
      }
      const returnPath = `/posts/${post}/`;
      const message = getText(form, 'message');
      if (message.length < 2 || message.length > 3000) {
        return { error: 'Write a note between 2 and 3,000 characters.', returnPath };
      }
      const email = getText(form, 'email').toLowerCase();
      if (email && !isEmail(email)) {
        return { error: 'Check the shape of your email address, or leave it blank.', returnPath };
      }
      return { values: [post, message, email || null], returnPath };
    },
  },
};

function respond(request, submission, status, message, returnPath = submission.returnPath, extraHeaders = {}) {
  const ok = status >= 200 && status < 300;
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Vary': 'Accept',
    ...extraHeaders,
  };
  const acceptsJson = request.headers.get('Accept')?.toLowerCase().includes('application/json');

  if (acceptsJson) return Response.json({ ok, message }, { status, headers });

  const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${submission.title} · Second Ink</title>
<style>
body { margin: 0; background: #f7f5ef; color: #1b1b17; font: 1.125rem/1.55 Georgia, serif; }
main { max-width: 36rem; margin: 12vh auto 0; padding: 1.25rem; }
h1 { font-size: clamp(2.5rem, 8vw, 4rem); line-height: 1.03; }
a { color: #1939be; text-underline-offset: .18em; }
</style>
<main>
  <p>Second Ink</p>
  <h1>${ok ? submission.successHeading : submission.errorHeading}</h1>
  <p>${message}</p>
  <a href="${returnPath}">${ok ? 'Back to Second Ink' : 'Back to the form'}</a>
</main>
</html>`;

  return new Response(request.method === 'HEAD' ? null : page, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });
}

async function readForm(request, contentType) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('No form body');

  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxFormBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Response(new Blob(chunks), { headers: { 'Content-Type': contentType } }).formData();
}

export async function handleSubmission(request, route, storage, publishedPost) {
  const submission = submissions[route];
  const reply = (status, message, returnPath, extraHeaders) => {
    return respond(request, submission, status, message, returnPath, extraHeaders);
  };
  if (request.method !== 'POST') {
    return reply(405, 'Open the form on Second Ink to leave a note.', undefined, { Allow: 'POST' });
  }

  const origin = request.headers.get('Origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) {
    return reply(403, 'Open the form from Second Ink and try again.');
  }

  const contentType = request.headers.get('Content-Type') ?? '';
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!['application/x-www-form-urlencoded', 'multipart/form-data'].includes(mediaType)) {
    return reply(415, 'Use the form on Second Ink and try again.');
  }

  const oversizedMessage = 'That form arrived a little too full. Try sending a shorter note.';
  if (Number(request.headers.get('Content-Length')) > maxFormBytes) {
    return reply(413, oversizedMessage);
  }

  let form;
  try {
    form = await readForm(request, contentType);
  } catch {
    return reply(400, 'That form got a little smudged. Give it another try.');
  }
  if (!form) return reply(413, oversizedMessage);

  const returnField = getText(form, 'returnTo');
  const safeReturnPath = returnField.length <= 240 && allowedReturnPath.test(returnField) ? returnField : undefined;
  if (form.get('website')) return reply(200, submission.successMessage, safeReturnPath);

  const { values, error, returnPath } = submission.parse(form);
  const destination = safeReturnPath ?? returnPath;
  if (error) return reply(422, error, destination);
  if (publishedPost && !await publishedPost(values[0])) return reply(404, 'This piece is missing from the reading desk.');

  try {
    await storage[route](...values, new Date().toISOString());
  } catch {
    logOperation('error', route, 'unavailable');
    return reply(503, 'The desk is closed for a moment. Try again shortly.', destination);
  }
  return reply(200, submission.successMessage, destination);
}
