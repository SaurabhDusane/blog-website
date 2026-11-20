function lineText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function wordMarkdown(container: DocumentFragment) {
  const format = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/[\\`*_<>\[\]]/g, '\\$&');
    if (!(node instanceof HTMLElement)) return '';
    const text = [...node.childNodes].map(format).join('');
    switch (node.localName) {
      case 'b': case 'strong': return text.trim() ? `**${text.trim()}**` : text;
      case 'em': case 'i': return text.trim() ? `*${text.trim()}*` : text;
      case 'a': {
        const href = node.getAttribute('href');
        return href ? `[${text.trim()}](<${href.replace(/[<>\n\r]/g, encodeURIComponent)}>)` : text;
      }
      case 'li': return text.trim();
      case 'ol': case 'ul': return [...node.children].map((item, index) =>
        `${node.localName === 'ol' ? `${index + 1}.` : '-'} ${format(item).replaceAll('\n', '\n   ')}`).join('\n') + '\n\n';
      case 'blockquote': return text.trim().split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return `${'#'.repeat(Math.max(2, Number(node.localName.slice(1))))} ${text.trim()}\n\n`;
      case 'p': return text.trim() + '\n\n';
      case 'tr': return lineText(text) + '\n\n';
      case 'td': case 'th': return lineText(text) + ' ';
      case 'br': return '\n';
      case 'img': return node.getAttribute('alt') ?? '';
      default: return text;
    }
  };
  return [...container.childNodes].map(format).join('').trim();
}

async function readWord(file: File) {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
    includeEmbeddedStyleMap: false,
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Quote'] => blockquote > p:fresh"],
  });
  const template = document.createElement('template');
  template.innerHTML = value;
  const heading = template.content.firstElementChild;
  const title = heading?.matches('h1') ? lineText(heading.textContent ?? '') : '';
  if (title) heading?.remove();
  const description = lineText(template.content.querySelector('p')?.textContent ?? '');
  return { title, description, body: wordMarkdown(template.content) };
}

async function readPdf(file: File) {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.min.mjs'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({ data: await file.arrayBuffer(), useSystemFonts: false, disableFontFace: true, useWasm: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new Error('Choose a PDF with 100 pages or fewer.');
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const { items } = await page.getTextContent();
      const paragraphs: string[] = [];
      let current = '';
      let previousY: number | undefined;
      for (const item of items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        if (previousY !== undefined && Math.abs(y - previousY) > Math.max(12, item.height * 1.6) && current) {
          paragraphs.push(lineText(current));
          current = '';
        }
        current += (current ? ' ' : '') + item.str;
        previousY = y;
      }
      if (current) paragraphs.push(lineText(current));
      pages.push(...paragraphs);
    }
    const body = pages.join('\n\n');
    if (!body.trim()) throw new Error('This PDF has no selectable text. Try exporting a text PDF or use its Word file.');
    const metadata = await pdf.getMetadata().catch(() => null);
    const title = (metadata?.info as { Title?: string } | undefined)?.Title;
    return { title: typeof title === 'string' ? lineText(title) : '', description: pages[0], body };
  } finally {
    await task.destroy();
  }
}

export async function importDeskDocument(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a document up to 20 MiB.');
  if (!/\.(docx|pdf)$/i.test(file.name)) throw new Error('Choose a Word (.docx) or PDF file.');
  const isPdf = /\.pdf$/i.test(file.name);
  const draft = await (isPdf ? readPdf(file) : readWord(file));
  if (!draft.body.trim()) throw new Error('There is no essay text to import from this file.');
  if (draft.body.length > 48000) throw new Error('The essay text is longer than 48,000 characters. Try a shorter document.');
  return {
    title: (draft.title || file.name.replace(/\.(docx|pdf)$/i, '').replace(/[-_]+/g, ' ')).slice(0, 180),
    description: draft.description.slice(0, 450),
    body: draft.body,
  };
}
