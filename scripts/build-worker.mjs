import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const project = new URL('../', import.meta.url);
const output = new URL('dist/', project);
const distPath = fileURLToPath(output);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function collectAssets(directory, assets) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || (directory === distPath && ['server', '_redirects'].includes(entry.name))) continue;
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectAssets(filename, assets);
      continue;
    }
    if (!entry.isFile()) continue;

    const urlPath = '/' + relative(distPath, filename).split(sep).map(encodeURIComponent).join('/');
    const route = urlPath.replace(/\/index\.html$/, '/');
    const type = route === '/rss.xml'
      ? 'application/rss+xml; charset=utf-8'
      : mimeTypes[extname(entry.name).toLowerCase()] ?? 'application/octet-stream';
    const binary = !type.includes('charset=utf-8');
    const bytes = readFileSync(filename);
    assets[route] = {
      type,
      etag: `"${createHash('sha256').update(bytes).digest('base64url').slice(0, 24)}"`,
      body: bytes.toString(binary ? 'base64' : 'utf8'),
      binary,
    };
  }
}

const assets = {};
collectAssets(distPath, assets);
if (!assets['/'] || !assets['/404.html']) {
  throw new Error('Build the Astro home and 404 pages before packaging the Worker.');
}
let redirects = {};
try {
  const rules = readFileSync(join(distPath, '_redirects'), 'utf8');
  const aliases = rules.split(/\r?\n/).map((line) => line.match(/^(\/(?:posts|authors)\/[a-z0-9-]+\/) (\/(?:posts|authors)\/[a-z0-9-]+\/) 301!$/));
  redirects = Object.fromEntries(aliases.filter((rule) => rule && assets[rule[2]]).map((rule) => [rule[1], rule[2]]));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const bundled = await build({
  stdin: {
    contents: `import { createWorker } from './worker.mjs';\nexport default createWorker(${JSON.stringify(assets)}, ${JSON.stringify(redirects)});`,
    resolveDir: fileURLToPath(new URL('./', import.meta.url)),
    sourcefile: 'second-ink-worker.mjs',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['worker'],
  target: 'es2022',
  minify: true,
  charset: 'utf8',
});

mkdirSync(new URL('server/', output), { recursive: true });
mkdirSync(new URL('.openai/', output), { recursive: true });
const worker = bundled.outputFiles[0].contents;
writeFileSync(new URL('server/index.js', output), worker);
const manifest = new URL('.openai/hosting.json', project);
if (existsSync(manifest)) copyFileSync(manifest, new URL('.openai/hosting.json', output));
cpSync(fileURLToPath(new URL('drizzle/', project)), fileURLToPath(new URL('.openai/drizzle/', output)), { recursive: true });
console.log(`Packaged ${Object.keys(assets).length} assets in the Sites Worker (${Math.round(gzipSync(worker).length / 1024)} KB gzipped).`);
