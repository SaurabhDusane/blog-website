import { cpSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const dist = join(root, 'dist');
const publish = join(root, '.netlify-output');
const previous = lstatSync(publish, { throwIfNoEntry: false });
if (previous) {
  if (!previous.isDirectory() || previous.isSymbolicLink() || realpathSync(publish) !== publish) {
    throw new Error('Expected an ordinary .netlify-output directory inside the project.');
  }
  rmSync(publish, { recursive: true });
}

mkdirSync(publish, { recursive: true });
const skipped = new Set(['server', 'document-template']);
if (process.env.VERCEL === '1') skipped.add('desk');
for (const name of readdirSync(dist)) {
  if (name.startsWith('.') || skipped.has(name)) continue;
  cpSync(join(dist, name), join(publish, name), { recursive: true });
}
