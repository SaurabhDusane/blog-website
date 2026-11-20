import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createLocalEditorialMedia(directory = fileURLToPath(new URL('../.data/editorial-media/', import.meta.url))) {
  function filename(key) {
    if (!/^(audio|document)\/[a-f0-9]{64}\.[a-z0-9]+$/.test(key)) throw new Error('Invalid local editorial media key');
    return join(directory, key);
  }
  async function read(operation, key) {
    try { return await operation(filename(key)); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  return {
    head: (key) => read(stat, key),
    async get(key, options) {
      const bytes = await read(readFile, key);
      const range = options?.range;
      return bytes && { body: range ? bytes.subarray(range.offset, range.offset + range.length) : bytes };
    },
    async put(key, bytes) {
      const path = filename(key);
      await mkdir(dirname(path), { recursive: true });
      try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    },
  };
}
