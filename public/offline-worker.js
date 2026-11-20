const version = 'second-ink-offline-v1:';
const shelfCachePrefix = version + 'shelf:';
const shelfCacheName = shelfCachePrefix + '__SECOND_INK_SHELF_REVISION__';
const essayCachePrefix = version + 'essay:';
const recordPath = '/_offline-entry';
const shelfPath = '/offline/';
const maxEssays = 12;
const maxResources = 80;
const maxEssayBytes = 4 * 1024 * 1024;
const maxShelfBytes = 1024 * 1024;
const slugPattern = '[a-z0-9]+(?:-[a-z0-9]+)*';
const slug = new RegExp('^' + slugPattern + '$');
const essayPath = new RegExp('^/posts/(' + slugPattern + ')(?:/index\\.html|/)?$');
const readingPath = new RegExp('^/(?:topics|series|authors)/' + slugPattern + '/?$');
const readerPages = new Set(['/', '/start/', '/explore/', '/saved/', '/about/', '/newsletter/', shelfPath]);
const mediaTypes = new Set(['script', 'style', 'image', 'font', 'manifest']);
const assetExtension = /\.(?:css|m?js|woff2?|png|webp|jpe?g|avif|gif|ico|svg|webmanifest)$/i;
const origin = self.location.origin;

let operations = Promise.resolve();

function urlFor(path) {
  return new URL(path, origin).href;
}

function offlineError(message) {
  return Object.assign(new Error(message), { publicMessage: message });
}

function hasAssetPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    && assetExtension.test(path) && !/^\/(?:api|desk|server)\//.test(path)
    && new URL(path, origin).href === origin + path;
}

function resourcesFor(entries, documentPath, maxBytes) {
  if (!Array.isArray(entries) || entries.length > maxResources) return undefined;
  const paths = new Set();
  let bytes = 0;
  for (const entry of entries) {
    if (!entry || (entry.path !== documentPath && !hasAssetPath(entry.path))
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || paths.has(entry.path)) return undefined;
    bytes += entry.bytes;
    paths.add(entry.path);
  }
  return bytes <= maxBytes && paths.has(documentPath) ? [...paths] : undefined;
}

async function resourceIndex() {
  const response = await fetch(urlFor('/offline-assets.json'), { cache: 'no-cache', redirect: 'error' });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
    throw offlineError('The offline shelf couldn’t load. Try again when you’re connected.');
  }
  return response.json();
}

async function storeResources(cache, paths, documentPath, maxBytes) {
  let bytes = 0;
  for (const path of paths) {
    const key = urlFor(path);
    const response = await fetch(key, { credentials: 'same-origin', cache: 'no-cache', redirect: 'error' });
    if (response.status !== 200 || response.redirected || response.url !== key) {
      throw offlineError('Part of this essay didn’t download. Try again when you’re connected.');
    }
    const html = response.headers.get('Content-Type')?.startsWith('text/html');
    if (Boolean(html) !== (path === documentPath)) {
      throw offlineError('This copy isn’t available to keep offline.');
    }
    bytes += (await response.clone().arrayBuffer()).byteLength;
    if (bytes > maxBytes) throw offlineError('This essay is too large for the offline shelf.');
    await cache.put(key, response);
  }
}

async function installShelf() {
  const index = await resourceIndex();
  const paths = resourcesFor(index.shelf, shelfPath, maxShelfBytes);
  if (!paths) throw new Error('The offline shelf has an incomplete asset list.');
  const cache = await caches.open(shelfCacheName);
  await storeResources(cache, paths, shelfPath, maxShelfBytes);
  const expected = new Set(paths.map(urlFor));
  for (const request of await cache.keys()) {
    if (!expected.has(request.url)) await cache.delete(request);
  }
}

async function openEssays() {
  const saved = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(essayCachePrefix)) continue;
    const id = name.slice(essayCachePrefix.length);
    if (!slug.test(id)) continue;
    const cache = await caches.open(name);
    const record = await cache.match(urlFor(recordPath));
    if (!record) continue;
    try {
      const entry = await record.json();
      if (entry.id !== id || typeof entry.title !== 'string' || !Number.isFinite(entry.savedAt)) continue;
      saved.push({ cache, entry });
    } catch {
      // An incomplete record does not count as a saved essay.
    }
  }
  return saved;
}

