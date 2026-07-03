// Parser: general HTML (.html file upload) — HANDOFF §4.1.
//
// TODO (Phase 1, Week 2 — not implemented yet):
// Readability.js (Apache-2.0) main-content extraction (strip nav/ads)
// -> Turndown (MIT) -> Markdown. ZIP uploads with local assets are
// pre-processed by zipper.js before reaching this parser.

export default {
  canHandle(url, doc, filename) {
    return typeof filename === 'string' && /\.html?$/i.test(filename);
  },

  async parse(input) {
    throw new Error('html parser not implemented yet');
  },
};
