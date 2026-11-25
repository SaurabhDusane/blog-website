interface ReadingEntry {
  postId: string;
  progress: number;
  updatedAt: number;
  anchor?: string;
  completed?: boolean;
}

interface Library {
  saved: string[];
  history: Record<string, ReadingEntry>;
  revisits: Record<string, RevisitNote>;
}

export interface RevisitNote {
  text: string;
  title: string;
  minutes: number;
}

export interface SavedQuote {
  postId: string;
  title: string;
  text: string;
  anchor?: string;
}

export const libraryKey = 'second-ink:library';
export const libraryChangeEvent = 'second-ink:library-change';
export const savedQuotesKey = 'second-ink:quotes';
export const savedQuotesChangeEvent = 'second-ink:quotes-change';
export const libraryFileLimit = 10 * 1024 * 1024;

const emptyLibrary = (): Library => ({ saved: [], history: {}, revisits: {} });
const essayId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let memory: Library = emptyLibrary();
let memoryIsNewer = false;

function normalize(raw: Partial<Library>): Library {
  const saved = Array.isArray(raw.saved)
    ? [...new Set(raw.saved.filter((id) => typeof id === 'string'))]
    : [];
  const history = Object.fromEntries(
    Object.entries(raw.history ?? {})
      .filter(([id, entry]) => (
        entry && entry.postId === id && Number.isFinite(entry.progress) && Number.isFinite(entry.updatedAt)
      ))
      .map(([id, entry]): [string, ReadingEntry] => [
        id,
        { ...entry, completed: (entry.completed === true || entry.progress === 100) || undefined },
      ]),
  );
  const revisits = Object.fromEntries(Object.entries(raw.revisits ?? {}).filter(([id, note]) => (
    essayId.test(id) && saved.includes(id) && typeof note?.text === 'string' && !!note.text.trim() && note.text.length <= 800
    && typeof note.title === 'string' && !!note.title.trim() && note.title.length <= 250
    && Number.isSafeInteger(note.minutes) && note.minutes > 0
  )));
  return { saved, history, revisits };
}

export function readLibrary(): Library {
  if (typeof window === 'undefined') return emptyLibrary();
  if (memoryIsNewer) return memory;

  try {
    const raw = window.localStorage.getItem(libraryKey);
    memory = raw ? normalize(JSON.parse(raw)) : emptyLibrary();
    return memory;
  } catch {
    return memory;
  }
}

function writeLibrary(library: Library) {
  memory = library;
  try {
    window.localStorage.setItem(libraryKey, JSON.stringify(library));
    memoryIsNewer = false;
  } catch {
    // Keep changes usable on this page when storage is blocked.
    memoryIsNewer = true;
  }
  window.dispatchEvent(new Event(libraryChangeEvent));
  return !memoryIsNewer;
}

export function savePost(postId: string, saved?: boolean): boolean {
  if (typeof window === 'undefined') return false;

  const library = readLibrary();
  const isSaved = library.saved.includes(postId);
  const nextSaved = saved ?? !isSaved;
  if (nextSaved === isSaved) return isSaved;

  library.saved = nextSaved
    ? [postId, ...library.saved]
    : library.saved.filter((id) => id !== postId);
  if (!nextSaved) delete library.revisits[postId];
  writeLibrary(library);
  return nextSaved;
}

export function writeRevisit(postId: string, note?: RevisitNote): boolean {
  if (typeof window === 'undefined' || !essayId.test(postId)) return false;
  const library = readLibrary();
  if (note) {
    const text = note.text.trim().slice(0, 800);
    const title = note.title.trim().slice(0, 250);
    if (!text || !title || !Number.isSafeInteger(note.minutes) || note.minutes <= 0) return false;
    library.revisits[postId] = { text, title, minutes: note.minutes };
    if (!library.saved.includes(postId)) library.saved.unshift(postId);
  } else {
    delete library.revisits[postId];
  }
  return writeLibrary(library);
}

export function recordReading(postId: string, progress: number, anchor?: string): void {
  if (typeof window === 'undefined' || !Number.isFinite(progress)) return;

  const library = readLibrary();
  const roundedProgress = Math.round(Math.min(100, Math.max(0, progress)));
  const completed = roundedProgress === 100 || library.history[postId]?.completed === true;
  library.history = {
    ...library.history,
    [postId]: { postId, progress: roundedProgress, updatedAt: Date.now(), anchor, completed: completed || undefined },
  };
  writeLibrary(library);
}

function isSavedQuote(value: unknown): value is SavedQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Partial<SavedQuote>;
  return typeof quote.postId === 'string' && quote.postId.trim() !== ''
    && typeof quote.title === 'string' && quote.title.trim() !== ''
    && typeof quote.text === 'string' && quote.text.trim() !== ''
    && (quote.anchor === undefined || typeof quote.anchor === 'string');
}

function parseQuotes(raw: string | null): SavedQuote[] {
  try {
    const value: unknown = raw && JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isSavedQuote) : [];
  } catch {
    return [];
  }
}

function sameQuote(first: SavedQuote, second: SavedQuote) {
  return first.postId === second.postId && first.anchor === second.anchor && first.text === second.text;
}

export function readSavedQuotes(): SavedQuote[] {
  try {
    return typeof window === 'undefined' ? [] : parseQuotes(window.localStorage.getItem(savedQuotesKey));
  } catch {
    return [];
  }
}

