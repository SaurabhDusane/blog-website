const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const reject = (message, status) => Response.json({ message }, { status, headers });

export async function relayEarlyReader(request, env) {
  if (request.method !== 'POST') return reject('Open the invitation in your browser.', 405);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return reject('Open the invitation directly to continue.', 403);
  let origin;
  try { origin = new URL(env.SECOND_INK_REVIEW_UPSTREAM); } catch { return reject('Guest review has yet to be connected.', 503); }
  const service = env.SECOND_INK_REVIEW_UPSTREAM_TOKEN;
  const secret = env.SECOND_INK_REVIEW_BRIDGE_SECRET;
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.chatgpt.site') || origin.username || origin.password
    || origin.port || origin.pathname !== '/' || origin.search || origin.hash || !service || !/^[a-f0-9]{64}$/.test(secret ?? '')) {
    return reject('Guest review has yet to be connected.', 503);
  }
  if (Number(request.headers.get('Content-Length')) > 16000 || !request.body) return reject('This note is too long.', 413);
  const reader = request.body.getReader();
  const buffer = new Uint8Array(16000);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > buffer.length) {
        void reader.cancel().catch(() => {});
        return reject('This note is too long.', 413);
      }
      buffer.set(value, length);
      length += value.length;
    }
    const response = await fetch(new URL('/api/early-reader/', origin), {
      // Keep the service credential and invitation body on this exact origin.
      method: 'POST', body: buffer.subarray(0, length), redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': `Bearer ${service}`, 'X-Second-Ink-Review-Bridge': secret },
    });
    const redirected = response.status >= 300 && response.status < 400;
    if (redirected || response.status === 401 || !response.headers.get('Content-Type')?.startsWith('application/json')) {
      console.warn('Early reader upstream returned an unexpected response.', response.status);
      return reject('The desk could not open this invitation.', 503);
    }
    return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch {
    return reject('The desk could not open this invitation.', 503);
  } finally { reader.releaseLock(); }
}
