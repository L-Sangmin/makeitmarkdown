// Opt-in OCR for scanned PDFs — tesseract.js (Apache-2.0), fully local.
//
// Loaded only when the user clicks "Try OCR" on a scanned-PDF result:
// the engine (~8 MB: worker + wasm core + English model) downloads once
// and is cached by the service worker's vendor rule afterwards.
//
// Output is APPROXIMATE by nature — recognized from pixels, not read from
// a text layer. Every result carries that warning; nothing here ever
// pretends otherwise.

// Absolute URLs are required: tesseract runs its worker from a blob URL,
// where path-absolute imports cannot resolve.
const OCR_BASE = `${globalThis.location?.origin ?? ""}/assets/vendor/ocr`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export async function ensureTesseract() {
  if (!globalThis.Tesseract) await loadScript(`${OCR_BASE}/tesseract.min.js`);
}

// Renders each PDF page to a canvas (pdf.js is already loaded — the pdf
// parser ran to detect the scan) and recognizes it. Returns one text
// string per page; empty strings mean nothing was recognized.
export async function ocrPdfPages(fileBuffer, { onProgress } = {}) {
  await ensureTesseract();
  if (!globalThis.pdfjsLib) throw new Error("PDF engine not loaded");

  const worker = await globalThis.Tesseract.createWorker("eng", 1, {
    workerPath: `${OCR_BASE}/worker.min.js`,
    corePath: OCR_BASE,
    langPath: OCR_BASE,
    gzip: false,
  });

  try {
    const task = globalThis.pdfjsLib.getDocument({ data: fileBuffer.slice(0) });
    const doc = await task.promise;
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        onProgress?.({ page: i, pages: doc.numPages });
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const { data } = await worker.recognize(canvas);
        pages.push((data.text ?? "").trim());
      }
    } finally {
      await task.destroy();
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}

// Fold OCR'd pages back into a parse result the rest of the app understands.
export function buildOcrResult(baseResult, pages) {
  const nonEmpty = pages.filter((t) => t).length;
  const sections = pages.map((text, i) => ({
    heading: `Page ${i + 1} (OCR)`,
    level: 2,
    content: text || "*No text recognized on this page.*",
  }));
  const warnings = [
    "OCR output is approximate — recognized from page images, not read from a text layer. Verify numbers, names and tables before relying on them.",
    `${nonEmpty} of ${pages.length} page(s) produced text; layout, columns and tables are flattened.`,
  ];
  return {
    ...baseResult,
    sections,
    tables: [],
    figures: [],
    fidelity: {
      detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
      recovered: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
      warnings,
      // Structural QC can't honestly score recognized pixels well — capped.
      qcScore: nonEmpty ? 0.6 : 0.2,
    },
    meta: { ...baseResult.meta, ocr: true },
  };
}
