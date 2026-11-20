import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const releasePrefix = 'second-ink-release-v1-';
const digestPattern = /^[a-f0-9]{64}$/;
const snapshotPattern = /^[a-f0-9]{64}\.json$/;
const assetPattern = /^(?:[a-f0-9]{24}\.webp|[a-f0-9]{64}\.pdf)$/;
const maxManifest = 8 * 1024 * 1024;
const maxAsset = 64 * 1024 * 1024;
const maxFiles = 20_000;
const maxReport = 65_536;

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetKey = (hash) => `assets/${hash}`;
const releaseKey = (id) => `releases/${id}`;

function readJson(bytes, limit = maxManifest) {
  if (bytes.byteLength > limit) throw Error('Publication state exceeds its size limit.');
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function validateLedger(ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.posts) || ledger.posts.length > maxFiles) {
    throw Error('The document publication ledger has an unsupported format.');
  }
  for (const entry of ledger.posts) {
    if (!entry || (entry.snapshot !== undefined && !snapshotPattern.test(entry.snapshot))) {
      throw Error('The document publication ledger contains an invalid snapshot name.');
    }
  }
}

function snapshotAssets(bytes) {
  const snapshot = readJson(bytes);
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.assets)
    || snapshot.assets.length > maxFiles || snapshot.assets.some((name) => !assetPattern.test(name))) {
    throw Error('A document snapshot has an invalid asset list.');
  }
  return snapshot.assets;
}

function validateBundle(bundle) {
  validateLedger(bundle?.ledger);
  if (bundle.version !== 1 || !digestPattern.test(bundle.publicDigest)
    || !Array.isArray(bundle.files) || bundle.files.length > maxFiles) {
    throw Error('The stored publication state has an unsupported format.');
  }
  const names = new Set();
  for (const file of bundle.files) {
    if (!file || !(snapshotPattern.test(file.name) || assetPattern.test(file.name))
      || !digestPattern.test(file.hash) || !Number.isSafeInteger(file.size) || file.size < 1
      || file.size > maxAsset || names.has(file.name)) {
      throw Error('The stored publication state contains an invalid asset.');
    }
    names.add(file.name);
  }
}

async function readBoundedFile(path, limit) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit) throw Error('A publication file is missing, unsafe, or too large.');
  const bytes = await readFile(path);
  if (bytes.byteLength > limit) throw Error('A publication file changed while it was read.');
  return bytes;
}

async function eachBatch(items, run) {
  for (let index = 0; index < items.length; index += 4) {
    await Promise.all(items.slice(index, index + 4).map(run));
  }
}

async function buildFingerprint(directory) {
  const hash = createHash('sha256');
  async function visit(folder, prefix) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name === b.name ? 0 : 1)) {
      const path = join(folder, entry.name);
      const route = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, route);
      } else if (entry.isFile()) {
        hash.update(JSON.stringify([route, digest(await readBoundedFile(path, maxAsset))]));
      } else {
        throw Error('Netlify output must contain ordinary files and folders.');
      }
    }
  }
  await visit(directory, 'public');
  // The API function and edge gate are deployed alongside the static output.
  await visit(resolve('netlify'), 'netlify');
  await visit(resolve('scripts'), 'scripts');
  for (const name of ['netlify.toml', 'package-lock.json']) {
    hash.update(JSON.stringify([name, digest(await readBoundedFile(resolve(name), maxAsset))]));
  }
  return hash.digest('hex');
}

async function putOnce(store, key, bytes) {
  if (!await store.getMetadata(key)) await store.set(key, new Blob([bytes]), { onlyIfNew: true });
}

export async function stageRelease(store, data, publicDigest, firstDeployId) {
  const ledger = readJson(await readBoundedFile(join(data, 'document-release.json'), maxManifest));
  validateLedger(ledger);
  const directory = join(data, 'document-state-assets');
  const snapshots = [...new Set(ledger.posts.map((post) => post.snapshot).filter(Boolean))].sort();
  const names = new Set(snapshots);
  for (const name of snapshots) {
    for (const asset of snapshotAssets(await readBoundedFile(join(directory, name), maxManifest))) names.add(asset);
  }
  if (names.size > maxFiles) throw Error('Too many document files in one release.');

  const files = [...names].sort().map((name) => ({ name }));
  await eachBatch(files, async (file) => {
    const bytes = await readBoundedFile(join(directory, file.name), maxAsset);
    if (!bytes.length) throw Error('A document release contains an empty asset.');
    file.hash = digest(bytes);
    file.size = bytes.length;
    await putOnce(store, assetKey(file.hash), bytes);
  });
  const bundle = { version: 1, ledger, files, publicDigest };
  validateBundle(bundle);
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.length > maxManifest) throw Error('The document release manifest is too large.');
  const id = digest(bytes);
  await putOnce(store, releaseKey(id), bytes);
  if (firstDeployId !== undefined) {
    // A failed first deploy can retry while the existing unmanaged production version is still live.
    await putOnce(store, 'initial-deploy', Buffer.from(JSON.stringify(firstDeployId)));
  }
  return { id, title: releasePrefix + id, publicDigest };
}

