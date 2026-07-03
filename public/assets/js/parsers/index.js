// Parser registry. Every parser implements the standard interface (HANDOFF §10):
//
//   canHandle(url, doc, filename) -> boolean
//   async parse(input) -> ParseResult
//     input: { url?, doc?, apiKey?, fileBuffer?, filename? }
//
// ParseResult (common schema — one schema feeds both formatters, the presets,
// and the fidelity panel of the 3-panel trust view):
//
//   {
//     title, authors: [], abstract,
//     sections:   [{ heading, level, content }],
//     figures:    [{ id, caption, url, alt }],
//     tables:     [{ id, caption, markdown }],
//     references: [], doi, journal, year,
//     fidelity: {
//       detected:  { tables, figures, equations, codeCells },
//       recovered: { tables, figures, equations },
//       warnings:  [],
//       qcScore:   0   // validateParseResult result (0..1), HANDOFF §16
//     },
//     meta: { sourceFormat, parserVersion }
//   }
//
// fidelity counts are reported as "detected", not "preserved" — no
// overpromising (HANDOFF §1.5.3).

import ipynb from './ipynb.js';
import docx from './docx.js';
import csv from './csv.js';
import html from './html.js';
import pdf from './pdf.js';

// Order matters: first canHandle() match wins.
const parsers = [ipynb, docx, csv, html, pdf];

export function findParser(url, doc, filename) {
  return parsers.find((p) => p.canHandle(url, doc, filename)) ?? null;
}

export default parsers;
