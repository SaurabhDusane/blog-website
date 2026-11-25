import { isEmail, newsletterReceipt, readForm } from './submissions.mjs';
import { digest, randomToken, sign, sameDigest } from './reader-crypto.mjs';
import { logOperation } from './operations-log.mjs';
import { readerOrigin } from './public-reader-relay.mjs';

const tokenPattern = /^[a-f0-9]{64}$/;
const hour = 60 * 60 * 1000;
const confirmationLifetime = 48 * hour;
const retryWindow = 20 * hour;
const batchCount = 8;

export function newsletterOrigin(env) {
  return readerOrigin(env.SECOND_INK_PUBLIC_READER_ORIGIN || env.SECOND_INK_NEWSLETTER_SITE_URL);
}

function mailConfig(env) {
  const origin = newsletterOrigin(env);
  const key = env.SECOND_INK_MAIL_API_KEY?.trim();
  const from = env.SECOND_INK_NEWSLETTER_FROM?.trim();
  if (!origin || !key || !from || /[\r\n]/.test(from)) return null;
  return { key, from, origin };
}

async function sendEmail(config, to, subject, text, id) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(9000),
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': id },
    body: JSON.stringify({ from: config.from, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error('Mail provider did not accept the message.');
}

const manageLink = (origin, action, token) => `${origin.origin}/newsletter/manage/?action=${action}#${token}`;

export async function registerInterest(request, { storage, env }) {
  const receipt = (status, message) => newsletterReceipt(request, status, message);
  if (request.method !== 'POST') return receipt(405, 'Open the newsletter form to join the list.');
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^(?:application\/x-www-form-urlencoded|multipart\/form-data)(?:\s*;|$)/i.test(type)) {
    return receipt(415, 'Use the newsletter form and try again.');
  }
  if (Number(request.headers.get('Content-Length')) > 64 * 1024) return receipt(413, 'The sign-up form was too large.');
  let form;
  try { form = await readForm(request, type); } catch { return receipt(400, 'Open the newsletter form and try again.'); }
  if (!form) return receipt(413, 'The sign-up form was too large.');
  const config = mailConfig(env);
  const message = config ? 'If the address can join, a confirmation link will arrive shortly.'
    : 'Your signup request is saved. Email confirmations will open when the newsletter is set up.';
  if (form.get('website')) return receipt(200, message);
  const value = form.get('email');
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!isEmail(email)) return receipt(422, 'Check the email address and give it another try.');
  const now = Date.now();
  const token = config ? randomToken() : null;
  const row = await storage.requestNewsletterConfirmation({
    email, id: randomToken(), now, hash: token ? await digest(token) : null,
    deadline: token ? now + confirmationLifetime : null, retryAfter: now - hour / 2,
  });
  if (row && token && config) {
    try {
      await sendEmail(config, email, 'Confirm your Second Ink newsletter signup', [
        'Confirm that you’d like occasional emails from Second Ink.',
        manageLink(config.origin, 'confirm', token),
        'This link is valid for two days. You can ignore this message if you did not request it.',
      ].join('\n\n'), `second-ink-confirm/${await digest(token)}`);
    } catch { logOperation('error', 'newsletter-confirmation', 'delivery-unavailable'); }
  }
  return receipt(200, message);
}

async function unsubscribeToken(storage, id) {
  const key = await storage.rateSalt(randomToken());
  if (!key) throw new Error('Missing newsletter signing key.');
  return `${id}.${await sign(key, `second-ink-unsubscribe\0${id}`)}`;
}

export async function manageSubscription(action, token, storage) {
  if (typeof token !== 'string' || token.length > 129) return false;
  if (action === 'newsletter-confirm') {
    return tokenPattern.test(token) && await storage.confirmNewsletter(await digest(token), Date.now());
  }
  const [id, signature, extra] = token.split('.');
  if (!tokenPattern.test(id) || !tokenPattern.test(signature ?? '') || extra !== undefined) return false;
  if (!sameDigest(await unsubscribeToken(storage, id), token)) return false;
  await storage.unsubscribeNewsletter(id, Date.now());
  return true;
}

export function newsletterEnabled(env) { return Boolean(mailConfig(env)); }

export async function newsletterPreview(data, posts, env) {
  const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
  const introduction = typeof data.introduction === 'string' ? data.introduction.trim() : '';
  const ids = Array.isArray(data.posts) ? [...new Set(data.posts)] : [];
  const origin = newsletterOrigin(env);
  if (!subject || subject.length > 120 || /[\r\n]/.test(subject) || introduction.length > 3000
    || ids.length < 1 || ids.length > 8 || ids.some((id) => typeof id !== 'string' || !posts.has(id))) return null;
  const list = ids.map((id) => `${posts.get(id).replace(/\s+/g, ' ')}\n${origin?.origin ?? ''}/posts/${id}/`);
  const body = [introduction, ...list].filter(Boolean).join('\n\n');
  return { id: await digest(`${subject}\0${body}`), subject, body };
}

export async function deliverNewsletterDigest({ storage, env }, id) {
  const config = mailConfig(env);
  const digestRow = await storage.newsletterDigest(id);
  if (!config || !digestRow) return null;
  const now = Date.now();
  const lease = now + 60_000;
  const deliveries = await storage.claimNewsletterDeliveries(id, {
    now, lease, retryCutoff: now - retryWindow, limit: batchCount,
  });
  const submit = async ({ contactId }) => {
    const contact = await storage.newsletterDeliveryContact(id, contactId);
    if (!contact) {
      await storage.finishNewsletterDelivery(id, contactId, lease, 'skipped', Date.now());
      return;
    }
    const token = await unsubscribeToken(storage, contactId);
    const text = `${digestRow.body}\n\nUnsubscribe\n${manageLink(config.origin, 'unsubscribe', token)}`;
    await sendEmail(config, contact.email, digestRow.subject, text, `second-ink-digest/${id}/${contactId}`);
    await storage.finishNewsletterDelivery(id, contactId, lease, 'sent', Date.now());
  };
  let failed = false;
  for (let index = 0; index < deliveries.length; index += 2) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
    const results = await Promise.allSettled(deliveries.slice(index, index + 2).map(submit));
    if (results.some((result) => result.status === 'rejected')) failed = true;
  }
  if (failed) logOperation('error', 'newsletter-digest', 'delivery-unavailable');
  return { ...(await storage.newsletterDigestSummary(id)), processed: deliveries.length, paused: failed };
}
