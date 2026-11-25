import { essayTopics } from './essay-classifier.mjs';
import { journalAuthorId } from '../src/lib/journal-author.mjs';

const repositoryPattern = /^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i;
const installationPattern = /^\d{1,20}$/;
const branch = 'main';
const writePath = '/src/content/posts/';
const apiOrigin = 'https://api.github.com';
const encoding = new TextEncoder();

export class ReleaseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function releaseSettings(env) {
  const repository = env.SECOND_INK_PUBLISH_REPOSITORY?.trim();
  const installation = env.SECOND_INK_PUBLISH_INSTALLATION_ID?.trim();
  const app = env.SECOND_INK_PUBLISH_APP_ID?.trim();
  const key = env.SECOND_INK_PUBLISH_PRIVATE_KEY?.replaceAll('\\n', '\n').trim();
  if (!repositoryPattern.test(repository ?? '') || !installationPattern.test(installation ?? '') || !installationPattern.test(app ?? '')
    || !key || key.length > 8_192) return null;
  let site;
  try { site = new URL(env.SECOND_INK_PUBLISH_SITE_URL); } catch { return null; }
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) return null;
  const [owner, name] = repository.split('/');
  if (name === '.' || name === '..') return null;
  return { repository, owner, name, installation, app, key, origin: site.origin };
}

export function editionMarkdown(revision, metadata = {}) {
  const createdAt = metadata.publishedAt ?? revision.createdAt;
  const minutes = Math.max(1, Math.ceil(revision.body.trim().split(/\s+/u).length / 220));
  const published = typeof metadata.releasedAt === 'string';
  const fields = {
    title: revision.title,
    description: revision.description,
    publishedAt: createdAt,
    ...(published && createdAt !== metadata.releasedAt ? { updatedAt: metadata.releasedAt } : {}),
    author: journalAuthorId,
    topics: (revision.topics ?? []).filter((id) => Object.hasOwn(essayTopics, id)),
    mood: ['reflective', 'practical', 'curious'].includes(revision.mood) ? revision.mood : 'reflective',
    minutes,
    ...(revision.connections?.length ? { connections: revision.connections } : {}),
    ...(published ? { secondInkDeskRevision: revision.id } : {}),
  };
  return ['---', ...Object.entries(fields).map(([field, value]) => `${field}: ${JSON.stringify(value)}`), '---', '', revision.body.trim(), '']
    .join('\n');
}

function base64(bytes) {
  let chars = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) chars += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(chars);
}

const unbase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const base64Url = (bytes) => base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

function der(tag, content) {
  const length = content.length;
  const bytes = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >> 8, length & 0xff];
  return Uint8Array.of(tag, ...bytes, ...content);
}

function keyBytes(pem) {
  const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+([a-z\d+/=\s]+)-----END \1-----$/i.exec(pem);
  if (!match) throw new ReleaseError('The GitHub App key could not be opened.', 503);
  const bytes = unbase64(match[2].replace(/\s+/g, ''));
  if (match[1].toUpperCase() === 'PRIVATE KEY') return bytes;
  // GitHub emits PKCS#1 RSA keys. Web Crypto imports the same key in PKCS#8.
  const rsaHeader = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, Uint8Array.of(...rsaHeader, ...der(0x04, bytes)));
}

async function appToken(config, request) {
  let jwt;
  try {
    const now = Math.floor(Date.now() / 1_000);
    const header = base64Url(encoding.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const payload = base64Url(encoding.encode(JSON.stringify({ iss: config.app, iat: now - 30, exp: now + 300 })));
    const key = await crypto.subtle.importKey('pkcs8', keyBytes(config.key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const unsigned = `${header}.${payload}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoding.encode(unsigned));
    jwt = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  } catch {
    throw new ReleaseError('The GitHub App key could not be opened.', 503);
  }
  const response = await github(`/app/installations/${config.installation}/access_tokens`, jwt, request, {
    method: 'POST', body: JSON.stringify({ repositories: [config.name], permissions: { contents: 'write' } }),
  });
  const value = response.ok && await response.json();
  if (typeof value?.token !== 'string' || !value.token.trim()) throw new ReleaseError('GitHub did not grant the publishing app access to this repository.', 503);
  return value.token;
}

function github(path, token, request, init = {}) {
  return request(new URL(path, apiOrigin), {
    ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Second-Ink-Publishing-Desk', 'Content-Type': 'application/json' },
  });
}

function previousEdition(file) {
  if (typeof file?.content !== 'string' || file.type !== 'file' || file.encoding !== 'base64' || file.content.length > 450_000
    || !/^[a-f0-9]{40}$/.test(file.sha ?? '')) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(unbase64(file.content)); } catch { return null; }
  const frontmatter = /^---\r?\n([\s\S]+?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!frontmatter) return null;
  const revision = Number(/^secondInkDeskRevision: (\d+)\s*$/m.exec(frontmatter)?.[1]);
  const publishedAt = /^publishedAt: "([^"\r\n]+)"\s*$/m.exec(frontmatter)?.[1];
  if (!Number.isSafeInteger(revision) || revision < 1 || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
  return { revision, publishedAt, sha: file.sha };
}

async function publicAddressExists(config, slug, request) {
  const response = await request(new URL('/posts/catalog.json', config.origin), {
    redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new ReleaseError('The public essay index could not be verified.', 503);
  }
  const catalog = await response.json();
  if (!Array.isArray(catalog)) throw new ReleaseError('The public essay index could not be verified.', 503);
  return catalog.some((entry) => entry?.id === slug);
}

export async function sendDeskRelease(config, revision, request = fetch) {
  const slug = revision.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new ReleaseError('Choose a saved essay with a valid web address.', 422);
  }
  const path = `/repos/${config.owner}/${config.name}/contents${writePath}${slug}.md`;
  const href = new URL(`/posts/${slug}/`, config.origin).href;
  const token = await appToken(config, request);
  const current = await github(`${path}?ref=${branch}`, token, request);
  let previous;
  if (current.ok) {
    previous = previousEdition(await current.json());
    if (!previous) throw new ReleaseError('This address belongs to a file managed separately in GitHub.', 409);
    if (previous.revision === revision.id) return { queued: false, href };
    if (previous.revision > revision.id) throw new ReleaseError('A newer version is already on the release branch.', 409);
  } else if (current.status !== 404) {
    throw new ReleaseError('The release branch could not be opened.', 503);
  } else if (await publicAddressExists(config, slug, request)) {
    throw new ReleaseError('This address belongs to an essay already in the public archive.', 409);
  }
  const releasedAt = new Date().toISOString();
  const content = editionMarkdown(revision, { publishedAt: previous?.publishedAt ?? releasedAt, releasedAt });
  const response = await github(path, token, request, {
    method: 'PUT', body: JSON.stringify({ message: `Publish essay ${slug}`, branch,
      content: base64(encoding.encode(content)), ...(previous ? { sha: previous.sha } : {}) }),
  });
  if (response.status === 409 || response.status === 422) throw new ReleaseError('GitHub rejected the change. Check the release branch and try again.', 409);
  if (!response.ok) throw new ReleaseError('The essay could not be sent to the release branch.', 503);
  const result = await response.json();
  const commit = /^[a-f0-9]{40}$/.test(result?.commit?.sha ?? '') ? result.commit.sha : undefined;
  return { queued: true, href, ...(commit ? { commit } : {}) };
}
