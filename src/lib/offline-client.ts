export interface OfflineEntry {
  id: string;
  title: string;
  savedAt: number;
}

type OfflineMessage =
  | { type: 'offline:list' }
  | { type: 'offline:keep'; id: string; title: string }
  | { type: 'offline:remove'; id: string };

type OfflineResult = { ok: true; entries: OfflineEntry[] } | { ok: false; message: string };

let workerPromise: Promise<ServiceWorker | undefined> | undefined;

export function getOfflineWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) {
    return Promise.resolve(undefined);
  }
  return workerPromise ??= openWorker();
}

async function openWorker() {
  try {
    const service = navigator.serviceWorker;
    if (service.controller?.scriptURL === new URL('/offline-worker.js', location.href).href) {
      return service.controller;
    }
    const registration = await service.register('/offline-worker.js', { scope: '/' });
    if (registration.active) return registration.active;

    return await new Promise<ServiceWorker | undefined>((resolve) => {
      let timer: number;
      const settle = (worker?: ServiceWorker) => {
        window.clearTimeout(timer);
        resolve(worker);
      };
      timer = window.setTimeout(settle, 15_000);
      void service.ready.then(({ active }) => settle(active ?? undefined), () => settle());
    });
  } catch {
    return undefined;
  }
}

export async function askOfflineShelf(message: OfflineMessage): Promise<OfflineResult> {
  const worker = await getOfflineWorker();
  if (!worker) return { ok: false, message: 'This browser can’t open the offline shelf here.' };

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (result: OfflineResult) => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish({
      ok: false,
      message: 'That took longer than expected. Check the shelf or try again.',
    }), 45_000);
    channel.port1.onmessage = (event: MessageEvent<OfflineResult>) => finish(event.data);
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      finish({ ok: false, message: 'The offline shelf couldn’t open just now.' });
    }
  });
}

export function onOfflineChange(update: () => void) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'second-ink:offline-changed') update();
  });
}