async function keepEssay(id, title) {
  const alreadySaved = await openEssays();
  if (alreadySaved.some(({ entry }) => entry.id === id)) return;
  if (alreadySaved.length >= maxEssays) {
    throw offlineError('The shelf holds 12 essays. Take one off to make room.');
  }

  const article = '/posts/' + id + '/';
  const index = await resourceIndex();
  const paths = resourcesFor(Object.hasOwn(index.essays ?? {}, id) ? index.essays[id] : undefined, article, maxEssayBytes);
  if (!paths) throw offlineError('This essay isn’t available in a small enough offline copy.');

  const name = essayCachePrefix + id;
  await caches.delete(name);
  try {
    const cache = await caches.open(name);
    await storeResources(cache, paths, article, maxEssayBytes);
    const record = { id, title: title.slice(0, 250), savedAt: Date.now() };
    await cache.put(urlFor(recordPath), Response.json(record));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

async function listEssays() {
  return (await openEssays()).map(({ entry }) => entry).sort((first, second) => second.savedAt - first.savedAt);
}

async function notifyChanges() {
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    client.postMessage({ type: 'second-ink:offline-changed' });
  }
}

self.addEventListener('install', (event) => event.waitUntil(installShelf().then(() => self.skipWaiting())));

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    const oldVersion = name.startsWith('second-ink-offline-') && !name.startsWith(version);
    const oldShelf = name.startsWith(shelfCachePrefix) && name !== shelfCacheName;
    if (oldVersion || oldShelf) await caches.delete(name);
  }
  await self.clients.claim();
})()));

self.addEventListener('message', (event) => {
  const { source, data, ports } = event;
  const port = ports[0];
  if (!port || source?.type !== 'window' || !source.url.startsWith(origin + '/')) return;
  if (!data || typeof data !== 'object' || !['offline:list', 'offline:keep', 'offline:remove'].includes(data.type)) return;

  const operation = operations.then(async () => {
    if (data.type !== 'offline:list') {
      if (typeof data.id !== 'string' || !slug.test(data.id)) throw offlineError('This essay couldn’t be found.');
      if (data.type === 'offline:keep') {
        if (essayPath.exec(new URL(source.url).pathname)?.[1] !== data.id || typeof data.title !== 'string' || !data.title.trim()) {
          throw offlineError('Open that essay to keep a copy.');
        }
        await keepEssay(data.id, data.title);
      } else {
        await caches.delete(essayCachePrefix + data.id);
      }
      await notifyChanges();
    }
    return { ok: true, entries: await listEssays() };
  });
  operations = operation.catch(() => {});
  event.waitUntil(operation.then(
    (result) => port.postMessage(result),
    (error) => port.postMessage({ ok: false, message: error?.publicMessage ?? 'The offline shelf couldn’t save that change. Try again when connected.' }),
  ));
});

async function serveNavigation(request, id) {
  try {
    // A redirect or an HTTP access response always wins over a stored copy.
    return await fetch(request);
  } catch {
    if (id && (await caches.keys()).includes(essayCachePrefix + id)) {
      const cache = await caches.open(essayCachePrefix + id);
      const record = await cache.match(urlFor(recordPath));
      const article = record && await cache.match(urlFor('/posts/' + id + '/'));
      if (article) return article;
    }
    const shelf = await caches.open(shelfCacheName);
    return await shelf.match(urlFor(shelfPath)) ?? Response.error();
  }
}

async function serveMedia(request, pathname) {
  if (!pathname.startsWith('/_astro/') && !pathname.startsWith('/word-images/')) {
    try { return await fetch(request); } catch { /* Try the offline shelf. */ }
  }
  const assetKey = urlFor(pathname);
  const shelf = await caches.open(shelfCacheName);
  const shelfAsset = await shelf.match(assetKey);
  if (shelfAsset) return shelfAsset;
  for (const { cache } of await openEssays()) {
    const response = await cache.match(assetKey);
    if (response) return response;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const { origin: requestOrigin, pathname } = new URL(request.url);
  if (requestOrigin !== origin) return;

  if (request.mode === 'navigate') {
    const id = essayPath.exec(pathname)?.[1];
    const withSlash = pathname.endsWith('/') ? pathname : pathname + '/';
    if (id || readerPages.has(withSlash) || readingPath.test(pathname)) {
      event.respondWith(serveNavigation(request, id));
    }
  } else if (mediaTypes.has(request.destination) && hasAssetPath(pathname)) {
    event.respondWith(serveMedia(request, pathname));
  }
});
