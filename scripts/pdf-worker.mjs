import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { AnnotationMode, getDocument, ImageKind, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

const pdfjsRoot = new URL('.', import.meta.resolve('pdfjs-dist/package.json'));
const maxPages = 180;
const maxCharacters = 800_000;
const maxTextItems = 80_000;
const maxImagePixels = 10_000_000;
const maxDocumentPixels = 64_000_000;
const maxImages = 48;
const maxImageBytes = 24 * 1024 * 1024;

class ConversionError extends Error {}

function escape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function median(values, fallback) {
  if (!values.length) return fallback;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

async function readText(page, budget) {
  const viewport = page.getViewport({ scale: 1 });
  const parts = [];
  let vertical = 0;
  let rtl = 0;
  for await (const chunk of page.streamTextContent()) {
    for (const item of chunk.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      budget.characters += item.str.length;
      budget.items += 1;
      if (budget.characters > maxCharacters || budget.items > maxTextItems) {
        throw new ConversionError('The PDF has too much text to convert in one post. Split it into smaller files.');
      }
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const size = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.height);
      const width = Math.abs(item.width);
      if (![x, y, size, width].every(Number.isFinite) || size <= 0) continue;
      parts.push({ text: item.str, x, y, width, size, font: item.fontName });
      if (item.dir === 'ttb') vertical += 1;
      if (item.dir === 'rtl') rtl += 1;
    }
  }

  if (vertical > parts.length / 4 || page.rotate % 180 !== 0) {
    // Preserve source order when the horizontal line heuristic cannot apply.
    return {
      lines: parts.map(({ text, x, y, size, font }) => ({ text, x, y, size, font, separate: true })),
      complex: true,
    };
  }
  return arrangeLines(parts, rtl > parts.length / 2, viewport.width);
}

function makeLine(parts, rtl, separate = false) {
  const biggest = parts.reduce((first, item) => first.size >= item.size ? first : item);
  let text = parts[0].text;
  for (let index = 1; index < parts.length; index += 1) {
    const prior = parts[index - 1];
    const part = parts[index];
    const gap = rtl ? prior.x - part.x - part.width : part.x - prior.x - prior.width;
    if (gap > Math.min(prior.size, part.size) * 0.13 && !/\s$/.test(text) && !/^\s/.test(part.text)) text += ' ';
    text += part.text;
  }
  return {
    text: text.replace(/\s+/gu, ' ').trim(),
    x: parts.reduce((left, part) => Math.min(left, part.x), Infinity),
    y: parts[0].y,
    end: parts.reduce((right, part) => Math.max(right, part.x + part.width), -Infinity),
    size: biggest.size,
    font: biggest.font,
    separate,
  };
}

function hasOverlappingColumns(rows, gutter) {
  const left = [];
  const right = [];
  for (const row of rows) {
    for (const line of row) {
      if (line.end <= gutter && line.text.length >= 12) left.push(line);
      if (line.x >= gutter && line.text.length >= 12) right.push(line);
    }
  }
  if (left.length < 4 || right.length < 4) return false;
  const commonStart = Math.max(left[0].y, right[0].y);
  const commonEnd = Math.min(left.at(-1).y, right.at(-1).y);
  return commonEnd - commonStart > median(left.map(({ size }) => size), 12) * 3;
}

function arrangeLines(parts, rtl, pageWidth) {
  const rows = [];
  for (const part of parts.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const current = rows.at(-1);
    const tolerance = Math.max(1.7, Math.min(3, part.size * 0.2));
    if (current && Math.abs(current.y - part.y) <= tolerance) current.parts.push(part);
    else rows.push({ y: part.y, parts: [part] });
  }

  const linesByRow = rows.map(({ parts }) => {
    const row = [];
    let group = [];
    for (const part of parts.sort((a, b) => a.x - b.x)) {
      const prior = group.at(-1);
      if (prior && part.x - prior.x - prior.width > Math.max(24, Math.min(prior.size, part.size) * 2.7)) {
        row.push(makeLine(rtl ? group.reverse() : group, rtl));
        group = [];
      }
      group.push(part);
    }
    row.push(makeLine(rtl ? group.reverse() : group, rtl));
    return row;
  });
  const wideRows = linesByRow.filter((row) => row.length > 2).length;
  const splitRows = linesByRow.filter((row) => row.length === 2);
  const gutters = splitRows
    .map(([left, right]) => (left.end + right.x) / 2)
    .filter((x) => x > pageWidth * 0.26 && x < pageWidth * 0.74);
  const gutter = median(gutters, pageWidth / 2);
  const isTable = wideRows >= 3;
  const columns = !isTable && (gutters.length >= 3 && linesByRow.length >= 5 || hasOverlappingColumns(linesByRow, gutter));
  const lines = [];

  if (columns) {
    const left = [];
    const right = [];
    function finishColumns() {
      for (const column of rtl ? [right, left] : [left, right]) {
        if (column.length) column[0].separate = true;
        for (const line of column) lines.push(line);
        column.length = 0;
      }
    }
    for (const row of linesByRow) {
      if (row.some(({ x, end }) => x < gutter && end > gutter)) {
        finishColumns();
        for (const line of rtl ? [...row].reverse() : row) lines.push({ ...line, separate: true });
      } else {
        for (const line of row) (line.x < gutter ? left : right).push(line);
      }
    }
    finishColumns();
  } else {
    for (const row of linesByRow) {
      if (rtl) row.reverse();
      if (row.length === 1) lines.push(row[0]);
      else lines.push({ ...row[0], text: row.map(({ text }) => text).join(' · '), separate: true });
    }
  }
  return { lines, complex: columns || isTable || splitRows.length >= 3 };
}

function isBold(page, fontName) {
  if (!page.commonObjs.has(fontName)) return false;
  const font = page.commonObjs.get(fontName);
  return Boolean(font?.bold || font?.black || /bold|semi.?bold|demi|heavy|black/i.test(font?.name ?? ''));
}

function renderText(lines, page, firstPageWithText) {
  const substantial = lines.filter(({ text }) => text.length >= 24);
  const bodySize = median((substantial.length >= 3 ? substantial : lines).map(({ size }) => size), 12);
  const distances = lines.slice(1).map(({ y }, index) => y - lines[index].y)
    .filter((value) => value >= bodySize * 0.65 && value <= bodySize * 1.85);
  const leading = median(distances, bodySize * 1.15);
  const output = [];
  let paragraph = [];

  function finishParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.reduce((before, line) => before.endsWith('\u00ad')
      ? before.slice(0, -1) + line
      : before.endsWith('-') && /^\p{Ll}/u.test(line) ? before + line : before + ' ' + line);
    output.push('<p>' + escape(text) + '</p>');
    paragraph = [];
  }

  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1];
    const next = lines[index + 1];
    const prominent = line.size >= bodySize * 1.22;
    const isolated = !previous || !next || line.y - previous.y > leading * 1.2 || next.y - line.y > leading * 1.2;
    if (line.text.length <= 160 && /\p{L}/u.test(line.text)
      && (prominent || (line.text.length <= 90 && isolated && isBold(page, line.font)))) {
      finishParagraph();
      const depth = firstPageWithText && index === 0 && prominent ? 1 : line.size < bodySize * 1.32 ? 3 : 2;
      output.push(`<h${depth}>${escape(line.text)}</h${depth}>`);
    } else {
      const gap = previous && line.y - previous.y;
      if (line.separate || (previous && (gap < 0 || gap > leading * 1.55 || line.x - previous.x > bodySize * 1.25))) {
        finishParagraph();
      }
      paragraph.push(line.text);
    }
  }
  finishParagraph();
  return output;
}

