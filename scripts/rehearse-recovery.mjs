import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createLocalStorage } from './local-storage.mjs';
import { recoveryColumns, recoveryFormat, referencedRecoveryMedia } from './recovery-bundle.mjs';

const maxLine = 1024 * 1024;
const maxAttachment = 64 * 1024 * 1024;
const prefix = 'second-ink-recovery-';

async function* records(filename) {
  const input = createReadStream(filename, { encoding: 'utf8', highWaterMark: 32 * 1024 });
  let pending = '';
  for await (const chunk of input) {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (!line || line.length > maxLine) throw new Error('An archive record is invalid or too large');
      yield JSON.parse(line);
    }
    if (pending.length > maxLine) throw new Error('An archive record is too large');
  }
  if (pending) throw new Error('An archive record was cut off');
}

async function cleanAttempt(folder, parent) {
  const resolved = await realpath(folder);
  if (dirname(resolved) === parent && basename(resolved).startsWith(prefix)) await rm(resolved, { recursive: true, force: true });
}

export async function rehearseRecovery(filename) {
  const parent = await realpath(tmpdir());
  const folder = await mkdtemp(join(parent, prefix));
  const databasePath = join(folder, 'second-ink.sqlite');
  let database;
  let attachment;
  try {
    if (process.platform !== 'win32') await chmod(folder, 0o700);
    const storage = createLocalStorage(databasePath);
    try { await storage.checkResponseStorage(); } finally { storage.close(); }
    if (process.platform !== 'win32') await chmod(databasePath, 0o600);
    database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    database.exec('BEGIN');

    const inserts = new Map();
    const expectedMedia = new Set();
    const restoredMedia = new Set();
    let header;
    let complete = false;
    let rows = 0;
    let mediaStarted = false;

    for await (const entry of records(filename)) {
      if (!entry || typeof entry !== 'object' || complete) throw new Error('Unexpected recovery record');
      if (!header) {
        if (entry.type !== 'header' || entry.format !== recoveryFormat || !Number.isFinite(Date.parse(entry.exportedAt))) {
          throw new Error('This is not a Second Ink recovery bundle');
        }
        header = entry;
      } else if (entry.type === 'row' && !mediaStarted) {
        const { table, data } = entry;
        if (!Object.hasOwn(recoveryColumns, table) || !data || Array.isArray(data)
          || Object.keys(data).length !== recoveryColumns[table].length) throw new Error('Unexpected database fields');
        const columns = recoveryColumns[table];
        const values = columns.map((column) => {
          if (!Object.hasOwn(data, column)) throw new Error('A database field is missing');
          const value = data[column];
          if (value !== null && typeof value !== 'string' && !Number.isSafeInteger(value)) throw new Error('Invalid database field');
          return value;
        });
        if (!inserts.has(table)) {
          inserts.set(table, database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`));
        }
        inserts.get(table).run(...values);
        const media = referencedRecoveryMedia(table, data);
        if (media) expectedMedia.add(media);
        rows += 1;
      } else if (entry.type === 'media' && !attachment) {
        mediaStarted = true;
        const { key, size } = entry;
        if (!expectedMedia.has(key) || restoredMedia.has(key) || !Number.isSafeInteger(size) || size < 1 || size > maxAttachment) {
          throw new Error('An attachment entry is invalid');
        }
        const filename = join(folder, 'editorial-media', key);
        await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
        attachment = { key, size, handle: await open(filename, 'wx', 0o600), hash: createHash('sha256'), written: 0 };
      } else if (entry.type === 'chunk' && attachment && typeof entry.bytes === 'string') {
        const bytes = Buffer.from(entry.bytes, 'base64');
        attachment.written += bytes.length;
        if (!bytes.length || bytes.toString('base64') !== entry.bytes || attachment.written > attachment.size) {
          throw new Error('An attachment chunk is corrupt');
        }
        attachment.hash.update(bytes);
        await attachment.handle.writeFile(bytes);
      } else if (entry.type === 'end-media' && attachment) {
        if (attachment.written !== attachment.size || attachment.hash.digest('hex') !== attachment.key.split('/')[1].split('.')[0]) {
          throw new Error('An attachment failed its integrity check');
        }
        await attachment.handle.close();
        restoredMedia.add(attachment.key);
        attachment = undefined;
      } else if (entry.type === 'complete' && !attachment && entry.rows === rows
        && entry.attachments === restoredMedia.size && expectedMedia.size === restoredMedia.size) {
        complete = true;
      } else throw new Error('The archive ended incorrectly or contains an unexpected record');
    }
    if (!complete) throw new Error('The recovery bundle is incomplete');
    if (database.prepare('PRAGMA foreign_key_check').all().length || database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
      throw new Error('The restored database failed its integrity check');
    }
    database.exec('COMMIT');
    database.close();
    return { folder, database: databasePath, rows, attachments: restoredMedia.size };
  } catch (error) {
    await attachment?.handle.close().catch(() => {});
    try { database?.close(); } catch { /* Close any partial transaction. */ }
    await cleanAttempt(folder, parent);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2];
  if (!filename || process.argv.length !== 3) {
    console.error('Usage: node scripts/rehearse-recovery.mjs path/to/recovery-bundle.ndjson');
    process.exitCode = 1;
  } else await rehearseRecovery(filename).then((result) => {
    console.log(`Verified ${result.rows} database records and ${result.attachments} attachments in an isolated copy.`);
    console.log(result.folder);
  }, () => {
    console.error('Recovery failed. Check that the bundle downloaded completely and matches the current schema.');
    process.exitCode = 1;
  });
}
