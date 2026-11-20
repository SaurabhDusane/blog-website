import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^[a-f0-9]{64}$/;
const snapshotName = /^[a-f0-9]{64}\.json$/;
const assetName = /^(?:[a-f0-9]{24}\.webp|[a-f0-9]{64}\.pdf)$/;
const sourcePath = /^posts\/(?:(?:drafts|essays|threads)\/)?[^/\\\0]+\.(?:docx|pdf)$/i;

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function git(root, args) {
  try {
    return execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), '--literal-pathspecs', ...args], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

export async function list(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeIfChanged(path, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const stat = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat && !stat.isFile()) throw new Error('Expected a regular generated file.');
  if (stat?.size === bytes.length && (await readFile(path)).equals(bytes)) return;
  const temporary = join(dirname(path), '.' + randomUUID() + '.tmp');
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function syncOutput(directory, files, owned) {
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) throw new Error('Expected a regular generated directory.');
  for (const [name, content] of files) await writeIfChanged(join(directory, name), content);
  await pruneOutput(directory, files, owned);
}

export async function pruneOutput(directory, files, owned) {
  for (const item of await list(directory)) {
    if (item.isFile() && owned.test(item.name) && !files.has(item.name)) await unlink(join(directory, item.name));
  }
}

function validRecord(record) {
  return record && sourcePath.test(record.path) && slugPattern.test(record.slug)
    && Array.isArray(record.aliases) && record.aliases.every((alias) => slugPattern.test(alias))
    && typeof record.publishedAt === 'string' && Number.isFinite(Date.parse(record.publishedAt))
    && (record.updatedAt === undefined || Number.isFinite(Date.parse(record.updatedAt)))
    && digestPattern.test(record.sourceHash) && digestPattern.test(record.fingerprint)
    && (record.snapshot === undefined || snapshotName.test(record.snapshot));
}

export async function readPublicationState(directory) {
  const path = join(directory, 'document-state.json');
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, revision: null, posts: [] };
    throw new Error('The saved publication record could not be opened.', { cause: error });
  }
  if (state?.version !== 1 || !Array.isArray(state.posts) || !state.posts.every(validRecord)
    || !(state.revision === null || /^[a-f0-9]{40,64}$/.test(state.revision))) {
    throw new Error('The saved publication record is invalid.');
  }
  return state;
}

export function findRenames(root, baseline, revision) {
  const output = baseline && revision && baseline !== revision
    ? git(root, ['diff', '-M', '--name-status', '--diff-filter=R', '-z', baseline, revision, '--', 'posts/'])
    : '';
  const fields = output.split('\0').filter(Boolean);
  const renames = new Map();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [change, oldPath, newPath] = fields.slice(index, index + 3);
    if (/^R\d+$/.test(change) && sourcePath.test(oldPath) && sourcePath.test(newPath)) renames.set(newPath, oldPath);
  }
  return renames;
}

export async function createSnapshotStore(directory) {
  const folder = join(directory, 'document-state-assets');
  await mkdir(folder, { recursive: true });
  if (!(await lstat(folder)).isDirectory()) throw new Error('Expected a regular publication asset directory.');

  async function readVerified(name, pattern) {
    if (!pattern.test(name)) throw new Error('The saved publication references an invalid asset.');
    const bytes = await readFile(join(folder, name));
    if (!digest(bytes).startsWith(name.split('.')[0])) throw new Error('A saved publication asset failed verification.');
    return bytes;
  }

  return {
    async read(name) {
      const snapshot = JSON.parse(await readVerified(name, snapshotName));
      const { version, data, html, tags, assets } = snapshot;
      if (version !== 1 || !data || typeof html !== 'string' || !Array.isArray(tags) || !Array.isArray(assets)) {
        throw new Error('The saved post conversion is invalid.');
      }
      const files = new Map();
      for (const file of assets) files.set(file, await readVerified(file, assetName));
      return { data, html, tags, files };
    },
    async stage({ data, html, tags, files }) {
      for (const [name, bytes] of files) {
        if (!assetName.test(name) || !digest(bytes).startsWith(name.split('.')[0])) {
          throw new Error('The converted post produced an invalid asset.');
        }
        await writeIfChanged(join(folder, name), bytes);
      }
      const serialized = JSON.stringify({ version: 1, data, html, tags, assets: [...files.keys()].sort() });
      const name = digest(serialized) + '.json';
      await writeIfChanged(join(folder, name), serialized);
      return name;
    },
  };
}