function getImage(page, name) {
  if (typeof name !== 'string') return name;
  const store = name.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => store.get(name, resolve));
}

function imagePixels({ data, width, height, kind }) {
  if (!data || !ArrayBuffer.isView(data)) return undefined;
  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (kind === ImageKind.GRAYSCALE_1BPP) {
    const stride = Math.ceil(width / 8);
    if (pixels.length < stride * height) return undefined;
    const gray = Buffer.allocUnsafe(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        gray[y * width + x] = pixels[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
      }
    }
    return { pixels: gray, channels: 1 };
  }
  const channels = kind === ImageKind.RGB_24BPP ? 3 : kind === ImageKind.RGBA_32BPP ? 4 : 0;
  if (channels && pixels.length === width * height * channels) return { pixels, channels };
  return undefined;
}

async function readImages(page, operators, imageState) {
  const output = [];
  const seen = new Set();
  for (const [index, operation] of operators.fnArray.entries()) {
    if (operation === OPS.paintInlineImageXObjectGroup) {
      imageState.omitted = true;
      continue;
    }
    if (![OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject].includes(operation)) continue;
    const [source] = operators.argsArray[index] ?? [];
    if (seen.has(source) || imageState.sharedImages.has(source)) continue;
    if (imageState.examined >= maxImages || imageState.bytes >= maxImageBytes) {
      imageState.omitted = true;
      break;
    }
    seen.add(source);
    if (typeof source === 'string' && source.startsWith('g_')) imageState.sharedImages.add(source);
    imageState.examined += 1;
    try {
      const image = await getImage(page, source);
      const { width, height } = image ?? {};
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || pixels > maxImagePixels
        || imageState.pixels + pixels > maxDocumentPixels) {
        imageState.omitted = true;
        continue;
      }
      imageState.pixels += pixels;
      const raw = imagePixels(image);
      if (!raw) {
        imageState.omitted = true;
        continue;
      }
      const { data, info } = await sharp(raw.pixels, { raw: { width, height, channels: raw.channels }, limitInputPixels: maxImagePixels })
        .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 77 }).toBuffer({ resolveWithObject: true });
      const name = createHash('sha256').update(data).digest('hex').slice(0, 24) + '.webp';
      if (imageState.images.has(name)) continue;
      if (imageState.bytes + data.length > maxImageBytes) {
        imageState.omitted = true;
        break;
      }
      const alt = `Illustration from PDF page ${page.pageNumber}`;
      const attrs = { src: '/word-images/' + name, alt, width: info.width, height: info.height };
      imageState.images.set(name, data);
      imageState.bytes += data.length;
      imageState.cover ??= attrs;
      output.push(`<p><img src="${attrs.src}" alt="${alt}" width="${info.width}" height="${info.height}" loading="lazy" decoding="async"></p>`);
    } catch {
      imageState.omitted = true;
    }
  }
  return output;
}