export async function restoreRelease(store, data, production) {
  const id = production?.title?.startsWith(releasePrefix)
    ? production.title.slice(releasePrefix.length)
    : undefined;
  if (!id) {
    const initial = await store.get('initial-deploy', { type: 'json' });
    // JSON null and a missing blob are indistinguishable. A named sentinel keeps no original deploy explicit.
    const firstDeployId = production?.id ?? 'no-production-deploy';
    if (initial !== null && initial !== firstDeployId) {
      throw Error('Production no longer points to a managed document release. Restore a managed Netlify deploy before publishing.');
    }
    return { firstDeployId };
  }
  if (!digestPattern.test(id)) throw Error('The published Netlify release has an invalid state ID.');
  const bytes = await store.get(releaseKey(id), { type: 'arrayBuffer' });
  if (!bytes || digest(Buffer.from(bytes)) !== id) throw Error('The state for the live Netlify deploy is missing or damaged.');
  const bundle = readJson(bytes);
  validateBundle(bundle);
  const directory = join(data, 'document-state-assets');
  await mkdir(directory, { recursive: true });
  const known = new Set(bundle.files.map((file) => file.name));
  const referenced = new Set(bundle.ledger.posts.map((post) => post.snapshot).filter(Boolean));
  const snapshots = [...referenced];
  if (snapshots.some((name) => !known.has(name))) throw Error('The live publication ledger is missing a snapshot.');
  await eachBatch(bundle.files, async ({ name, hash, size }) => {
    const bytes = await store.get(assetKey(hash), { type: 'arrayBuffer' });
    if (!bytes || bytes.byteLength !== size || digest(Buffer.from(bytes)) !== hash) {
      throw Error('An asset for the live publication is missing or damaged.');
    }
    if (snapshotPattern.test(name) && referenced.has(name)) {
      for (const asset of snapshotAssets(bytes)) {
        if (!known.has(asset)) throw Error('The live publication snapshot is missing an image or PDF.');
      }
    }
    await writeFile(join(directory, name), Buffer.from(bytes));
  });
  await writeFile(join(data, 'document-state.json'), JSON.stringify(bundle.ledger) + '\n');
  return { id, publicDigest: bundle.publicDigest };
}

async function actionOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const text = Object.entries(values).filter(([, val]) => val !== undefined).map(([key, value]) => {
    if (/[\r\n]/.test(String(value))) throw Error('Cannot write a multiline publication output.');
    return `${key}=${value}\n`;
  }).join('');
  await appendFile(process.env.GITHUB_OUTPUT, text);
}

async function netlifySite() {
  const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
  if (!siteID || !token) throw Error('The Netlify project ID or access token is missing.');
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteID)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`Could not read the Netlify production deployment (HTTP ${response.status}).`);
  const site = await response.json();
  if (site.id !== siteID || !/^[a-z0-9][a-z0-9-]*$/.test(site.name ?? '')) {
    throw Error('Netlify returned an unexpected project.');
  }
  return { siteID, token, site };
}

function privateDeployOrigin(url) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw Error('A Netlify deployment returned an unexpected origin.');
  }
  return origin.origin;
}

