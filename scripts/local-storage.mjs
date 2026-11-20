import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeedbackStorage } from './feedback-storage.mjs';
import { createEditorialStorage } from './editorial-storage.mjs';
import { createEarlyReaderStorage } from './early-reader-storage.mjs';
import { insertReply, insertSubscription } from './submissions.mjs';

const defaultPath = fileURLToPath(new URL('../.data/second-ink.sqlite', import.meta.url));
const migrationDirectory = new URL('../drizzle/', import.meta.url);

export function createLocalStorage(databasePath = defaultPath) {
  let database;
  let opening;

  function migrate(connection) {
    const { entries } = JSON.parse(readFileSync(new URL('meta/_journal.json', migrationDirectory), 'utf8'));
    connection.exec('BEGIN IMMEDIATE');
    try {
      const { user_version: version } = connection.prepare('PRAGMA user_version').get();
      for (const { idx, tag } of entries.slice(version)) {
        connection.exec(readFileSync(new URL(`${tag}.sql`, migrationDirectory), 'utf8'));
        connection.exec(`PRAGMA user_version = ${idx + 1}`);
      }
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async function open() {
    const { DatabaseSync } = await import('node:sqlite');
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    }
    database = new DatabaseSync(databasePath);
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      migrate(database);
      const statements = new Map();
      return (sql) => {
        if (!statements.has(sql)) statements.set(sql, database.prepare(sql));
        return statements.get(sql);
      };
    } catch (error) {
      database.close();
      database = undefined;
      throw error;
    }
  }

  async function statement(sql) {
    opening ??= open().catch((error) => {
      opening = undefined;
      throw error;
    });
    const prepare = await opening;
    return prepare(sql);
  }

  const all = async (sql, ...values) => (await statement(sql)).all(...values);
  const run = async (sql, ...values) => (await statement(sql)).run(...values);
  return {
    ...createFeedbackStorage(all, run),
    ...createEditorialStorage(all, run),
    ...createEarlyReaderStorage(all, run),
    newsletter: (...values) => run(insertSubscription, ...values),
    reply: (...values) => run(insertReply, ...values),
    close() {
      database?.close();
      database = undefined;
      opening = undefined;
    },
  };
}
