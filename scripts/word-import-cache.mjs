import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const maxEntryBytes = 64 * 1024 * 1024;
const entryName = /^[a-f0-9]{64}\.json$/;
const imageName = /^[a-f0-9]{24}\.webp$/;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function checksum(key, payload) {
  return digest(key + '\n' + payload);
}

function readConversion(filename, key, stored) {
  const separator = stored.indexOf('\n');
  const payload = stored.slice(separator + 1);
  if (separator !== 64 || stored.slice(0, separator) !== checksum(key, payload)) {
    throw new Error('Invalid document conversion cache checksum for ' + filename);
  }

  const { html, warnings, images, complex, cover, firstLine, withholding, problem } = JSON.parse(payload);
  if (typeof problem === 'string' && problem.length <= 500) return { problem };
  if (withholding) {
    if (!['draft', 'scheduled'].includes(withholding.status)
      || (withholding.status === 'scheduled' && typeof withholding.until !== 'string')) {
      throw new Error('Invalid document withholding cache entry.');
    }
    return { withholding };
  }
  if (typeof html !== 'string' || !Array.isArray(warnings)
    || !warnings.every((message) => typeof message === 'string') || !Array.isArray(images)) {
    throw new Error('Invalid Word conversion cache entry for ' + filename);
  }
  const decodedImages = new Map();
  for (const [name, encoded] of images) {
    if (!imageName.test(name) || typeof encoded !== 'string') {
      throw new Error('Invalid image in Word conversion cache');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (name !== digest(bytes).slice(0, 24) + '.webp') {
      throw new Error('Invalid image digest in Word conversion cache');
    }
    decodedImages.set(name, bytes);
  }
  return { html, warnings, images: decodedImages, complex, cover, firstLine };
}

export async function createWordImportCache(directory, fields, files) {
  const toolDigests = await Promise.all(files.map(async (file) => digest(await readFile(file))));
  const version = digest(JSON.stringify({ fields, toolDigests }));
  const used = new Set();
  let available = true;
  try {
    await mkdir(directory, { recursive: true });
    available = (await lstat(directory)).isDirectory();
  } catch {
    available = false;
  }

  function keyFor(input) {
    return createHash('sha256').update(version).update(input).digest('hex');
  }

  async function read(key) {
    if (!available) return undefined;
    const filename = key + '.json';
    const path = join(directory, filename);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > maxEntryBytes) return undefined;
      return readConversion(filename, key, await readFile(path, 'utf8'));
    } catch {
      return undefined;
    }
  }

  async function keep(key, converted) {
    if (!available) return;
    const filename = key + '.json';
    used.add(filename);
    if (!converted) return;

    const { html, warnings, images, complex, cover, firstLine, withholding, problem } = converted;
    const payload = JSON.stringify(problem ? { problem } : withholding ? { withholding } : {
      html,
      warnings,
      images: [...images].map(([name, bytes]) => [name, bytes.toString('base64')]),
      complex,
      cover,
      firstLine,
    });
    if (Buffer.byteLength(payload) + 65 > maxEntryBytes) return;
    const temporary = join(directory, '.' + filename + '.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, checksum(key, payload) + '\n' + payload, { flag: 'wx' });
      await rename(temporary, join(directory, filename));
    } catch {
      await unlink(temporary).catch(() => {});
    }
  }

  async function prune() {
    if (!available) return;
    const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (file.isFile() && entryName.test(file.name) && !used.has(file.name)) {
        await unlink(join(directory, file.name)).catch(() => {});
      }
    }
  }

  return { keyFor, read, keep, prune };
}