export function saveQuote(quote: SavedQuote): 'saved' | 'duplicate' | 'unavailable' {
  if (typeof window === 'undefined' || !isSavedQuote(quote)) return 'unavailable';

  try {
    const storage = window.localStorage;
    const quotes = parseQuotes(storage.getItem(savedQuotesKey));
    if (quotes.some((existing) => sameQuote(existing, quote))) return 'duplicate';
    storage.setItem(savedQuotesKey, JSON.stringify([quote, ...quotes]));
  } catch {
    return 'unavailable';
  }

  window.dispatchEvent(new Event(savedQuotesChangeEvent));
  return 'saved';
}

export function removeQuote(quote: SavedQuote): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const storage = window.localStorage;
    const quotes = parseQuotes(storage.getItem(savedQuotesKey));
    storage.setItem(savedQuotesKey, JSON.stringify(quotes.filter((existing) => !sameQuote(existing, quote))));
  } catch {
    return false;
  }

  window.dispatchEvent(new Event(savedQuotesChangeEvent));
  return true;
}

const libraryFileFormat = 'second-ink-saved';

export function exportSavedLibrary() {
  return JSON.stringify({ format: libraryFileFormat, version: 1, library: readLibrary(), quotes: readSavedQuotes() }, null, 2);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function decodeSavedLibrary(source: string): { library: Library; quotes: SavedQuote[] } | undefined {
  if (source.length > libraryFileLimit) return;
  let value: unknown;
  try { value = JSON.parse(source); } catch { return; }
  const file = record(value);
  const library = record(file?.library);
  const history = record(library?.history);
  const revisits = record(library?.revisits);
  const saved = library?.saved;
  const quotes = file?.quotes;
  if (file?.format !== libraryFileFormat || file.version !== 1 || !history || !revisits
    || !Array.isArray(saved) || saved.some((id) => typeof id !== 'string' || !essayId.test(id)) || !Array.isArray(quotes)) return;

  const nextHistory: Record<string, ReadingEntry> = Object.create(null);
  for (const [id, value] of Object.entries(history)) {
    const entry = record(value);
    if (!essayId.test(id) || entry?.postId !== id || typeof entry.progress !== 'number'
      || !Number.isFinite(entry.progress) || entry.progress < 0 || entry.progress > 100
      || typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0
      || (entry.anchor !== undefined && typeof entry.anchor !== 'string')
      || (entry.completed !== undefined && typeof entry.completed !== 'boolean')) return;
    nextHistory[id] = { postId: id, progress: entry.progress, updatedAt: entry.updatedAt,
      anchor: entry.anchor, completed: (entry.completed === true || entry.progress === 100) || undefined };
  }

  const nextSaved = new Set<string>(saved);
  const nextRevisits: Record<string, RevisitNote> = Object.create(null);
  for (const [id, value] of Object.entries(revisits)) {
    const note = record(value);
    if (!nextSaved.has(id) || typeof note?.text !== 'string' || !note.text.trim() || note.text.length > 800
      || typeof note.title !== 'string' || !note.title.trim() || note.title.length > 250
      || typeof note.minutes !== 'number' || !Number.isSafeInteger(note.minutes) || note.minutes <= 0) return;
    nextRevisits[id] = { text: note.text, title: note.title, minutes: note.minutes };
  }

  const nextQuotes: SavedQuote[] = [];
  for (const quote of quotes) {
    if (!isSavedQuote(quote) || !essayId.test(quote.postId)) return;
    nextQuotes.push({ postId: quote.postId, title: quote.title, text: quote.text, anchor: quote.anchor });
  }
  return { library: { saved: [...nextSaved], history: nextHistory, revisits: nextRevisits }, quotes: nextQuotes };
}

export function importSavedLibrary(source: string): 'merged' | 'invalid' | 'unavailable' {
  const incoming = decodeSavedLibrary(source);
  if (!incoming) return 'invalid';
  if (typeof window === 'undefined') return 'unavailable';

  const local = readLibrary();
  const history = new Map(Object.entries(local.history));
  for (const [id, entry] of Object.entries(incoming.library.history)) {
    const existing = history.get(id);
    const latest = !existing || existing.updatedAt < entry.updatedAt ? entry : existing;
    history.set(id, { ...latest, completed: (existing?.completed === true || entry.completed === true) || undefined });
  }
  const next: Library = {
    saved: [...new Set([...local.saved, ...incoming.library.saved])],
    history: Object.fromEntries(history),
    revisits: { ...incoming.library.revisits, ...local.revisits },
  };
  const quotes = new Map<string, SavedQuote>();
  for (const quote of [...readSavedQuotes(), ...incoming.quotes]) {
    const key = JSON.stringify([quote.postId, quote.anchor, quote.text]);
    if (!quotes.has(key)) quotes.set(key, quote);
  }

  try {
    const storage = window.localStorage;
    const previous = storage.getItem(libraryKey);
    storage.setItem(libraryKey, JSON.stringify(next));
    try { storage.setItem(savedQuotesKey, JSON.stringify([...quotes.values()])); }
    catch {
      if (previous === null) storage.removeItem(libraryKey);
      else storage.setItem(libraryKey, previous);
      return 'unavailable';
    }
  } catch { return 'unavailable'; }

  memory = next;
  memoryIsNewer = false;
  window.dispatchEvent(new Event(libraryChangeEvent));
  window.dispatchEvent(new Event(savedQuotesChangeEvent));
  return 'merged';
}
