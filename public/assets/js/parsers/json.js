// Parser: JSON / JSON Lines — pure JS, no libraries.
// LLMs read JSON better with a structure outline up front; JSONL logs read
// best as a table when the records share a shape. Dirty input is expected:
// BOMs are tolerated, bad JSONL lines are skipped with a count, oversized
// bodies are truncated with a note.

import { qcScore, decodeText, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";
const MAX_BODY_CHARS = 6000;
const MAX_TABLE_ROWS = 50;
const MAX_OUTLINE_LINES = 40;

const stripBom = (s) => s.replace(/^﻿/, "");
const mdCell = (v) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// Compact structure outline: `path` — type notes, depth-first, capped.
function outline(value, prefix = "", lines = []) {
  if (lines.length >= MAX_OUTLINE_LINES) return lines;
  const t = typeOf(value);
  if (t === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (lines.length >= MAX_OUTLINE_LINES) break;
      const path = prefix ? `${prefix}.${k}` : k;
      const vt = typeOf(v);
      if (vt === "array") {
        const inner = v.length ? typeOf(v[0]) : "empty";
        lines.push(`- \`${path}\` — array[${v.length}] of ${inner}`);
        if (inner === "object" && v[0]) outline(v[0], `${path}[]`, lines);
      } else if (vt === "object") {
        lines.push(`- \`${path}\` — object (${Object.keys(v).length} keys)`);
        outline(v, path, lines);
      } else {
        lines.push(`- \`${path}\` — ${vt}`);
      }
    }
  }
  return lines;
}

function recordsTable(records) {
  const keys = [];
  for (const r of records) {
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  const shown = records.slice(0, MAX_TABLE_ROWS);
  const cell = (r, k) => {
    const v = r[k];
    if (v === undefined) return "";
    return mdCell(typeOf(v) === "object" || Array.isArray(v) ? JSON.stringify(v) : v);
  };
  return {
    keys,
    markdown: [
      `| ${keys.map(mdCell).join(" | ")} |`,
      `| ${keys.map(() => "---").join(" | ")} |`,
      ...shown.map((r) => `| ${keys.map((k) => cell(r, k)).join(" | ")} |`),
    ].join("\n"),
    omitted: records.length - shown.length,
  };
}

function fencedBody(value, warnings) {
  let body = JSON.stringify(value, null, 2);
  if (body.length > MAX_BODY_CHARS) {
    body = `${body.slice(0, MAX_BODY_CHARS)}\n… [truncated: ${body.length - MAX_BODY_CHARS} more characters]`;
    warnings.push("pretty-printed body truncated — the structure outline above covers the full document");
  }
  return `\`\`\`json\n${body}\n\`\`\``;
}

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.(json|jsonl|ndjson)$/i.test(filename);
  },

  async parse(input) {
    const filename = input.filename ?? "data.json";
    const raw = stripBom(decodeText(input)).trim();
    if (!raw) throw new Error("the file is empty — nothing to convert");

    const isLines = /\.(jsonl|ndjson)$/i.test(filename);
    const warnings = [];
    const sections = [];
    const tables = [];
    const fidelity = {
      detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
      recovered: { tables: 0, figures: 0, equations: 0 },
      warnings,
      qcScore: 0,
    };

    if (isLines) {
      const lines = raw.split("\n").filter((l) => l.trim() !== "");
      const records = [];
      let bad = 0;
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          bad += 1;
        }
      }
      if (!records.length) throw new Error("no line in this file is valid JSON");
      if (bad) warnings.push(`${bad} line(s) were not valid JSON — skipped`);

      sections.push({
        heading: "Overview",
        level: 2,
        content: [
          `- Source: \`${filename}\` (JSON Lines)`,
          `- Records: ${records.length}${bad ? ` (+${bad} skipped)` : ""}`,
        ].join("\n"),
      });

      if (records.every((r) => typeOf(r) === "object")) {
        const { markdown, omitted } = recordsTable(records);
        fidelity.detected.tables = 1;
        fidelity.recovered.tables = 1;
        tables.push({ id: "records", caption: `${filename} (${records.length} records)`, markdown });
        sections.push({
          heading: "Records",
          level: 2,
          content: markdown + (omitted > 0 ? `\n\n… ${omitted} more records omitted.` : ""),
        });
        if (omitted > 0) warnings.push(`${omitted} more records omitted (kept the first ${MAX_TABLE_ROWS})`);
      } else {
        sections.push({ heading: "Records", level: 2, content: fencedBody(records, warnings) });
      }
    } else {
      let value;
      try {
        value = JSON.parse(raw);
      } catch (e) {
        throw new Error(`this isn't valid JSON — ${e.message}`);
      }
      sections.push({
        heading: "Overview",
        level: 2,
        content: [
          `- Source: \`${filename}\``,
          `- Root: ${typeOf(value)}${typeOf(value) === "object" ? ` (${Object.keys(value).length} keys)` : ""}`,
        ].join("\n"),
      });
      const outlineLines = outline(value);
      if (outlineLines.length) {
        sections.push({
          heading: "Structure",
          level: 2,
          content:
            outlineLines.join("\n") +
            (outlineLines.length >= MAX_OUTLINE_LINES ? "\n- …" : ""),
        });
      }
      sections.push({ heading: "Data", level: 2, content: fencedBody(value, warnings) });
    }

    const result = {
      title: filenameStem(filename, "data"),
      authors: [],
      abstract: null,
      sections,
      figures: [],
      tables,
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity,
      meta: { sourceFormat: "json", parserVersion: PARSER_VERSION },
    };
    fidelity.qcScore = qcScore(result);
    return result;
  },
};
