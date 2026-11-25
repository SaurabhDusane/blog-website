import { Worker } from 'node:worker_threads';

const maxPdfBytes = 40 * 1024 * 1024;
const timeoutMs = 90_000;

export async function convertPdf(buffer, { ocr } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected PDF bytes in a Buffer.');
  if (buffer.byteLength > maxPdfBytes) {
    throw new Error('The PDF exceeds the 40 MB import limit.');
  }
  if (!buffer.subarray(0, 1024).includes('%PDF-')) {
    throw new Error('The file does not contain a readable PDF.');
  }

  // Give an interrupted parser its own heap and leave the caller's input intact.
  const data = Uint8Array.from(buffer);
  const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
    workerData: { data, ocr },
    transferList: [data.buffer],
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
  });

  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      const limit = ocr ? 150_000 : timeoutMs;
      timer = setTimeout(() => reject(new Error(`The PDF took more than ${limit / 1_000} seconds to convert. Split it into smaller files.`)), limit);
      worker.once('message', ({ value, error }) => {
        if (error) reject(new Error(error));
        else resolve(value);
      });
      worker.once('error', (error) => reject(new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? 'The PDF uses too much memory to convert. Split it into smaller files.'
        : 'The PDF converter could not finish reading the file.')));
      worker.once('exit', () => reject(new Error('The PDF converter stopped before finishing the file.')));
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
