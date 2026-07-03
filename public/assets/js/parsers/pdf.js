// Parser: PDF — best-effort fallback (HANDOFF §4.2, included in Phase 1).
// pdf.js (Apache-2.0) client-side text extraction. Quality is limited by
// design: PDFs carry no reliable structure, so the output is flat text per
// page with an explicit layout-lossy disclaimer. Image-only (scanned) PDFs
// do not fail — they return a fidelity warning and a next-action message.

import { qcScore, toArrayBuffer, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";
const SCANNED_CHARS_PER_PAGE = 16;

// pdf.js exception → a message the user can act on.
export function mapPdfError(err) {
  if (err?.name === "PasswordException") {
    return new Error(
      "This PDF is password-protected — remove the password first (open it and Print → Save as PDF works), then try again"
    );
  }
  if (err?.name === "InvalidPDFException") {
    return new Error(
      "This file doesn't look like a valid PDF — re-export or re-download it and try again"
    );
  }
  return err;
}

async function pageText(page) {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.trim();
}

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && filename.toLowerCase().endsWith(".pdf");
  },

  async parse(input) {
    const pdfjs = globalThis.pdfjsLib;
    if (!pdfjs) throw new Error("pdf.js is not loaded");

    const filename = input.filename ?? "document.pdf";
    const data = new Uint8Array(toArrayBuffer(input.fileBuffer));
    const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
    let doc;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      throw mapPdfError(err);
    }

    const warnings = [
      "PDF text extraction is layout-lossy: multi-column text and tables may interleave — prefer an HTML or source version when one exists",
      "figures/images are not extracted from PDFs in this phase",
    ];

    try {
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        pages.push(await pageText(await doc.getPage(i)));
        input.onProgress?.({ page: i, pages: doc.numPages });
      }
      const totalChars = pages.reduce((n, p) => n + p.length, 0);

      let sections;
      if (totalChars < doc.numPages * SCANNED_CHARS_PER_PAGE) {
        warnings.push(
          `this PDF appears to be scanned — no text layer detected across ${doc.numPages} page(s)`,
          "next step: upload the HTML version of this document for full recovery — browser-side OCR is out of scope"
        );
        sections = [
          {
            heading: "Notice",
            level: 2,
            content:
              "⚠ Scanned PDF: no text layer was found, so no text could be extracted. " +
              "If you have the original document or its HTML version, upload that for full recovery.",
          },
        ];
      } else {
        sections = pages.map((text, i) => ({
          heading: `Page ${i + 1}`,
          level: 2,
          content: text,
        }));
      }

      const info = (await doc.getMetadata().catch(() => null))?.info ?? {};
      const title =
        typeof info.Title === "string" && info.Title.trim()
          ? info.Title.trim()
          : filenameStem(filename, "document");

      const result = {
        title,
        authors: typeof info.Author === "string" && info.Author.trim() ? [info.Author.trim()] : [],
        abstract: null,
        sections,
        figures: [],
        tables: [],
        references: [],
        doi: null,
        journal: null,
        year: null,
        fidelity: {
          detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
          recovered: { tables: 0, figures: 0, equations: 0 },
          warnings,
          qcScore: 0,
        },
        meta: { sourceFormat: "pdf", parserVersion: PARSER_VERSION, pages: doc.numPages },
      };
      result.fidelity.qcScore = qcScore(result);
      return result;
    } finally {
      await loadingTask.destroy();
    }
  },
};
