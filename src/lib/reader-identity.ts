const identityKey = 'second-ink:feedback-reader';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activeIdentity: string | undefined;

export function readReaderStorage(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeReaderStorage(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The current visit can still use its receipt. */ }
}

export function readerIdentity(create = true) {
  const stored = readReaderStorage(identityKey);
  if (stored && uuid.test(stored)) return stored;
  if (!create) return activeIdentity;

  activeIdentity ??= globalThis.crypto?.randomUUID?.();
  if (activeIdentity) writeReaderStorage(identityKey, activeIdentity);
  return activeIdentity;
}
