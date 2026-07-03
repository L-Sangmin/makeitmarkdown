// Parser: CSV/TSV — HANDOFF §4.1. Pure JS, no libraries.
//
// Emits a summary (rows × columns), per-column type annotations, and a GFM
// table. Large files keep the first rows and say exactly what was omitted.

import { qcScore, decodeText, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";
const MAX_TABLE_ROWS = 50;

// RFC 4180-style: quoted fields may contain delimiters, quotes ("" escape)
// and newlines.
function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) pushRow();

  // drop a trailing fully-empty row (file ends with newline)
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

function sniffDelimiter(firstLine, filename) {
  if (/\.tsv$/i.test(filename ?? "")) return "\t";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function classifyCell(v) {
  const t = v.trim();
  if (t === "") return null;
  if (/^[+-]?\d+$/.test(t)) return "int";
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) || /^[+-]?\d+[eE][+-]?\d+$/.test(t)) return "float";
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.+Z-]+)?$/.test(t) || /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(t)) return "date";
  if (/^(true|false)$/i.test(t)) return "bool";
  return "str";
}

function columnType(cells) {
  const tally = new Map();
  let empties = 0;
  for (const c of cells) {
    const kind = classifyCell(c);
    if (kind === null) empties++;
    else tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }
  if (!tally.size) return { type: "empty", empties };
  // int + float mix reads as float
  if (tally.size === 2 && tally.has("int") && tally.has("float")) {
    return { type: "float", empties };
  }
  const [type] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return { type: tally.size > 1 ? `mostly ${type}` : type, empties };
}

const mdCell = (v) => v.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.(csv|tsv)$/i.test(filename);
  },

  async parse(input) {
    const text = decodeText(input);
    const filename = input.filename ?? "data.csv";
    const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
    const delim = sniffDelimiter(firstLine, filename);

    const rows = parseDelimited(text, delim);
    if (rows.length < 1 || (rows.length === 1 && rows[0].join("") === "")) {
      throw new Error("the file is empty — nothing to convert");
    }

    const header = rows[0].map((h, i) => (h.trim() === "" ? `col_${i + 1}` : h.trim()));
    let data = rows.slice(1);
    const warnings = [];

    const ragged = data.filter((r) => r.length !== header.length).length;
    if (ragged) {
      warnings.push(
        `${ragged} row(s) have a different column count than the header — padded or truncated to fit`
      );
      data = data.map((r) => {
        const copy = r.slice(0, header.length);
        while (copy.length < header.length) copy.push("");
        return copy;
      });
    }

    const columns = header.map((name, i) => ({
      name,
      ...columnType(data.map((r) => r[i] ?? "")),
    }));

    const shown = data.slice(0, MAX_TABLE_ROWS);
    const omitted = data.length - shown.length;
    const tableLines = [
      `| ${header.map(mdCell).join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...shown.map((r) => `| ${r.map(mdCell).join(" | ")} |`),
    ];
    const tableMd = tableLines.join("\n");
    if (omitted > 0) {
      warnings.push(`${omitted} more rows omitted from the table (kept the first ${shown.length})`);
    }

    const columnLines = columns.map(
      (c) =>
        `- \`${c.name}\` — ${c.type}${c.empties ? ` (${c.empties} empty)` : ""}`
    );

    const sections = [
      {
        heading: "Overview",
        level: 2,
        content: [
          `- Source: \`${filename}\``,
          `- Size: ${data.length} rows × ${header.length} columns`,
          `- Delimiter: \`${delim === "\t" ? "\\t" : delim}\``,
        ].join("\n"),
      },
      { heading: "Columns", level: 2, content: columnLines.join("\n") },
      {
        heading: "Data",
        level: 2,
        content:
          tableMd +
          (omitted > 0 ? `\n\n… ${omitted} more rows omitted (kept the first ${shown.length}).` : ""),
      },
    ];

    const result = {
      title: filenameStem(filename, "data"),
      authors: [],
      abstract: null,
      sections,
      figures: [],
      tables: [
        {
          id: "table_1",
          caption: `${filename} (${data.length} rows × ${header.length} columns)`,
          markdown: tableMd,
        },
      ],
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity: {
        detected: { tables: 1, figures: 0, equations: 0, codeCells: 0 },
        recovered: { tables: 1, figures: 0, equations: 0 },
        warnings,
        qcScore: 0,
      },
      meta: {
        sourceFormat: "csv",
        parserVersion: PARSER_VERSION,
        rows: data.length,
        columns: header.length,
      },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
