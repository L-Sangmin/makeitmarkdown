// Parser: Excel workbook (.xlsx/.xls) — SheetJS (Apache-2.0, self-hosted).
// One section per sheet, GFM tables with the same row cap and honesty rules
// as the CSV parser: dates as ISO strings, formulas as their cached values,
// empty sheets noted instead of silently dropped.

import { qcScore, toArrayBuffer, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";
const MAX_TABLE_ROWS = 50;

const mdCell = (v) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();

function isoDate(d) {
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return isoDate(v);
  return String(v);
}

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.(xlsx|xlsm|xls)$/i.test(filename);
  },

  async parse(input) {
    const XLSX = globalThis.XLSX;
    if (!XLSX) throw new Error("SheetJS is not loaded");

    const filename = input.filename ?? "workbook.xlsx";
    const bytes = new Uint8Array(toArrayBuffer(input.fileBuffer));
    // .xlsx/.xlsm are ZIP containers (PK), legacy .xls is CFB (D0 CF).
    // Without this check SheetJS silently "reads" arbitrary text as CSV.
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isCfb = bytes[0] === 0xd0 && bytes[1] === 0xcf;
    if (!isZip && !isCfb) {
      throw new Error(
        "couldn't read this as a valid Excel workbook — re-export it as .xlsx and try again"
      );
    }
    let wb;
    try {
      wb = XLSX.read(bytes, { type: "array", cellDates: true });
    } catch {
      throw new Error(
        "couldn't read this as a valid Excel workbook — re-export it as .xlsx and try again"
      );
    }

    const warnings = [];
    const sections = [];
    const tables = [];
    let dataSheets = 0;

    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      const nonEmpty = rows.filter((r) => r.some((c) => c != null && c !== ""));

      if (!nonEmpty.length) {
        warnings.push(`sheet "${name}" has no data — skipped`);
        sections.push({ heading: `Sheet: ${name}`, level: 2, content: "_(empty sheet)_" });
        continue;
      }
      dataSheets += 1;

      const width = Math.max(...nonEmpty.map((r) => r.length));
      const grid = nonEmpty.map((r) => {
        const row = r.slice(0, width).map(cellText);
        while (row.length < width) row.push("");
        return row;
      });

      const [header, ...data] = grid;
      const shown = data.slice(0, MAX_TABLE_ROWS);
      const omitted = data.length - shown.length;
      const headerCells = header.map((h, i) => (h === "" ? `col_${i + 1}` : h));

      const table = [
        `| ${headerCells.map(mdCell).join(" | ")} |`,
        `| ${headerCells.map(() => "---").join(" | ")} |`,
        ...shown.map((r) => `| ${r.map(mdCell).join(" | ")} |`),
      ].join("\n");

      if (omitted > 0) {
        warnings.push(`sheet "${name}": ${omitted} more rows omitted (kept the first ${shown.length})`);
      }
      tables.push({
        id: `sheet_${tables.length + 1}`,
        caption: `${name} (${data.length} rows × ${width} columns)`,
        markdown: table,
      });
      sections.push({
        heading: `Sheet: ${name}`,
        level: 2,
        content:
          `${data.length} rows × ${width} columns\n\n${table}` +
          (omitted > 0 ? `\n\n… ${omitted} more rows omitted (kept the first ${shown.length}).` : ""),
      });
    }

    sections.unshift({
      heading: "Workbook overview",
      level: 2,
      content: [
        `- Source: \`${filename}\``,
        `- Sheets: ${wb.SheetNames.length} (${dataSheets} with data)`,
        `- Formula cells appear as their last calculated values — formulas themselves are not preserved`,
      ].join("\n"),
    });
    if (wb.SheetNames.length !== dataSheets) {
      // keep the formula note honest even when nothing else went wrong
    }

    const result = {
      title: filenameStem(filename, "workbook"),
      authors: [],
      abstract: null,
      sections,
      figures: [],
      tables,
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity: {
        detected: { tables: dataSheets, figures: 0, equations: 0, codeCells: 0 },
        recovered: { tables: tables.length, figures: 0, equations: 0 },
        warnings,
        qcScore: 0,
      },
      meta: {
        sourceFormat: "xlsx",
        parserVersion: PARSER_VERSION,
        sheets: wb.SheetNames.length,
      },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
