import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { digest, git, list } from './document-state.mjs';

export const maxFileBytes = 40 * 1024 * 1024;
export const metadataFields = new Set([
  'title', 'date', 'tags', 'summary', 'status', 'publish-date', 'source-title', 'source-author',
  'source-url', 'source', 'why-i-picked-this', 'claim', 'claim-question', 'question', 'archive-url',
  'mood', 'author', 'update', 'reading-paths', 'series', 'connection', 'what-i-think-now', 'kind', 'follow-up',
  'source-note', 'field-note-prompt',
]);
export const repeatedMetadataFields = new Set(['update', 'connection', 'what-i-think-now', 'source-note']);

export function metadataField(value) {
  const field = value.trim().toLowerCase().replace(/\s+/g, '-');
  return field === 'connections' ? 'connection' : field;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export async function documentSources(root) {
  const inputs = [];
  for (const prefix of ['posts', 'posts/essays', 'posts/drafts', 'posts/threads']) {
    const draft = prefix === 'posts/drafts';
    const looseThread = prefix === 'posts/threads';
    const entries = await list(join(root, prefix));
    const metadata = new Map(entries.filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => [entry.name, prefix + '/' + entry.name]));
    for (const item of entries) {
      const extension = item.name.match(/\.(docx|pdf)$/i)?.[1].toLowerCase();
      if (!extension || !item.isFile() || item.name.startsWith('~$')) continue;
      const stem = item.name.slice(0, -(extension.length + 1));
      const sidecars = extension === 'pdf' ? [...metadata]
        .filter(([name]) => name.replace(/\.ya?ml$/i, '') === stem)
        .map(([, path]) => path) : [];
      const labelsPath = prefix + '/' + item.name + '.labels.yml';
      inputs.push({ path: prefix + '/' + item.name, filename: item.name, draft, looseThread, format: extension, stem, sidecars,
        labelsPath, labelsFile: metadata.get(item.name + '.labels.yml') });
    }
  }
  return inputs.sort((first, second) => first.path.localeCompare(second.path, 'en'));
}

export async function readSource(root, source) {
  const path = join(root, source.path);
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('This upload is not a regular file.');
  if (info.size > maxFileBytes) throw new Error('The document exceeds the 40 MiB conversion limit.');
  const bytes = await readFile(path);
  if (bytes.length > maxFileBytes) throw new Error('The document exceeds the 40 MiB conversion limit.');
  return { bytes, info, sourceHash: digest(bytes) };
}

export async function readPdfMetadata(root, sidecars, label = 'PDF companion file') {
  if (!sidecars.length) return {};
  if (sidecars.length > 1) throw new Error('Use one YAML companion file for this PDF.');
  const path = join(root, sidecars[0]);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error(`The ${label} exceeds the 64 KiB metadata limit.`);
  const document = parseDocument(await readFile(path, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) throw new Error(`The ${label} could not be read as YAML.`);
  let values;
  try {
    values = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
  } catch {
    throw new Error(`The ${label} contains unsupported YAML aliases.`);
  }
  if (values === null) return {};
  if (!(values instanceof Map)) throw new Error(`The ${label} needs one field per line.`);
  const metadata = {};
  for (const [key, value] of values) {
    const field = typeof key === 'string' ? metadataField(key) : '';
    if (!metadataFields.has(field)) continue;
    if (field === 'update' && typeof value === 'string' && value.trim()) {
      metadata[field] = value.trim();
    } else if (repeatedMetadataFields.has(field)) {
      const items = (Array.isArray(value) ? value : [value])
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim());
      if (items.length) metadata[field] = [...(metadata[field] ?? []), ...items];
    } else if (typeof value === 'string' && value.trim()) metadata[field] = value.trim();
    else if (Array.isArray(value) && ['tags', 'series', 'reading-paths'].includes(field)) {
      metadata[field] = value.filter((item) => typeof item === 'string').join(', ');
    }
  }
  return metadata;
}

export async function readLabelCorrections(root, file) {
  if (!file) return {};
  const metadata = await readPdfMetadata(root, [file], 'label correction file');
  const { tags, mood } = metadata;
  if (mood !== undefined && !['reflective', 'practical', 'curious'].includes(mood.toLowerCase())) {
    throw new Error('A corrected mood must be reflective, practical, or curious.');
  }
  return { ...(tags !== undefined ? { tags } : {}), ...(mood !== undefined ? { mood } : {}) };
}

export function committedDate(root, path) {
  const dates = git(root, ['log', '--diff-filter=A', '--follow', '--format=%cs', '--', path]).trim();
  return validDate(dates.split(/\r?\n/).at(-1));
}

export function editDate(root, source) {
  const date = git(root, ['log', '-1', '--format=%cs', '--', source.path, ...source.sidecars, source.labelsPath].filter(Boolean)).trim();
  return validDate(date);
}

export function inspectWordContainer(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') {
    throw new Error('The Word document is password-protected or uses the older .doc format.');
  }
  // Word documents are ZIP archives. Bound the amount of XML and media inflated by Mammoth.
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const end = bytes.lastIndexOf(endSignature);
  if (end < 0 || end + 22 > bytes.length) throw new Error('The Word document is damaged or is not a .docx file.');
  const entryCount = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let expanded = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('The Word document has an unreadable archive directory.');
    }
    const size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28);
    if (offset + 46 + length > end) throw new Error('The Word document has an unreadable archive directory.');
    const name = bytes.toString('utf8', offset + 46, offset + 46 + length);
    expanded += size;
    if (entryCount > 5_000 || expanded > 192 * 1024 * 1024 || (/\.xml$/i.test(name) && size > 20 * 1024 * 1024)) {
      throw new Error('The Word document contains too much expanded XML or media to convert safely.');
    }
    if (bytes.readUInt16LE(offset + 8) & 1) throw new Error('The Word document is password-protected.');
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}
