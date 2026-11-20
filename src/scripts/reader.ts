import { readLibrary, recordReading, savePost, saveQuote, libraryChangeEvent, libraryKey } from "../lib/reader-state";
import { track } from "../lib/analytics";
import { copyText } from "../lib/clipboard";
import { createQuoteImageDialog } from "../lib/quote-image";
import { passageAnchor, passageTags } from "../lib/article-passages";
import { initReaderListen } from "./reader-listen";

const themeKey = "second-ink:theme";
const sizeKey = "second-ink:reader-size";
const marginsKey = "second-ink:margins";
const textSizes = ["small", "regular", "large", "extra-large"] as const;
const themes = ["light", "dark", "sepia"] as const;
const wideReader = "(min-width: 55rem)";
const passageSelector = passageTags.join(", ");

type TextSize = (typeof textSizes)[number];
type Theme = (typeof themes)[number];
type ThemePreference = Theme | "auto";
type Quote = { text: string; anchor?: string };
type ReadingPosition = { progress: number; anchor?: string };

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // In private or storage-restricted contexts, controls stay available this visit.
  }
}

function knownTheme(value: string | null | undefined): Theme | undefined {
  return themes.find((theme) => theme === value);
}

function getReadingLine() {
  return Math.min(window.innerHeight * 0.33, 250);
}

function textPreview(text: string, limit: number) {
  if (text.length <= limit) return text;
  const boundary = text.lastIndexOf(" ", limit);
  return `${text.slice(0, boundary > 0 ? boundary : limit).trimEnd()}…`;
}

export function initReader() {
  const reader = document.querySelector<HTMLElement>("[data-reader]");
  if (!reader || reader.dataset.readerReady !== undefined) return;

  const postId = reader.dataset.postId;
  const title = reader.dataset.postTitle;
  const prose = reader.querySelector<HTMLElement>("[data-reader-prose]");
  if (!postId || !title || !prose) return;

  const initialHistory = readLibrary().history[postId];
  const resume = reader.querySelector<HTMLElement>("[data-reader-resume]");
  const resumeLabel = resume?.querySelector<HTMLElement>("[data-reader-resume-label]");
  if (resume && resumeLabel && initialHistory?.progress > 0 && initialHistory.progress < 100) {
    resumeLabel.textContent = `Pick up at ${initialHistory.progress}%`;
    resume.hidden = false;
  }
  if (reader.querySelector<HTMLElement>("[data-reader-take]")?.hidden) return;

  setupReader(reader, prose, postId, title, initialHistory);
}

