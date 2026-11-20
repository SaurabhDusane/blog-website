const maxChunkLength = 200;

function speechChunks(prose: HTMLElement, language: string): string[] {
  const copy = prose.cloneNode(true) as HTMLElement;
  for (const aside of copy.querySelectorAll("[data-margin-note], [data-margin-note-ref], [hidden], .sr-only, .visually-hidden, script, style")) {
    aside.remove();
  }
  for (const element of copy.querySelectorAll("br, li, td, th")) element.after(document.createTextNode("\n"));

  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(language, { granularity: "sentence" }) : null;
  const chunks: string[] = [];
  for (const block of copy.children) {
    for (const line of (block.textContent ?? "").split("\n")) {
      const plain = line.replace(/\s+/gu, " ").trim();
      if (!plain) continue;
      const sentences = segmenter
        ? Array.from(segmenter.segment(plain), ({ segment }) => segment.trim())
        : plain.split(/(?<=[.!?])\s+/u);
      for (let text of sentences) {
        while (text.length > maxChunkLength) {
          const space = text.lastIndexOf(" ", maxChunkLength);
          const end = space > 0 ? space : [...text].slice(0, maxChunkLength / 2).join("").length;
          chunks.push(text.slice(0, end));
          text = text.slice(end).trimStart();
        }
        if (text) chunks.push(text);
      }
    }
  }
  return chunks;
}

type Playback = "idle" | "playing" | "paused";

export function initReaderListen(reader: HTMLElement, prose: HTMLElement, signal: AbortSignal) {
  const panel = reader.querySelector<HTMLElement>("[data-reader-listen]");
  const play = panel?.querySelector<HTMLButtonElement>("[data-listen-play]");
  const stop = panel?.querySelector<HTMLButtonElement>("[data-listen-stop]");
  const speed = panel?.querySelector<HTMLSelectElement>("[data-listen-rate]");
  const status = panel?.querySelector<HTMLElement>("[data-listen-status]");
  if (!panel || !play || !stop || !speed || !status || !window.speechSynthesis || typeof SpeechSynthesisUtterance !== "function") return;

  const speech = window.speechSynthesis;
  const language = document.documentElement.lang || "en";
  let state: Playback = "idle";
  let chunks: string[] = [];
  let index = 0;
  let offset = 0;
  let active: SpeechSynthesisUtterance | undefined;
  let voice: SpeechSynthesisVoice | undefined;

  function show(next: Playback, message: string) {
    state = next;
    if (play) play.textContent = next === "playing" ? "Pause" : next === "paused" ? "Resume" : "Play";
    if (stop) stop.disabled = next === "idle";
    if (status) status.textContent = message;
  }

  function cancelUtterance() {
    if (!active) return;
    active = undefined;
    speech.cancel();
  }

  function readNext() {
    const chunk = chunks[index];
    if (!chunk) {
      show("idle", "Finished reading.");
      return;
    }

    const start = offset;
    const utterance = new SpeechSynthesisUtterance(chunk.slice(start));
    utterance.lang = language;
    if (voice) utterance.voice = voice;
    utterance.rate = Number(speed?.value ?? 1);
    utterance.onboundary = (event) => {
      if (active === utterance && event.charIndex >= 0 && event.charIndex < utterance.text.length) {
        offset = start + event.charIndex;
      }
    };
    utterance.onend = () => {
      if (active !== utterance) return;
      active = undefined;
      index += 1;
      offset = 0;
      if (state === "playing") readNext();
    };
    utterance.onerror = () => {
      if (active !== utterance) return;
      active = undefined;
      show("idle", "This browser couldn’t finish reading aloud.");
    };
    active = utterance;
    try {
      if (speech.paused) speech.resume();
      speech.speak(utterance);
    } catch {
      active = undefined;
      show("idle", "This browser couldn’t start reading aloud.");
    }
  }

  play.addEventListener("click", () => {
    if (state === "playing") {
      speech.pause();
      show("paused", "Paused.");
      return;
    }
    if (state === "paused") {
      show("playing", "Reading aloud.");
      if (active) speech.resume();
      else readNext();
      return;
    }
    chunks = speechChunks(prose, language);
    if (chunks.length === 0) {
      show("idle", "There’s nothing to read aloud here.");
      return;
    }
    const localVoices = speech.getVoices().filter(({ localService }) => localService);
    const primary = language.toLowerCase().split("-")[0];
    voice = localVoices.find(({ lang }) => lang.toLowerCase() === language.toLowerCase())
      ?? localVoices.find(({ lang }) => lang.toLowerCase().split("-")[0] === primary);
    index = 0;
    offset = 0;
    show("playing", "Reading aloud.");
    readNext();
  }, { signal });

  stop.addEventListener("click", () => {
    cancelUtterance();
    show("idle", "Stopped.");
    play.focus();
  }, { signal });

  speed.addEventListener("change", () => {
    if (state === "idle") return;
    cancelUtterance();
    if (state === "playing") readNext();
  }, { signal });

  function stopForNavigation() {
    cancelUtterance();
    show("idle", "");
  }

  window.addEventListener("pagehide", stopForNavigation, { signal });
  signal.addEventListener("abort", stopForNavigation, { once: true });
  panel.hidden = false;
}
