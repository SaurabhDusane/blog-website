interface QuoteImageSource {
  text: string;
  title: string;
  url?: string;
}

const paper = "#f6f0e4";
const ink = "#1d2433";
const blue = "#2345a2";
const red = "#b83a26";
const bodyFont = '"Source Serif 4", Georgia, serif';
const displayFont = '"Instrument Serif", Georgia, serif';
const interfaceFont = '"IBM Plex Sans", system-ui, sans-serif';

function wrapText(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const part of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${part}` : part;
    if (context.measureText(candidate).width <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (context.measureText(part).width <= width) {
      line = part;
      continue;
    }
    line = "";
    for (const character of part) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderImage({ text, title, url }: QuoteImageSource) {
  if (document.fonts) {
    await Promise.allSettled([
      document.fonts.load('56px "Instrument Serif"'),
      document.fonts.load('52px "Source Serif 4"', text),
      document.fonts.load('600 26px "IBM Plex Sans"', title),
    ]);
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  const width = 1080;
  const x = 104;
  const quoteX = 128;
  const textWidth = width - quoteX - x;
  context.font = `52px ${bodyFont}`;
  const quote = wrapText(context, `“${text}”`, textWidth);
  context.font = `600 28px ${interfaceFont}`;
  const source = wrapText(context, title, textWidth);
  const lineHeight = 72;
  const height = Math.max(930, 394 + lineHeight * quote.length + 37 * source.length);
  canvas.width = width;
  canvas.height = height;
  context.textBaseline = "top";

  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = blue;
  context.fillRect(x, 175, width - 2 * x, 3);
  context.fillRect(x, 230, 4, height - 460);
  context.fillStyle = red;
  context.fillRect(x, 76, 17, 3);
  context.fillRect(x + 7, 69, 3, 17);

  context.font = `56px ${displayFont}`;
  context.fillStyle = ink;
  context.fillText("Second Ink", x + 32, 86);

  const start = Math.max(232, Math.round((height - lineHeight * quote.length - 37 * source.length) / 2 - 2));
  context.font = `52px ${bodyFont}`;
  quote.forEach((line, index) => context.fillText(line, quoteX, start + index * lineHeight));

  context.fillStyle = blue;
  context.font = `600 28px ${interfaceFont}`;
  source.forEach((line, index) => context.fillText(line, quoteX, start + quote.length * lineHeight + 39 + index * 37));

  if (url) {
    context.fillStyle = ink;
    context.font = `24px ${interfaceFont}`;
    context.fillText(new URL(url).hostname, x, height - 93, width - 2 * x);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((output) => {
      if (output) resolve(output);
      else reject(new Error("PNG is unavailable"));
    }, "image/png");
  });
  return { blob, width, height };
}

export function createQuoteImageDialog(dialog: HTMLDialogElement | null, signal?: AbortSignal) {
  const picture = dialog?.querySelector<HTMLImageElement>("[data-quote-image-preview]");
  const download = dialog?.querySelector<HTMLButtonElement>("[data-quote-image-download]");
  const share = dialog?.querySelector<HTMLButtonElement>("[data-quote-image-share]");
  const actions = dialog?.querySelector<HTMLElement>("[data-quote-image-actions]");
  const status = dialog?.querySelector<HTMLElement>("[data-quote-image-status]");
  if (!dialog || typeof dialog.showModal !== "function" || !picture || !download || !share || !actions || !status) return;

  let objectUrl: string | undefined;
  let filename: string | undefined;
  let version = 0;
  let shareData: ShareData | undefined;
  let returnFocus: HTMLElement | undefined;

  const clearImage = () => {
    version += 1;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    filename = undefined;
    shareData = undefined;
    picture.hidden = true;
    picture.removeAttribute("src");
    picture.alt = "";
    share.hidden = true;
    share.disabled = false;
    actions.hidden = true;
  };

  dialog.addEventListener("close", () => {
    clearImage();
    returnFocus?.focus({ preventScroll: true });
    returnFocus = undefined;
  }, { signal });
  signal?.addEventListener("abort", clearImage, { once: true });

  download.addEventListener("click", () => {
    if (!objectUrl || !filename) return;
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
  }, { signal });

  share.addEventListener("click", async () => {
    if (!shareData) return;
    const current = version;
    share.disabled = true;
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (version === current && !(error instanceof DOMException && error.name === "AbortError")) {
        status.textContent = "This browser couldn’t share the image. You can download it instead.";
      }
    } finally {
      if (version === current) share.disabled = false;
    }
  }, { signal });

  return async (source: QuoteImageSource, focusAfter?: HTMLElement) => {
    clearImage();
    const current = version;
    returnFocus = focusAfter;
    status.textContent = "Making the image…";
    if (!dialog.open) dialog.showModal();
    try {
      const { blob, width, height } = await renderImage(source);
      if (version !== current || !dialog.open) return;
      objectUrl = URL.createObjectURL(blob);
      const stem = source.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      filename = `second-ink-${stem || "quote"}.png`;
      picture.src = objectUrl;
      picture.width = width;
      picture.height = height;
      picture.alt = `“${source.text}” — ${source.title}`;
      picture.hidden = false;
      actions.hidden = false;
      status.textContent = "";

      if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && typeof File === "function") {
        try {
          const files = [new File([blob], filename, { type: "image/png" })];
          if (navigator.canShare({ files })) {
            shareData = { files, title: source.title, url: source.url };
            share.hidden = false;
          }
        } catch {
          // The download remains available when file sharing is restricted.
        }
      }
    } catch {
      if (version === current) status.textContent = "This browser couldn’t make the image. You can still copy the quote.";
    }
  };
}
