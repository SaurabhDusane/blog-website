import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sha = /^[a-f0-9]{40}$/;
const postId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function secureOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/'
    || parsed.search || parsed.hash) throw new Error('A plain HTTPS origin is required.');
  return parsed.origin;
}

export async function inspectRelease(site, revision, request = fetch) {
  const origin = secureOrigin(site);
  if (!sha.test(revision)) throw new Error('The expected commit must be a complete SHA.');
  const get = async (pathname, options = {}, host = origin) => {
    const response = await request(`${host}${pathname}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000), ...options,
    });
    if (!response.ok) throw new Error(`${pathname.split('?')[0]} returned HTTP ${response.status}.`);
    return response;
  };

  const marker = await (await get(`/release.json?revision=${revision}`)).json();
  if (marker?.revision !== revision) throw new Error('Waiting for the expected commit at the production origin.');
  const [catalog, index, archive, feed] = await Promise.all([
    get('/posts/catalog.json').then((result) => result.json()),
    get('/explore/index.json').then((result) => result.json()),
    get('/explore/').then((result) => result.text()),
    get('/rss.xml').then((result) => result.text()),
  ]);
  if (!Array.isArray(catalog) || !index || typeof index !== 'object' || Array.isArray(index)) throw new Error('The published index is not usable.');
  if (!archive.includes('data-explore') || !/<rss\b/.test(feed)) throw new Error('The archive or feed did not render.');

  const essays = catalog.slice(0, 3);
  await Promise.all(essays.map(async ({ id }) => {
    if (!postId.test(id)) throw new Error('The catalog contains an invalid essay identifier.');
    const path = `/posts/${id}/`;
    const html = await (await get(path)).text();
    if (!html.includes('data-reader') || !archive.includes(`href="${path}"`)
      || !Object.hasOwn(index, path) || !Array.isArray(index[path]) || !feed.includes(path)) {
      throw new Error(`The newest entries are missing from an essay, the archive, search, or RSS (${id}).`);
    }
  }));

  if (essays.length) {
    const reader = marker.readerOrigin ? secureOrigin(marker.readerOrigin) : origin;
    if (reader !== origin) {
      const check = await get('/api/reading/', {
        method: 'OPTIONS', headers: {
          Origin: origin, 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-second-ink-reader',
        },
      }, reader);
      if (check.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error('The reader form preflight does not allow the public site.');
    }
    const proof = await get('/api/reading/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Second-Ink-Reader': randomUUID() },
      body: JSON.stringify({ postId: essays[0].id }),
    }, reader);
    const result = await proof.json();
    if ((reader !== origin && proof.headers.get('Access-Control-Allow-Origin') !== origin)
      || result?.ok !== true || typeof result.proof !== 'string' || !result.proof || !Number.isFinite(result.waitMs)) {
      throw new Error('The reading form did not return a usable check.');
    }
  }

  return { revision, essayCount: catalog.length, samples: essays.length, readingChecked: essays.length > 0 };
}

async function main(site, revision) {
  secureOrigin(site);
  if (!sha.test(revision ?? '')) throw new Error('Pass the production HTTPS origin and expected full commit SHA.');
  const deadline = Date.now() + 4 * 60 * 1000;
  let lastError;
  do {
    try {
      const result = await inspectRelease(site, revision);
      const message = `Verified ${result.revision.slice(0, 12)} at ${secureOrigin(site)}. ${result.samples} recent essays checked out of ${result.essayCount}. ${result.readingChecked ? 'The reading form started successfully.' : 'There were no published essays for a reading check.'}`;
      console.log(message);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Production verification\n\n${message}\n`);
      return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 7000));
  } while (Date.now() < deadline);
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2)).catch((error) => {
    console.error(`Production verification failed. ${error.message}`);
    process.exitCode = 1;
  });
}
