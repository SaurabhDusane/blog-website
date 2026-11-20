import { handleApi, isApiPath } from './api.mjs';
import { loadLocalEnvironment } from './local-environment.mjs';
import { createLocalStorage } from './local-storage.mjs';
import { sendNodeResponse } from './node-http.mjs';

async function readDevCatalog(server) {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('The local post catalog is unavailable');
  const host = address.address === '0.0.0.0' ? '127.0.0.1'
    : address.address === '::' ? '[::1]'
    : address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const response = await fetch(`http://${host}:${address.port}/posts/catalog.json`);
  if (!response.ok) throw new Error('The local post catalog is unavailable');
  return response.json();
}

export function registerNewsletter() {
  return {
    name: 'second-ink-local-forms',
    hooks: {
      'astro:server:setup': ({ server }) => {
        const storage = createLocalStorage();
        const env = loadLocalEnvironment();
        const catalog = () => readDevCatalog(server);
        server.middlewares.use((incoming, outgoing, next) => {
          if (!isApiPath((incoming.url ?? '/').split('?', 1)[0])) {
            next();
            return;
          }
          void sendNodeResponse(incoming, outgoing, (request) => handleApi(request, {
            storage, env, catalog, ip: incoming.socket.remoteAddress,
          }));
        });
        server.httpServer?.once('close', storage.close);
      },
    },
  };
}
