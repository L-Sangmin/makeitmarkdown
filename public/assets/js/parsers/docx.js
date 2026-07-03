// Parser: Word document (.docx) — HANDOFF §4.1.
// mammoth.js (BSD-2-Clause) → HTML → Turndown (MIT) → Markdown, with a
// style map preserving heading semantics (Title → h1; Heading 1-6 are
// mammoth defaults). Inline images become [Figure: …] placeholders with the
// binary kept in figures[] as data URLs.

import {
  makeTurndown,
  splitMarkdownSections,
  extractMdTables,
  qcScore,
  toArrayBuffer,
  filenameStem,
} from "../md-utils.js";

const PARSER_VERSION = "0.1.0";

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && filename.toLowerCase().endsWith(".docx");
  },

  async parse(input) {
    const mammoth = globalThis.mammoth;
    if (!mammoth) throw new Error("mammoth is not loaded");

    const filename = input.filename ?? "document.docx";
    // browser mammoth wants {arrayBuffer}; node mammoth (tests) wants {buffer}
    const src = input.fileBuffer;
    const mammothInput =
      typeof Buffer !== "undefined" && Buffer.isBuffer(src)
        ? { buffer: src }
        : { arrayBuffer: toArrayBuffer(src) };
    const { value: htmlStr, messages } = await mammoth.convertToHtml(mammothInput, {
      styleMap: STYLE_MAP,
    });

    const doc = new DOMParser().parseFromString(htmlStr, "text/html");
    const tablesDetected = doc.querySelectorAll("table").length;

    // mammoth wraps every cell's text in <p>; block content inside cells
    // breaks GFM table conversion. Unwrap to inline.
    for (const p of doc.querySelectorAll("td p, th p")) {
      p.replaceWith(...p.childNodes, doc.createTextNode(" "));
    }

    // Word doesn't export header-row semantics and mammoth emits only <td>,
    // which the GFM table rule skips. Heuristic: treat the first row of a
    // header-less table as its header.
    for (const table of doc.querySelectorAll("table")) {
      if (table.querySelector("th")) continue;
      const firstRow = table.querySelector("tr");
      if (!firstRow) continue;
      for (const td of firstRow.querySelectorAll("td")) {
        const th = doc.createElement("th");
        th.innerHTML = td.innerHTML;
        td.replaceWith(th);
      }
      const thead = doc.createElement("thead");
      thead.appendChild(firstRow);
      table.insertBefore(thead, table.firstChild);
    }

    // images → placeholders + figures[]
    const figures = [];
    for (const img of [...doc.querySelectorAll("img")]) {
      const id = `docx_figure_${figures.length + 1}`;
      const src = img.getAttribute("src") ?? "";
      figures.push({
        id,
        caption: img.getAttribute("alt") || `Figure ${figures.length + 1} from ${filename}`,
        url: src,
        alt: img.getAttribute("alt") ?? "",
      });
      const marker = doc.createElement("mim-fig");
      marker.textContent = id;
      img.replaceWith(marker);
    }

    const md = makeTurndown().turndown(doc.body.innerHTML);
    const sections = splitMarkdownSections(md, "Document");

    const title = doc.querySelector("h1")?.textContent?.trim() || filenameStem(filename, "document");
    if (sections.length && sections[0].heading === title) {
      sections[0] = { ...sections[0], heading: "Overview" };
      if (!sections[0].content) sections.shift();
    }

    const mdTables = extractMdTables(md);
    const warnings = messages.map((m) => `${m.type}: ${m.message}`);
    if (mdTables.length < tablesDetected) {
      warnings.push(
        `${tablesDetected - mdTables.length} table(s) did not survive conversion to GFM`
      );
    }

    const result = {
      title,
      authors: [],
      abstract: null,
      sections,
      figures,
      tables: mdTables.map((markdown, i) => ({ id: `table_${i + 1}`, caption: "", markdown })),
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity: {
        detected: {
          tables: tablesDetected,
          figures: figures.length,
          equations: 0,
          codeCells: 0,
        },
        recovered: { tables: mdTables.length, figures: figures.length, equations: 0 },
        warnings,
        qcScore: 0,
      },
      meta: { sourceFormat: "docx", parserVersion: PARSER_VERSION },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
