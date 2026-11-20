import { createHash } from 'node:crypto';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { inspectWordContainer, maxFileBytes } from './document-input.mjs';

const mib = 1024 * 1024;
const deadlineMs = 75_000;
const maxImages = 96;
const maxImageBytes = 16 * mib;
const maxInputMediaBytes = 112 * mib;
const maxOutputMediaBytes = 24 * mib;

async function readDocument(buffer) {
  inspectWordContainer(buffer);
  const images = new Map();
  const imageWarnings = new Set();
  let imageCount = 0;
  let inputBytes = 0;
  let outputBytes = 0;

  function omitImage(message) {
    imageWarnings.add(message);
    return [];
  }

  async function convertImage(image) {
    imageCount += 1;
    if (imageCount > maxImages) return omitImage('Images after the first 96 were skipped.');
    if (inputBytes >= maxInputMediaBytes || outputBytes >= maxOutputMediaBytes) {
      return omitImage('Some embedded images were skipped because the document reached its image limit.');
    }

    try {
      const data = await image.readAsBuffer();
      inputBytes += data.byteLength;
      if (inputBytes > maxInputMediaBytes) {
        return omitImage('Some embedded images were skipped because the document reached its image limit.');
      }
      if (data.byteLength > maxImageBytes) {
        return omitImage('One or more embedded images exceeded 16 MiB and were skipped.');
      }

      const { data: webp, info } = await sharp(data, { limitInputPixels: 36_000_000 })
        .rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 77 }).timeout({ seconds: 8 }).toBuffer({ resolveWithObject: true });
      const name = createHash('sha256').update(webp).digest('hex').slice(0, 24) + '.webp';
      if (!images.has(name)) {
        if (outputBytes + webp.byteLength > maxOutputMediaBytes) {
          return omitImage('Some embedded images were skipped because the document reached its image limit.');
        }
        images.set(name, webp);
        outputBytes += webp.byteLength;
      }

      return mammoth.images.imgElement(() => ({
        src: '/word-images/' + name,
        alt: image.altText ?? '',
        width: String(info.width),
        height: String(info.height),
        loading: 'lazy',
        decoding: 'async',
      }))(image);
    } catch {
      return omitImage('Some embedded images could not be read or converted to WebP and were skipped.');
    }
  }

  let result;
  try {
    result = await mammoth.convertToHtml({ buffer }, {
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      idPrefix: 'word-',
      styleMap: [
        "p[style-name='Title'] => h1.word-title:fresh",
        "p[style-name='Quote'] => blockquote > p:fresh",
        "p[style-name='Intense Quote'] => blockquote > p:fresh",
        "p[style-name='Caption'] => p.word-caption:fresh",
        'u => u',
      ],
      convertImage,
    });
  } catch {
    throw new Error('The Word document could not be read. Save a fresh .docx copy and try again.');
  }
  if (Buffer.byteLength(result.value) > 12 * mib) {
    throw new Error('The Word document contains too much formatted text to convert. Split it into smaller files.');
  }
  const warnings = [...imageWarnings, ...result.messages.map(({ message }) => message)].slice(0, 64);
  return { html: result.value, warnings, images };
}

export async function convertDocx(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected Word document bytes in a Buffer.');
  if (buffer.byteLength > maxFileBytes) throw new Error('The Word document exceeds the 40 MiB conversion limit.');

  // The worker owns the copy and can stop without changing the caller's bytes.
  const bytes = Uint8Array.from(buffer);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { convertDocx: true, bytes },
    transferList: [bytes.buffer],
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
  });

  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The Word document took more than 75 seconds to convert. Split it into smaller files.')), deadlineMs);
      worker.once('message', ({ value, error }) => {
        if (error) reject(new Error(error));
        else resolve(value);
      });
      worker.once('error', ({ code }) => reject(new Error(code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? 'The Word document uses too much memory to convert. Split it into smaller files.'
        : 'The Word converter could not finish reading the file.')));
      worker.once('exit', () => reject(new Error('The Word converter stopped before finishing the file.')));
    });
    for (const [name, data] of result.images) {
      result.images.set(name, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
    return result;
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

if (parentPort && workerData?.convertDocx) {
  try {
    parentPort.postMessage({ value: await readDocument(Buffer.from(workerData.bytes.buffer)) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
}
