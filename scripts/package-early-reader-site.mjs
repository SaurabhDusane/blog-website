import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const checkout = new URL('.data/early-reader-site/', root);
const built = new URL('dist/', root);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const assets = {};
const paths = new Set(['/early-reader/index.html']);
for (const path of paths) {
  const type = types[extname(path)];
  if (!type) throw Error(`Unexpected review asset type for ${path}`);
  const bytes = readFileSync(new URL(path.slice(1), built));
  const binary = !type.includes('charset=');
  const body = bytes.toString(binary ? 'base64' : 'utf8');
  assets[path.replace(/index\.html$/, '')] = [type, body, binary];
  if (binary) continue;
  const references = body.matchAll(/(?:\/_astro\/|\.\/)([\w.-]+\.(?:js|css|woff2?))\b/g);
  for (const match of references) paths.add(`/_astro/${match[1]}`);
}
const projectId = process.argv[2];
if (projectId && !/^appgprj_[a-z0-9]+$/i.test(projectId)) throw Error('Pass the existing review project ID.');
for (const directory of ['.openai/', 'dist/server/', 'dist/.openai/']) mkdirSync(new URL(directory, checkout), { recursive: true });
for (const file of ['early-reader-site.mjs', 'early-reader-relay.mjs', 'public-reader-relay.mjs', 'reader-crypto.mjs']) {
  copyFileSync(new URL(`scripts/${file}`, root), new URL(file, checkout));
}
writeFileSync(new URL('.gitignore', checkout), 'dist/\n');
writeFileSync(new URL('reader-assets.json', checkout), JSON.stringify(assets));
if (projectId) {
  const manifest = JSON.stringify({ project_id: projectId, d1: null, r2: null }, null, 2) + '\n';
  writeFileSync(new URL('.openai/hosting.json', checkout), manifest);
  writeFileSync(new URL('dist/.openai/hosting.json', checkout), manifest);
}
writeFileSync(new URL('index.mjs', checkout), "import assets from './reader-assets.json' with { type: 'json' };\nimport { createEarlyReaderSite } from './early-reader-site.mjs';\nexport default createEarlyReaderSite(assets);\n");
await build({ entryPoints: [fileURLToPath(new URL('index.mjs', checkout))], outfile: fileURLToPath(new URL('dist/server/index.js', checkout)),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true });
console.log(`Prepared ${Object.keys(assets).length} guest page assets at ${fileURLToPath(checkout)}.`);
