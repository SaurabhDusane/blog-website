export type ReadingProof = { proof: string; readyAt: number; turnstileSiteKey?: string };

// Both end-of-essays activities can use the same short-lived reading check.
const checks = new Map<string, { startedAt: number; answer: Promise<ReadingProof> }>();

export function requestReadingProof(postId: string, identity: string, renew = false): Promise<ReadingProof> {
  const key = `${postId}:${identity}`;
  const startedAt = performance.now();
  const previous = checks.get(key);
  if (!renew && previous && startedAt - previous.startedAt < 23 * 60 * 60 * 1000) return previous.answer;

  const fallback = 'The reading check didn’t open. Give it another try in a moment.';
  const answer: Promise<ReadingProof> = (async () => {
    const response = await fetch('/api/reading/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Second-Ink-Reader': identity },
      body: JSON.stringify({ postId }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { throw new Error(fallback); });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data?.proof !== 'string' || !Number.isFinite(data.waitMs)) {
      throw new Error(typeof data?.message === 'string' ? data.message : fallback);
    }
    return {
      proof: data.proof,
      readyAt: performance.now() + Math.max(0, data.waitMs),
      turnstileSiteKey: typeof data.turnstileSiteKey === 'string' ? data.turnstileSiteKey : undefined,
    };
  })().catch((error) => {
    if (checks.get(key)?.answer === answer) checks.delete(key);
    throw error;
  });
  checks.set(key, { startedAt, answer });
  return answer;
}
