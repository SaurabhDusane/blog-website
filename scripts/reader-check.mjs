import { randomToken, sameDigest, sign } from './reader-crypto.mjs';

export const readingWaitMs = 12_000;
const proofLifetimeMs = 24 * 60 * 60 * 1000;
const proofFormat = /^(\d{13})\.([a-f0-9]{64})$/;
const siteverify = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function proofSignature(storage, readerKey, issuedAt) {
  const salt = await storage.rateSalt(randomToken);
  if (!salt) throw new Error('Missing reading check salt');
  return sign(salt, `second-ink-reading\0${readerKey}\0${issuedAt}`);
}

export async function createReadingProof(storage, readerKey, now) {
  return `${now}.${await proofSignature(storage, readerKey, now)}`;
}

export async function checkReadingProof(storage, readerKey, proof, now) {
  const match = typeof proof === 'string' && proofFormat.exec(proof);
  if (!match) return 'reading-proof';

  const issuedAt = Number(match[1]);
  const elapsed = now - issuedAt;
  if (elapsed < 0 || elapsed > proofLifetimeMs) return 'reading-proof';

  const signature = await proofSignature(storage, readerKey, issuedAt);
  if (!sameDigest(signature, match[2])) return 'reading-proof';
  return elapsed < readingWaitMs ? 'reading-time' : undefined;
}

export function turnstileSettings(env) {
  const [siteKey, secretKey] = [
    env?.SECOND_INK_TURNSTILE_SITE_KEY, env?.SECOND_INK_TURNSTILE_SECRET_KEY,
  ].map((value) => typeof value === 'string' ? value.trim() : '');
  return { siteKey, secretKey, incomplete: Boolean(siteKey) !== Boolean(secretKey) };
}

export async function checkTurnstile(settings, token, hostname) {
  if (settings.incomplete) return 'reader-check-unavailable';
  if (!settings.secretKey) return undefined;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return 'reader-check';

  try {
    const response = await fetch(siteverify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: settings.secretKey, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 'reader-check-unavailable';
    const result = await response.json();
    if (result.success === true && result.action === 'reader-feedback'
      && result.hostname?.toLowerCase() === hostname.toLowerCase()) return undefined;
    if (result['error-codes']?.includes('internal-error')) return 'reader-check-unavailable';
    return 'reader-check';
  } catch {
    return 'reader-check-unavailable';
  }
}