async function checkPrivate(origin, routes, request = fetch) {
  for (const route of routes) {
    const response = await request(new URL(route, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const location = response.headers.get('location');
    const target = location ? new URL(location, origin) : undefined;
    const providerGate = [301, 302, 303, 307, 308].includes(response.status)
      && target?.protocol === 'https:'
      && (target.hostname === 'app.netlify.com' || target.origin === origin && target.pathname.startsWith('/.netlify/'));
    await response.body?.cancel();
    if (![401, 403].includes(response.status) && !providerGate) {
      throw Error(`Anonymous access was not blocked at ${route} (HTTP ${response.status}).`);
    }
  }
}

async function checkPublished(title) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { site } = await netlifySite();
    if (site.published_deploy?.title === title && site.published_deploy.state === 'ready') {
      const siteOrigin = privateDeployOrigin(site.ssl_url ?? `https://${site.name}.netlify.app`);
      await checkPrivate(siteOrigin, ['/', '/favicon.png']);
      console.log('Verified that the managed release is live and private.');
      return;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw Error('Netlify did not acknowledge that the managed release went live.');
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function publishReport(data, request = fetch) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  let text;
  try {
    text = (await readBoundedFile(join(data, 'document-import-report.txt'), maxManifest)).toString('utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return;
  }
  await appendFile(summary, `### Document conversion\n\n<pre>${escapeHtml(text.slice(0, maxReport))}</pre>\n\n`);
  const { GH_TOKEN: token, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo } = process.env;
  if (!token || !/^[a-f0-9]{40}$/.test(sha ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) return;
  const report = readJson(await readBoundedFile(join(data, 'document-import-report.json'), maxManifest));
  const failures = report.records.filter((entry) => entry.status === 'problem');
  if (!failures.length) return;
  const marker = '<!-- second-ink-document-conversion -->';
  const lines = failures.map((entry) => {
    const file = entry.path ?? entry.file ?? 'Document';
    const reason = entry.reason ?? entry.message ?? 'Could not convert this document.';
    return `${file}: ${reason}`;
  }).join('\n');
  const body = `${marker}\nSecond Ink found a problem while publishing this commit.\n\n<pre>${escapeHtml(lines.slice(0, 12_000))}</pre>\n\nSee the conversion report in GitHub Actions for details.`;
  const endpoint = `https://api.github.com/repos/${repo}/commits/${sha}/comments`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const call = async (url, options) => request(url, {
    ...options, headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  try {
    for (let page = 1; page <= 5; page++) {
      const list = await call(`${endpoint}?per_page=100&page=${page}`);
      if (!list.ok) throw Error(`GitHub returned HTTP ${list.status} while checking existing commit comments.`);
      const comments = await list.json();
      if (comments.some((comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker))) return;
      if (comments.length < 100) {
        const reply = await call(endpoint, { method: 'POST', body: JSON.stringify({ body }) });
        if (!reply.ok) throw Error(`GitHub returned HTTP ${reply.status} while posting the conversion note.`);
        return;
      }
    }
    throw Error('The commit has too many comments to verify a single conversion note.');
  } catch (error) {
    await appendFile(summary, `Could not post the conversion note to the commit. ${escapeHtml(error.message)}\n\n`);
    console.warn('Could not post the conversion note to the commit. See the Actions summary.');
  }
}

async function main([command, arg, ...args]) {
  const data = resolve('.data');
  if (command === 'report') return publishReport(data);
  if (command === 'verify') return checkPublished(arg);
  if (command === 'verify-preview') {
    const { site } = await netlifySite();
    const origin = privateDeployOrigin(arg);
    if (!new URL(origin).hostname.endsWith(`--${site.name}.netlify.app`)) {
      throw Error('The preview address does not belong to the configured project.');
    }
    if (args.some((route) => !/^\/(?!\/)[A-Za-z0-9/_%.-]+$/.test(route))) throw Error('Invalid preview asset check.');
    await checkPrivate(origin, ['/', '/favicon.png', ...args]);
    return actionOutput({ url: origin });
  }

  const { site, siteID, token } = await netlifySite();
  if (command === 'verify-project' || command === 'restore') {
    const origin = privateDeployOrigin(site.ssl_url ?? `https://${site.name}.netlify.app`);
    if (!site.published_deploy?.id) throw Error('Publish a harmless placeholder, then make production and previews private before connecting GitHub.');
    await checkPrivate(origin, ['/']);
    if (command === 'verify-project') return;
  }
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'second-ink-publication', siteID, token, consistency: 'strong' });
  if (command === 'restore') {
    if (process.env.SITE_URL && privateDeployOrigin(process.env.SITE_URL) !== privateDeployOrigin(site.ssl_url)) {
      throw Error('The configured SITE_URL does not match the Netlify project’s canonical HTTPS origin.');
    }
    const prior = await restoreRelease(store, data, site.published_deploy);
    return actionOutput({
      public_digest: prior.publicDigest,
      first_deploy_id: prior.firstDeployId,
      published_id: site.published_deploy?.id ?? 'no-production-deploy',
    });
  }
  if (command === 'stage') {
    const [firstDeployId] = args;
    if (arg !== (site.published_deploy?.id ?? 'no-production-deploy')) {
      throw Error('The live Netlify deployment changed during this build. Start a new build from the latest state.');
    }
    const result = await stageRelease(store, data, await buildFingerprint(resolve('.netlify-output')), firstDeployId || undefined);
    return actionOutput({ title: result.title, public_digest: result.publicDigest });
  }
  throw Error('Unknown document publication command.');
}

export { checkPrivate };

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Second Ink publishing could not continue. ${error.name === 'BlobStoreError' ? 'Netlify Blobs was unavailable.' : error.message}`);
    process.exitCode = 1;
  }
}