function setupReader(reader: HTMLElement, prose: HTMLElement, postId: string, title: string, initialHistory?: ReadingPosition) {
  reader.dataset.readerReady = "";
  const controller = new AbortController();
  const { signal } = controller;
  const view = window.matchMedia(wideReader);
  const passages = Array.from(prose.children).filter(
    (item): item is HTMLElement => item instanceof HTMLElement && item.matches(passageSelector),
  );
  const notes = Array.from(prose.querySelectorAll<HTMLElement>(":scope > [data-margin-note]"));
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const noteReferences = new Map<HTMLAnchorElement, HTMLElement>();
  for (const reference of prose.querySelectorAll<HTMLAnchorElement>("[data-margin-note-ref]")) {
    const note = notesById.get(reference.hash.slice(1));
    if (!note) continue;
    reference.setAttribute("aria-controls", note.id);
    noteReferences.set(reference, note);
  }

  for (const [index, passage] of passages.entries()) {
    passage.id ||= passageAnchor(index);
    passage.dataset.readerPassage = "";
  }

  const progressBar = reader.querySelector<HTMLElement>("[data-reader-progress]");
  const progressFill = reader.querySelector<HTMLElement>("[data-reader-progress-fill]");
  const controls = reader.querySelector<HTMLElement>("[data-reader-controls]");
  const participation = reader.querySelectorAll<HTMLElement>("[data-reader-participation]");
  const resume = reader.querySelector<HTMLAnchorElement>("[data-reader-resume-link]");
  const selectionTools = reader.querySelector<HTMLElement>("[data-reader-selection]");
  const settings = reader.querySelector<HTMLDetailsElement>("[data-reader-settings]");
  const status = reader.querySelector<HTMLElement>("[data-reader-status]");
  const quotePicker = reader.querySelector<HTMLDetailsElement>("[data-reader-quote-picker]");
  const quoteChoice = reader.querySelector<HTMLSelectElement>("[data-reader-quote-choice]");
  const copyDialog = reader.querySelector<HTMLDialogElement>("[data-copy-dialog]");
  const makeQuoteImage = createQuoteImageDialog(reader.querySelector<HTMLDialogElement>("[data-quote-image-dialog]"), signal);
  const replyForm = reader.querySelector<HTMLFormElement>("[data-reader-reply-form]");
  const replyStatus = reader.querySelector<HTMLElement>("[data-reader-reply-status]");
  const themeButtons = reader.querySelectorAll<HTMLButtonElement>("[data-reader-theme]");
  const sizeButtons = reader.querySelectorAll<HTMLButtonElement>("[data-reader-size]");
  const getAction = (action: string) =>
    reader.querySelector<HTMLButtonElement>(`[data-reader-action="${action}"]`);
  const saveButton = getAction("save");
  const marginButton = getAction("margins");
  const quietButton = getAction("quiet");
  let previousPosition: ReadingPosition | undefined = initialHistory;
  let hasEnteredArticle = false;
  let selectedQuote: Quote | undefined;
  let selectedQuoteSignature: string | undefined;
  let statusTimeout = 0;
  let layoutFrame = 0;
  let scrollFrame = 0;
  let saveTimeout = 0;

  const quotes: Quote[] = passages
    .filter((passage) => passage.matches("p, blockquote"))
    .map((passage) => ({
      text: textPreview((passage.textContent ?? "").replace(/\s+/g, " ").trim(), 240),
      anchor: passage.id,
    }))
    .filter((quote) => quote.text.length >= 32);

  if (quoteChoice) {
    quoteChoice.replaceChildren(...quotes.map((quote, index) => new Option(textPreview(quote.text, 98), String(index))));
  }
  const shareButton = getAction("share-quote");
  if (shareButton && typeof navigator.share === "function") shareButton.hidden = false;
  if (makeQuoteImage) {
    for (const action of ["image-selection", "image-quote"]) {
      const imageButton = getAction(action);
      if (imageButton) imageButton.hidden = false;
    }
  }
  if (marginButton) {
    marginButton.hidden = notes.length === 0;
    if (notes.length) marginButton.setAttribute("aria-controls", notes.map((note) => note.id).join(" "));
  }

  function announce(message: string) {
    if (!status) return;
    window.clearTimeout(statusTimeout);
    status.textContent = message;
    statusTimeout = window.setTimeout(() => {
      status.textContent = "";
    }, 4500);
  }

  function applyTheme(value: ThemePreference) {
    const root = document.documentElement;
    root.dataset.theme = value === "auto" ? knownTheme(root.dataset.defaultTheme) ?? "light" : value;
    for (const button of themeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.readerTheme === value));
    }
  }

  function applySize(value: TextSize) {
    reader.dataset.size = value;
    for (const button of sizeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.readerSize === value));
    }
  }

  function noteIsOpen(note: HTMLElement) {
    return !reader.hasAttribute("data-quiet") && !note.hasAttribute("data-note-closed")
      && (reader.dataset.margins === "open" || note.hasAttribute("data-note-open"));
  }

  function syncNoteReferences() {
    for (const [reference, note] of noteReferences) {
      reference.setAttribute("aria-expanded", String(noteIsOpen(note)));
    }
  }

  function setNoteOpen(note: HTMLElement, open: boolean) {
    note.toggleAttribute("data-note-open", open);
    note.toggleAttribute("data-note-closed", !open);
    syncNoteReferences();
  }

  function applyMargins(open: boolean) {
    reader.dataset.margins = open ? "open" : "closed";
    for (const note of notes) {
      note.removeAttribute("data-note-open");
      note.removeAttribute("data-note-closed");
    }
    syncNoteReferences();
    if (!marginButton) return;
    marginButton.setAttribute("aria-expanded", String(open));
    marginButton.textContent = open ? "Close the margins" : "Open the margins";
  }

  function applyQuiet(active: boolean) {
    reader.toggleAttribute("data-quiet", active);
    document.documentElement.toggleAttribute("data-quiet-reading", active);
    quietButton?.setAttribute("aria-pressed", String(active));
    syncNoteReferences();
  }

  function syncSave() {
    const saved = readLibrary().saved.includes(postId);
    saveButton?.setAttribute("aria-pressed", String(saved));
  }

  function layoutMargins() {
    const openNotes = view.matches ? notes.filter(noteIsOpen) : [];
    const hasRail = openNotes.length > 0;
    reader.toggleAttribute("data-margin-rail", hasRail);
    if (!hasRail) return;

    const origin = prose.getBoundingClientRect().top;
    let nextY = 0;
    for (const note of openNotes) {
      let anchor = note.previousElementSibling;
      while (anchor?.matches("[data-margin-note]")) anchor = anchor.previousElementSibling;
      const preferredY = anchor ? anchor.getBoundingClientRect().top - origin : 0;
      const offset = Math.round(Math.max(preferredY, nextY));
      note.style.setProperty("--reader-note-offset", `${offset}px`);
      nextY = offset + note.offsetHeight + 19;
    }
    prose.style.setProperty("--reader-prose-min-height", `${nextY}px`);
  }

  function currentPassage() {
    const line = getReadingLine();
    return passages.findLast((passage) => passage.getBoundingClientRect().top <= line);
  }

  function updateLayout(change: () => void) {
    const passage = currentPassage();
    const before = passage?.getBoundingClientRect().top;
    change();
    layoutMargins();
    if (passage && before !== undefined) {
      const shift = passage.getBoundingClientRect().top - before;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: "instant" });
    }
    scheduleProgress();
  }

  function getPosition(): ReadingPosition {
    const first = passages[0];
    const last = passages.at(-1);
    if (!first || !last) return { progress: 0 };
    const top = first.getBoundingClientRect().top;
    const ending = last.getBoundingClientRect().bottom;
    const atPageEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (atPageEnd && ending > 0 && ending <= window.innerHeight) {
      return { progress: 100, anchor: last.id };
    }
    const distance = Math.max(ending - top, 1);
    const progress = Math.round(Math.min(100, Math.max(0, (getReadingLine() - top) / distance * 100)));
    return { progress, anchor: currentPassage()?.id };
  }

  function storeProgress() {
    window.clearTimeout(saveTimeout);
    saveTimeout = 0;
    if (!hasEnteredArticle) return;
    const { progress, anchor } = getPosition();
    if (previousPosition?.progress === progress && previousPosition.anchor === anchor) return;
    recordReading(postId, progress, anchor);
    previousPosition = { progress, anchor };
  }

  function updateProgress() {
    const { progress } = getPosition();
    progressBar?.setAttribute("aria-valuenow", String(progress));
    if (progressFill) progressFill.style.transform = `scaleX(${progress / 100})`;

    if (progress <= 0 && initialHistory?.progress) return;
    if (passages[0]?.getBoundingClientRect().top <= window.innerHeight * 0.65) {
      hasEnteredArticle = true;
    }
    if (hasEnteredArticle && !saveTimeout) saveTimeout = window.setTimeout(storeProgress, 750);
  }

  function scheduleProgress() {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      updateProgress();
    });
  }

  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      layoutMargins();
      scheduleProgress();
    });
  }

  function findAnchor(id: string) {
    const target = document.getElementById(id);
    return target && (prose.contains(target) || (reader.contains(target) && target.hasAttribute('data-annotated-source')))
      ? target : undefined;
  }

  function scrollToPassage(target: HTMLElement, focus = false) {
    const margin = Math.max(getReadingLine(), (controls?.offsetHeight ?? 0) + 16);
    window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - margin), behavior: "instant" });
    if (focus) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  function resumeReading(focus = false) {
    if (!initialHistory) return;
    const target = initialHistory.anchor ? findAnchor(initialHistory.anchor) : undefined;
    if (target) {
      scrollToPassage(target, focus);
    } else {
      const first = passages[0];
      const last = passages.at(-1);
      if (first && last) {
        const top = first.getBoundingClientRect().top;
        const offset = (last.getBoundingClientRect().bottom - top) * initialHistory.progress / 100;
        window.scrollTo({ top: Math.max(0, window.scrollY + top + offset - getReadingLine()), behavior: "instant" });
      }
    }
    scheduleProgress();
  }

  function quoteUrl(anchor?: string) {
    const url = new URL(window.location.pathname, window.location.origin);
    if (anchor) url.hash = anchor;
    return url.toString();
  }

  function updateSelection() {
    if (!selectionTools) return;
    const selection = window.getSelection();
    const current = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const node = range?.startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    const passage = element?.closest<HTMLElement>("[data-reader-passage]");
    if (current.length < 6 || !passage || !range || !prose.contains(range.endContainer)) {
      if (selectionTools.contains(document.activeElement)) return;
      selectionTools.hidden = true;
      selectedQuote = undefined;
      selectedQuoteSignature = undefined;
      return;
    }
    const nextQuote = { text: textPreview(current, 500), anchor: passage.id };
    const signature = `${nextQuote.anchor}:${nextQuote.text}`;
    if (signature === selectedQuoteSignature) return;
    selectedQuote = nextQuote;
    selectedQuoteSignature = signature;
    selectionTools.hidden = false;
  }

  async function shareQuote(quote: Quote, native: boolean) {
    const url = quoteUrl(quote.anchor);
    const summary = `“${quote.text}”\n— ${title}`;
    if (native) {
      try {
        await navigator.share({ title, text: summary, url });
        track("share_quote", { postId, method: "share" });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    if (await copyText(`${summary}\n${url}`, copyDialog)) announce("Quote and link copied.");
    track("share_quote", { postId, method: "copy" });
  }

  function keepQuote(quote: Quote) {
    const result = saveQuote({ ...quote, postId, title });
    if (result === "unavailable") {
      announce("This browser couldn’t save your quote. You can still copy it.");
      return false;
    }
    announce(result === "saved" ? "Quote added to Saved." : "This quote is already in Saved.");
    return true;
  }

  function dismissSelection() {
    if (selectionTools) selectionTools.hidden = true;
    selectedQuote = undefined;
  }

  const actions: Record<string, () => void> = {
    save: () => {
      const saved = savePost(postId);
      syncSave();
      announce(saved ? "Essay tucked into your library." : "Essay removed from your library.");
      track("save_post", { postId, saved });
    },
    quiet: () => updateLayout(() => applyQuiet(!reader.hasAttribute("data-quiet"))),
    margins: () => updateLayout(() => {
      const nextOpen = reader.dataset.margins === "closed";
      applyMargins(nextOpen);
      writePreference(marginsKey, nextOpen ? "open" : "closed");
      if (nextOpen) track("open_margins", { postId });
    }),
    "copy-selection": () => {
      if (selectedQuote) void shareQuote(selectedQuote, false);
      dismissSelection();
    },
    "save-selection": () => {
      if (!selectedQuote || !keepQuote(selectedQuote)) return;
      const focused = selectedQuote.anchor && selectionTools?.contains(document.activeElement)
        ? findAnchor(selectedQuote.anchor)
        : undefined;
      dismissSelection();
      if (focused) {
        focused.tabIndex = -1;
        focused.focus({ preventScroll: true });
      }
    },
    "image-selection": () => {
      if (!selectedQuote || !makeQuoteImage) return;
      const focused = selectedQuote.anchor ? findAnchor(selectedQuote.anchor) : undefined;
      if (focused) focused.tabIndex = -1;
      void makeQuoteImage({ text: selectedQuote.text, title, url: quoteUrl(selectedQuote.anchor) }, focused);
      dismissSelection();
    },
    "dismiss-selection": dismissSelection,
    "save-quote": () => {
      const quote = quotes[Number(quoteChoice?.value)];
      if (quote) keepQuote(quote);
    },
    "copy-quote": () => {
      const quote = quotes[Number(quoteChoice?.value)];
      if (quote) void shareQuote(quote, false);
    },
    "share-quote": () => {
      const quote = quotes[Number(quoteChoice?.value)];
      if (quote) void shareQuote(quote, true);
    },
    "image-quote": () => {
      const quote = quotes[Number(quoteChoice?.value)];
      if (quote && makeQuoteImage) {
        void makeQuoteImage({ text: quote.text, title, url: quoteUrl(quote.anchor) }, getAction("image-quote") ?? undefined);
      }
    },
  };

  reader.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const reference = event.target.closest<HTMLAnchorElement>("[data-margin-note-ref]");
    const note = reference && noteReferences.get(reference);
    if (note && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const open = !noteIsOpen(note);
      updateLayout(() => {
        if (reader.hasAttribute("data-quiet")) applyQuiet(false);
        setNoteOpen(note, open);
      });
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const theme = button.dataset.readerTheme === "auto" ? "auto" : knownTheme(button.dataset.readerTheme);
    const size = button.dataset.readerSize as TextSize;
    if (theme) {
      applyTheme(theme);
      writePreference(themeKey, theme === "auto" ? null : theme);
    } else if (textSizes.includes(size)) {
      updateLayout(() => applySize(size));
      writePreference(sizeKey, size);
    } else {
      actions[button.dataset.readerAction ?? ""]?.();
    }
  }, { signal });

  resume?.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    resumeReading(true);
  }, { signal });

  replyForm?.addEventListener("submit", async (event) => {
    if (!replyStatus) return;
    event.preventDefault();
    const submit = replyForm.querySelector<HTMLButtonElement>('[type="submit"]');
    if (submit) submit.disabled = true;
    replyStatus.textContent = "Sending your reply…";
    const body = new URLSearchParams();
    new FormData(replyForm).forEach((value, key) => {
      if (typeof value === "string") body.append(key, value);
    });

    try {
      const response = await fetch(replyForm.action, { method: "POST", headers: { Accept: "application/json" }, body });
      const result: { ok?: boolean; message?: string } = await response.json();
      if (response.ok && result.ok) replyForm.reset();
      replyStatus.textContent = result.message ?? "Your reply couldn’t go through. It’s still in the box.";
    } catch {
      replyStatus.textContent = "Your reply couldn’t go through. It’s still in the box.";
    } finally {
      if (submit) submit.disabled = false;
    }
  }, { signal });

  selectionTools?.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
  document.addEventListener("selectionchange", updateSelection, { signal });
  document.addEventListener("pointerdown", (event) => {
    if (settings?.open && !settings.contains(event.target as Node)) settings.open = false;
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (settings?.open) {
      settings.open = false;
      settings.querySelector("summary")?.focus();
    }
    dismissSelection();
  }, { signal });
  window.addEventListener("scroll", scheduleProgress, { passive: true, signal });
  window.addEventListener("resize", scheduleLayout, { passive: true, signal });
  window.addEventListener("pagehide", storeProgress, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") storeProgress();
  }, { signal });
  window.addEventListener(libraryChangeEvent, syncSave, { signal });
  window.addEventListener("storage", (event) => {
    if (event.key === libraryKey) syncSave();
    if (event.key === themeKey || event.key === null) applyTheme(knownTheme(readPreference(themeKey)) ?? "auto");
  }, { signal });

  const preferenceSize = readPreference(sizeKey) as TextSize;
  applySize(textSizes.includes(preferenceSize) ? preferenceSize : "regular");
  applyTheme(knownTheme(readPreference(themeKey)) ?? "auto");
  applyMargins(readPreference(marginsKey) === "open");
  if (marginButton) marginButton.hidden = notes.length === 0;
  syncSave();
  if (progressBar) progressBar.hidden = false;
  if (controls) controls.inert = false;
  for (const section of participation) {
    section.hidden = section === quotePicker && quotes.length === 0;
  }
  initReaderListen(reader, prose, signal);
  layoutMargins();

  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(prose);
  for (const note of notes) observer.observe(note);
  void document.fonts?.ready.then(() => {
    if (!signal.aborted) scheduleLayout();
  });

  window.requestAnimationFrame(() => {
    if (signal.aborted) return;
    const rawHash = window.location.hash.slice(1);
    let hash = rawHash;
    try { hash = decodeURIComponent(rawHash); } catch { /* Keep literal anchors usable. */ }
    const anchor = hash ? findAnchor(hash) : undefined;
    if (anchor) {
      if (anchor.matches("[data-margin-note]")) {
        setNoteOpen(anchor, true);
        layoutMargins();
      }
      scrollToPassage(anchor);
    } else if (hash === "reply") {
      const reply = reader.querySelector<HTMLDetailsElement>("#reply");
      if (reply) {
        reply.open = true;
        scrollToPassage(reply);
      }
    } else if (new URLSearchParams(window.location.search).get("resume") === "1") {
      resumeReading();
    }
    updateProgress();
  });

  document.addEventListener("astro:before-swap", () => {
    storeProgress();
    applyQuiet(false);
    observer.disconnect();
    controller.abort();
    window.cancelAnimationFrame(layoutFrame);
    window.cancelAnimationFrame(scrollFrame);
    window.clearTimeout(statusTimeout);
  }, { once: true, signal });
}
