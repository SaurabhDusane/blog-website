import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function sendNodeResponse(incoming, outgoing, handle) {
  try {
    const path = incoming.url ?? '/';
    if (!path.startsWith('/')) {
      outgoing.writeHead(400).end('Bad request');
      return;
    }

    const origin = new URL(`http://${incoming.headers.host ?? 'localhost'}`).origin;
    const options = { method: incoming.method, headers: incoming.headers };
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      options.body = Readable.toWeb(incoming);
      options.duplex = 'half';
    }
    const request = new Request(origin + path, options);
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));

    if (incoming.method === 'HEAD' || !response.body) {
      outgoing.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch {
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('The desk is briefly closed.');
  }
}
