type ReaderRoute = 'reading' | 'feedback' | 'field-notes' | 'stance' | 'reconsideration' | 'moods' | 'reply' | 'readership'
  | 'newsletter' | 'newsletter-confirm' | 'newsletter-unsubscribe';

const origin = import.meta.env.PUBLIC_READER_API_ORIGIN?.replace(/\/$/, '') ?? '';

export function readerApi(route: ReaderRoute): string {
  return `${origin}/api/${route}/`;
}

export class ReaderApiUnavailable extends Error {}

export function readerApiError(response: Response, data: unknown, fallback: string): Error {
  const issue = data && typeof data === 'object' ? data as { code?: unknown; message?: unknown } : null;
  if ([404, 405, 501].includes(response.status) || issue?.code === 'participation-unconfigured'
    || (response.ok && response.headers.get('Content-Type')?.startsWith('text/html'))) {
    return new ReaderApiUnavailable('Reader responses are unavailable on this site.');
  }
  return new Error(typeof issue?.message === 'string' && issue.message ? issue.message : fallback);
}
