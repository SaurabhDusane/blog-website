import { readReaderBytes } from './public-reader-relay.mjs';

export async function readPublicCatalog(origin) {
  const response = await fetch(new URL('/posts/catalog.json', origin), {
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/json')) {
    throw new Error('Could not open the public essay catalog.');
  }
  const bytes = await readReaderBytes(response, 512 * 1024);
  if (!bytes) throw new Error('Public essay catalog exceeds its size limit.');
  const entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(entries)) throw new Error('Invalid public essay catalog.');
  return entries;
}
