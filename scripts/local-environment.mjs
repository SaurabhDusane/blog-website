import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function loadLocalEnvironment() {
  const dotenv = new URL('../.env', import.meta.url);
  const fileEnv = existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {};
  return { ...fileEnv, ...process.env };
}