async function parsePdf() {
  const folder = (name) => fileURLToPath(new URL(name + '/', pdfjsRoot)).replaceAll('\\', '/');
  const task = getDocument({
    data: workerData,
    disableFontFace: true,
    fontExtraProperties: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    maxImageSize: maxImagePixels,
    canvasMaxAreaInBytes: maxImagePixels * 4,
    cMapUrl: folder('cmaps'),
    standardFontDataUrl: folder('standard_fonts'),
    wasmUrl: folder('wasm'),
    verbosity: VerbosityLevel.ERRORS,
  });

  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) throw new ConversionError(`The PDF has more than ${maxPages} pages. Split it into smaller files.`);
    const budget = { characters: 0, items: 0 };
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const result = await readText(page, budget);
      pages.push({ ...result, page });
      page.cleanup();
    }
    const first = pages.find(({ lines }) => lines.some(({ text }) => /[\p{L}\p{N}]/u.test(text)));
    if (!first) throw new ConversionError('The PDF has no readable text. Upload a text PDF or run OCR before uploading.');

    const html = [];
    const warnings = [];
    const imageState = { images: new Map(), sharedImages: new Set(), examined: 0, bytes: 0, pixels: 0, omitted: false };
    let complex = pages.some((page) => page.complex);
    let emptyPages = 0;
    for (const entry of pages) {
      const { page, lines } = entry;
      if (!lines.length) emptyPages += 1;
      let operators;
      try {
        operators = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
      } catch {
        imageState.omitted = true;
      }
      for (const element of renderText(lines, page, entry === first)) html.push(element);
      if (operators) {
        for (const element of await readImages(page, operators, imageState)) html.push(element);
      }
      page.cleanup();
    }
    if (emptyPages) {
      complex = true;
      warnings.push(`${emptyPages} ${emptyPages === 1 ? 'page has' : 'pages have'} no extractable text. The original PDF includes those pages.`);
    }
    if (imageState.omitted) {
      complex = true;
      warnings.push('Some illustrations could not be extracted. The original PDF includes them.');
    }
    if (complex) warnings.push('The layout is complex. The original PDF is included alongside the extracted text.');
    return {
      html: html.join('\n'),
      firstLine: first.lines.find(({ text }) => /[\p{L}\p{N}]/u.test(text)).text,
      warnings,
      images: imageState.images,
      complex,
      cover: imageState.cover,
    };
  } finally {
    await task.destroy();
  }
}

try {
  parentPort.postMessage({ value: await parsePdf() });
} catch (error) {
  let message = 'The PDF could not be read. Re-export it from its original document.';
  if (error instanceof ConversionError) message = error.message;
  if (error.name === 'PasswordException') message = 'The PDF is password protected. Upload an unlocked copy.';
  parentPort.postMessage({ error: message });
}
