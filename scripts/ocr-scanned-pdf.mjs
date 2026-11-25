import { spawn } from 'node:child_process';
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';

const maxOutput = 800_000;
const minConfidence = 75;

export function recognizedPassages(tsv) {
  const lines = new Map();
  let words = 0;
  let uncertain = 0;
  for (const row of tsv.split(/\r?\n/g)) {
    const fields = row.split('\t');
    const [level, page, block, paragraph, line, , , , , , confidence, ...text] = fields;
    const score = Number(confidence);
    const word = text.join(' ').trim();
    if (level !== '5' || !Number.isFinite(score) || score < 0 || score > 100 || !word) continue;
    words += 1;
    const low = score < minConfidence;
    if (low) uncertain += 1;
    const key = `${page}:${block}:${paragraph}:${line}`;
    const group = lines.get(key) ?? [];
    group.push({ word, low });
    lines.set(key, group);
  }
  return { paragraphs: [...lines.values()].map((parts) => ({ text: parts.map(({ word }) => word).join(' '), parts })), words, uncertain };
}

async function tesseract(image, config) {
  const args = ['stdin', 'stdout', '-l', config.language, '--psm', '3', 'tsv'];
  const command = spawn(config.command, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false,
    windowsHide: true, signal: AbortSignal.timeout(12_000) });
  command.stdin.on('error', () => {});
  const result = new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    command.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutput) {
        command.kill();
        reject(new Error('A scan produced too much OCR text. Split the document into smaller files.'));
      } else chunks.push(chunk);
    });
    command.once('error', (error) => reject(new Error(error.code === 'ENOENT'
      ? 'Install Tesseract and its language data on the private preview builder to read this scan.'
      : 'A scan took too long to read. Try splitting the document into smaller files.')));
    command.once('close', (code) => {
      if (code !== 0) reject(new Error('Tesseract could not read this scan. Check its language data or try a clearer scan.'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
  command.stdin.end(image);
  return result;
}

export async function recognizePage(pdf, page, config, recognize = tesseract) {
  const { width, height } = page.getViewport({ scale: 1 });
  if (!(width > 0 && height > 0)) throw new Error('A scan has an unreadable page size.');
  const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / width, 2200 / height) });
  const output = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await page.render({ canvas: output.canvas, canvasContext: output.context, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    const data = await recognize(output.canvas.toBuffer('image/png'), config);
    return recognizedPassages(data);
  } finally { pdf.canvasFactory.destroy(output); }
}
