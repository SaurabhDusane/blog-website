import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function displayPdf(viewer: HTMLDetailsElement) {
  const url = viewer.dataset.pdfViewer;
  const status = viewer.querySelector<HTMLElement>('[data-pdf-status]');
  const canvas = viewer.querySelector<HTMLCanvasElement>('[data-pdf-page]');
  const controls = viewer.querySelector<HTMLElement>('[data-pdf-controls]');
  const back = viewer.querySelector<HTMLButtonElement>('[data-pdf-back]');
  const next = viewer.querySelector<HTMLButtonElement>('[data-pdf-next]');
  if (!url || !status || !canvas || !controls || !back || !next) return;
  if (!/^\/document-pdfs\/[a-f0-9]{64}\.pdf$/.test(url)) throw new Error('Invalid document path');

  const loading = getDocument({
    url,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: 12_000_000,
  });
  let pageNumber = 1;
  const pdf = await loading.promise.catch(async (error) => {
    await loading.destroy().catch(() => {});
    throw error;
  });

  const showPage = async (number: number) => {
    if (number < 1 || number > pdf.numPages) return;
    back.disabled = next.disabled = true;
    try {
      const page = await pdf.getPage(number);
      try {
        const size = page.getViewport({ scale: 1 });
        const scale = Math.min(1.25, 1100 / size.width, 1400 / size.height);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.setProperty('--pdf-width', `${canvas.width}px`);
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
      } finally {
        page.cleanup();
      }
      pageNumber = number;
      const label = `Page ${pageNumber} of ${pdf.numPages}`;
      status.textContent = label;
      canvas.setAttribute('aria-label', label + ' of the original PDF');
      canvas.hidden = false;
    } finally {
      back.disabled = pageNumber <= 1;
      next.disabled = pageNumber >= pdf.numPages;
    }
  };

  try {
    await showPage(1);
  } catch (error) {
    await loading.destroy().catch(() => {});
    throw error;
  }

  const move = (offset: number) => {
    showPage(pageNumber + offset).catch(() => {
      canvas.hidden = true;
      status.textContent = 'This page couldn’t be drawn. Use the download link to read it.';
    });
  };
  if (pdf.numPages > 1) {
    controls.hidden = false;
    back.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
  }
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) void loading.destroy().catch(() => {});
  });
}
