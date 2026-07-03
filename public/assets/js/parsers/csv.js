// Parser: CSV/TSV — HANDOFF §4.1.
//
// TODO (Phase 1, Week 2 — not implemented yet):
// header + row-count summary + column type annotations, GFM table output
// (large files: first N rows + summary).

export default {
  canHandle(url, doc, filename) {
    return typeof filename === 'string' && /\.(csv|tsv)$/i.test(filename);
  },

  async parse(input) {
    throw new Error('csv parser not implemented yet');
  },
};
