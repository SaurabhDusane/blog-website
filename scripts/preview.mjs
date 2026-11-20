import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { loadLocalEnvironment } from './local-environment.mjs';
import { createLocalStorage } from './local-storage.mjs';
import { createLocalEditorialMedia } from './local-editorial-media.mjs';
import { sendNodeResponse } from './node-http.mjs';

const entrypoint = new URL('../dist/server/index.js', import.meta.url);
if (!existsSync(entrypoint)) {
  console.error('Run npm run build to prepare the Second Ink preview.');
  process.exit(1);
}

const { values: options } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: process.env.PORT ?? '4321' },
  },
});
const port = Number(options.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Preview needs a port between 0 and 65535.');
  process.exit(1);
}

const { default: worker } = await import(entrypoint);
const storage = createLocalStorage();
const env = loadLocalEnvironment();
const bucket = createLocalEditorialMedia();
const server = createServer((incoming, outgoing) => {
  void sendNodeResponse(incoming, outgoing, (request) => {
    return worker.fetch(request, env, { storage, bucket, ip: incoming.socket.remoteAddress });
  });
});

server.once('close', storage.close);
server.once('error', (error) => {
  console.error(`Could not start the Second Ink preview (${error.code ?? 'server error'}).`);
  process.exitCode = 1;
});
server.listen(port, options.host, () => {
  const address = server.address();
  const hostname = options.host.includes(':') ? `[${options.host}]` : options.host;
  console.log(`Second Ink preview · http://${hostname}:${address.port}/`);
});
