// Parser: PDF — best-effort fallback (HANDOFF §4.2, included in Phase 1).
//
// TODO (Phase 1, Week 2 — not implemented yet):
// pdf.js (Apache-2.0) client-side text extraction. Quality is limited by
// design — error messaging should point users to a better source format
// when extraction fails (e.g. scanned pages have no text layer).

export default {
  canHandle(url, doc, filename) {
    return typeof filename === 'string' && filename.toLowerCase().endsWith('.pdf');
  },

  async parse(input) {
    throw new Error('pdf parser not implemented yet');
  },
};
