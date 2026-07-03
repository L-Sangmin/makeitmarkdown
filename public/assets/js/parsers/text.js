// Parser: Markdown / plain text — pure JS, no libraries.
// Markdown passes through verbatim (it's already the target format — the
// value is the fidelity report, token counts, sections and presets on top).
// Plain text gets an overview plus its content untouched.

import { splitMarkdownSections, qcScore, decodeText, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.(md|markdown|txt|text)$/i.test(filename);
  },

  async parse(input) {
    const filename = input.filename ?? "notes.txt";
    const raw = decodeText(input).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    if (!raw.trim()) throw new Error("the file is empty — nothing to convert");

    const isMarkdown = /\.(md|markdown)$/i.test(filename);
    const warnings = [];
    let title;
    let sections;
    const fidelity = {
      detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
      recovered: { tables: 0, figures: 0, equations: 0 },
      warnings,
      qcScore: 0,
    };

    if (isMarkdown) {
      const h1 = raw.match(/^#\s+(.+?)\s*$/m)?.[1];
      title = h1 ?? filenameStem(filename, "document");
      sections = splitMarkdownSections(raw, "Document").filter(
        // drop the bare H1-title section when it carries no content
        (s, i) => !(i === 0 && s.heading === title && !s.content)
      );
      if (sections.length && sections[0].heading === title) {
        sections[0] = { ...sections[0], heading: "Introduction" };
      }
      const tables = (raw.match(/^\|? *:?-{3,}.*\|/gm) ?? []).length;
      const figs = (raw.match(/!\[/g) ?? []).length;
      const eqs = (raw.match(/\$\$[\s\S]+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)/g) ?? []).length;
      fidelity.detected.tables = fidelity.recovered.tables = tables;
      fidelity.detected.figures = fidelity.recovered.figures = figs;
      fidelity.detected.equations = fidelity.recovered.equations = eqs;
      fidelity.detected.codeCells = (raw.match(/^```/gm) ?? []).length >> 1;
    } else {
      title = filenameStem(filename, "notes");
      const lines = raw.replace(/\n+$/, "").split("\n");
      const words = raw.split(/\s+/).filter(Boolean).length;
      sections = [
        {
          heading: "Overview",
          level: 2,
          content: [
            `- Source: \`${filename}\``,
            `- ${lines.length} lines · ${words.toLocaleString("en-US")} words · ~${Math.round(raw.length / 4).toLocaleString("en-US")} tokens`,
          ].join("\n"),
        },
        { heading: "Content", level: 2, content: raw.trimEnd() },
      ];
    }

    const result = {
      title,
      authors: [],
      abstract: null,
      sections,
      figures: [],
      tables: [],
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity,
      meta: { sourceFormat: isMarkdown ? "markdown" : "text", parserVersion: PARSER_VERSION },
    };
    fidelity.qcScore = qcScore(result);
    return result;
  },
};
