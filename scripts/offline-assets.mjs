import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const buildOrigin = 'https://offline-build.invalid';
const articleSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const staticExtension = /\.(?:css|m?js|woff2?|png|webp|jpe?g|avif|gif|ico|svg|webmanifest)$/i;
const assetRelations = new Set(['stylesheet', 'modulepreload', 'preload', 'icon', 'apple-touch-icon', 'manifest']);

function localAsset(reference, from) {
  try {
    const url = new URL(reference, buildOrigin + from);
    if (url.origin !== buildOrigin || !staticExtension.test(url.pathname)) return undefined;
    if (url.pathname.startsWith('/desk/') || url.pathname.startsWith('/api/')) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

function cssAssets(css) {
  return Array.from(css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g), (match) => (
    match[1] ?? match[2] ?? match[3]
  ));
}

function moduleAssets(script) {
  // Astro's compiled modules use literal URLs for imports and shared chunks.
  return Array.from(script.matchAll(/\b(?:from\s*|import(?:\s*\(\s*|\s*))['"]((?:\.\.?\/|\/_astro\/)[^'"]+)['"]/g), (match) => match[1]);
}

function htmlAssets(html) {
  const references = [];
  function visit(node) {
    if (node.attrs) {
      const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (node.tagName === 'link' && assetRelations.has(attributes.rel)) references.push(attributes.href);
      if (node.tagName === 'script') {
        if (attributes.src) references.push(attributes.src);
        else if (attributes.type === 'module') {
          references.push(...moduleAssets(node.childNodes?.[0]?.value ?? ''));
        }
      }
      if (node.tagName === 'img' || node.tagName === 'source') {
        references.push(attributes.src);
        if (attributes.srcset) {
          // A data URI needs no download and may contain a literal comma.
          if (!attributes.srcset.trimStart().startsWith('data:')) {
            references.push(...attributes.srcset.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]));
          }
        }
      }
      if (node.tagName === 'style') references.push(...cssAssets(node.childNodes?.[0]?.value ?? ''));
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return references.filter(Boolean);
}

function statAsset(root, path) {
  const decoded = decodeURIComponent(path);
  const filename = resolve(root, '.' + decoded, decoded.endsWith('/') ? 'index.html' : '');
  const fromRoot = relative(root, filename);
  if (fromRoot.startsWith('..' + sep) || fromRoot === '..' || decoded.includes('\\')) return undefined;
  const stat = statSync(filename, { throwIfNoEntry: false });
  return stat?.isFile() ? { filename, bytes: stat.size } : undefined;
}

function dependencyList(root, pathname) {
  const pending = [pathname];
  const seen = new Set();
  const resources = [];

  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const asset = statAsset(root, path);
    if (!asset) continue;
    resources.push({ path, bytes: asset.bytes });

    let references = [];
    if (path === pathname) references = htmlAssets(readFileSync(asset.filename, 'utf8'));
    else if (extname(path) === '.css') references = cssAssets(readFileSync(asset.filename, 'utf8'));
    else if (/\.m?js$/i.test(path)) references = moduleAssets(readFileSync(asset.filename, 'utf8'));
    else if (extname(path) === '.webmanifest') {
      const manifest = JSON.parse(readFileSync(asset.filename, 'utf8'));
      references = (manifest.icons ?? []).map((icon) => icon.src).filter(Boolean);
    }
    for (const reference of references) {
      const destination = localAsset(reference, path);
      if (destination && !seen.has(destination)) pending.push(destination);
    }
  }
  return resources.sort((first, second) => first.path.localeCompare(second.path));
}

export function offlineAssets() {
  return {
    name: 'second-ink-offline-assets',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const output = fileURLToPath(dir);
        const essays = {};
        for (const entry of readdirSync(resolve(output, 'posts'), { withFileTypes: true })) {
          if (!entry.isDirectory() || !articleSlug.test(entry.name)) continue;
          const resources = dependencyList(output, '/posts/' + entry.name + '/');
          if (resources.length) essays[entry.name] = resources;
        }
        const shelf = dependencyList(output, '/offline/');
        writeFileSync(resolve(output, 'offline-assets.json'), JSON.stringify({ shelf, essays }) + '\n');
        const revision = createHash('sha256');
        for (const { path } of shelf) {
          const asset = statAsset(output, path);
          revision.update(path).update(readFileSync(asset.filename));
        }
        const workerPath = resolve(output, 'offline-worker.js');
        const worker = readFileSync(workerPath, 'utf8');
        writeFileSync(workerPath, worker.replace('__SECOND_INK_SHELF_REVISION__', revision.digest('hex').slice(0, 16)));
      },
    },
  };
}
