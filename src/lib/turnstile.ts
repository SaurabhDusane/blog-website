interface Turnstile {
  render(container: string, options: {
    sitekey: string;
    execution: 'execute';
    appearance: 'interaction-only';
    action: string;
    callback: (token: string) => void;
    'error-callback': () => void;
    'expired-callback': () => void;
    'timeout-callback': () => void;
  }): string;
  execute(container: string): void;
  remove(widget: string): void;
}

const getTurnstile = () => (window as Window & { turnstile?: Turnstile }).turnstile;
let pending: Promise<Turnstile> | undefined;

function loadTurnstile() {
  const current = getTurnstile();
  if (current) return Promise.resolve(current);
  if (pending) return pending;

  pending = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const limit = window.setTimeout(fail, 12000);

    function fail() {
      window.clearTimeout(limit);
      script.remove();
      pending = undefined;
      reject(new Error('Turnstile script unavailable'));
    }

    script.addEventListener('load', () => {
      const widget = getTurnstile();
      if (!widget) return fail();
      window.clearTimeout(limit);
      resolve(widget);
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  });
  return pending;
}

export async function getFeedbackToken(container: HTMLElement, sitekey: string) {
  const turnstile = await loadTurnstile();
  const selector = `#${CSS.escape(container.id)}`;
  return new Promise<string>((resolve, reject) => {
    let widget: string | undefined;
    let done = false;
    const limit = window.setTimeout(fail, 15000);

    const finish = (token?: string) => {
      if (done) return;
      done = true;
      window.clearTimeout(limit);
      queueMicrotask(() => {
        if (widget) turnstile.remove(widget);
        container.replaceChildren();
      });
      if (token) resolve(token);
      else reject(new Error('Turnstile could not verify the reader'));
    };
    function fail() { finish(); }

    try {
      widget = turnstile.render(selector, {
        sitekey,
        execution: 'execute',
        appearance: 'interaction-only',
        action: 'reader-feedback',
        callback: finish,
        'error-callback': fail,
        'expired-callback': fail,
        'timeout-callback': fail,
      });
      if (!done) turnstile.execute(selector);
    } catch {
      fail();
    }
  });
}
