// Parser: Word document (.docx) — HANDOFF §4.1.
//
// TODO (Phase 1, Week 2 — not implemented yet):
// mammoth.js (BSD-2-Clause) -> HTML -> Turndown (MIT) -> Markdown,
// with a style map to preserve heading semantics.

export default {
  canHandle(url, doc, filename) {
    return typeof filename === 'string' && filename.toLowerCase().endsWith('.docx');
  },

  async parse(input) {
    throw new Error('docx parser not implemented yet');
  },
};
