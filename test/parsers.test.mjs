import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Browser parsers resolve their libraries from globals (vendored UMD builds).
// Node tests provide the same globals from the matching npm dev-dependencies.
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import * as turndownPluginGfm from "turndown-plugin-gfm";
import { Readability } from "@mozilla/readability";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

globalThis.DOMParser = new JSDOM("").window.DOMParser;
globalThis.TurndownService = TurndownService;
globalThis.turndownPluginGfm = turndownPluginGfm;
globalThis.Readability = Readability;
globalThis.mammoth = mammoth;
globalThis.pdfjsLib = pdfjsLib;

import csv from "../public/assets/js/parsers/csv.js";
import docx from "../public/assets/js/parsers/docx.js";
import html from "../public/assets/js/parsers/html.js";
import pdf from "../public/assets/js/parsers/pdf.js";
import { findParser } from "../public/assets/js/parsers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, "fixtures", name);
const load = (name) => readFile(fixture(name));

const allText = (r) => r.sections.map((s) => `${s.heading}\n${s.content}`).join("\n");

// ---------------------------------------------------------------------------
// registry

test("registry routes each extension to the right parser", () => {
  assert.equal(findParser(null, null, "a.csv"), csv);
  assert.equal(findParser(null, null, "a.tsv"), csv);
  assert.equal(findParser(null, null, "a.docx"), docx);
  assert.equal(findParser(null, null, "a.html"), html);
  assert.equal(findParser(null, null, "a.htm"), html);
  assert.equal(findParser(null, null, "a.pdf"), pdf);
  assert.equal(findParser(null, null, "a.txt"), null);
});

// ---------------------------------------------------------------------------
// csv

test("csv: summary, column types, GFM table, fidelity", async () => {
  const r = await csv.parse({ fileBuffer: await load("sales.csv"), filename: "sales.csv" });
  assert.equal(r.title, "sales");
  assert.equal(r.meta.sourceFormat, "csv");
  assert.ok(r.sections.length >= 3, `sections: ${r.sections.length}`);

  const text = allText(r);
  assert.match(text, /22 rows × 6 columns/);
  assert.match(text, /`order_id`\s+—\s+int/);
  assert.match(text, /`revenue`\s+—\s+float/);
  assert.match(text, /`date`\s+—\s+date/);
  assert.match(text, /`region`\s+—\s+str/);
  assert.match(text, /\| order_id \| date \| region \|/);
  assert.match(text, /\| 1001 \|/);

  assert.equal(r.fidelity.detected.tables, 1);
  assert.equal(r.fidelity.recovered.tables, 1);
  assert.equal(r.tables.length, 1);
  assert.ok(r.tables[0].markdown.includes("| order_id |"));
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("csv: large files keep the first rows and say what was omitted", async () => {
  const rows = ["id,value"];
  for (let i = 1; i <= 300; i++) rows.push(`${i},${i * 2}`);
  const r = await csv.parse({ doc: rows.join("\n"), filename: "big.csv" });
  const table = r.tables[0].markdown;
  const dataRows = table.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.ok(dataRows.length <= 50, `kept ${dataRows.length} rows`);
  assert.match(allText(r), /250 more rows omitted/);
  assert.ok(r.fidelity.warnings.some((w) => /omitted/.test(w)));
});

test("csv: quoted fields with commas and pipes survive", async () => {
  const doc = 'name,price\n"Widget, Deluxe",10\n"a|b",2\n';
  const r = await csv.parse({ doc, filename: "quoted.csv" });
  const table = r.tables[0].markdown;
  assert.ok(table.includes("Widget, Deluxe"), "comma kept inside quoted cell");
  assert.ok(table.includes("a\\|b"), "pipe escaped for GFM");
});

test("csv: ragged rows produce a warning, not a crash", async () => {
  const doc = "a,b,c\n1,2,3\n4,5\n6,7,8,9\n";
  const r = await csv.parse({ doc, filename: "ragged.csv" });
  assert.ok(r.fidelity.warnings.some((w) => /2 row\(s\) have a different column count/.test(w)));
});

// ---------------------------------------------------------------------------
// docx

test("docx: headings become sections via the style map", async () => {
  const r = await docx.parse({
    fileBuffer: await load("q1-operations-review.docx"),
    filename: "q1-operations-review.docx",
  });
  assert.equal(r.title, "Q1 Operations Review");
  assert.equal(r.meta.sourceFormat, "docx");
  assert.ok(r.sections.length >= 4, `sections: ${r.sections.length}`);
  assert.ok(
    r.sections.some((s) => s.heading === "Regional performance"),
    "heading semantics preserved"
  );
});

test("docx: tables and lists reach the Markdown", async () => {
  const r = await docx.parse({
    fileBuffer: await load("q1-operations-review.docx"),
    filename: "q1-operations-review.docx",
  });
  const text = allText(r);
  assert.match(text, /\| Region \| Units shipped \|/);
  assert.match(text, /- {1,3}Carrier contract renewal/);
  assert.match(text, /1\. {1,3}Finalize the carrier shortlist/);
  assert.equal(r.fidelity.detected.tables, 1);
  assert.equal(r.fidelity.recovered.tables, 1);
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

// ---------------------------------------------------------------------------
// html

test("html: Readability strips nav/ads and keeps the article", async () => {
  const r = await html.parse({ fileBuffer: await load("article.html"), filename: "article.html" });
  assert.equal(r.meta.sourceFormat, "html");
  assert.match(r.title, /Quarterly Planning for Small Teams/);
  const text = allText(r);
  assert.ok(!/SPONSORED|InboxZero/.test(text), "ad banner stripped");
  assert.ok(!/Subscribe/.test(text), "nav stripped");
  assert.ok(!/Related posts/.test(text), "aside stripped");
  assert.match(text, /three-meeting structure/);
});

test("html: article structure, table and figures land in the schema", async () => {
  const r = await html.parse({ fileBuffer: await load("article.html"), filename: "article.html" });
  assert.ok(r.sections.length >= 3, `sections: ${r.sections.length}`);
  assert.ok(r.sections.some((s) => /The three meetings/.test(s.heading)));
  const text = allText(r);
  assert.match(text, /\| Meeting \| Length \| Output \|/);
  assert.equal(r.fidelity.detected.tables, 1);
  assert.equal(r.fidelity.recovered.tables, 1);
  assert.equal(r.fidelity.detected.figures, 2);
  assert.ok(
    r.fidelity.warnings.some((w) => /relative|local image/i.test(w)),
    "relative image warned for ZIP recovery"
  );
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

// ---------------------------------------------------------------------------
// pdf

test("pdf: extracts text pages into sections", async () => {
  const buf = await load("vendor-report.pdf");
  const r = await pdf.parse({ fileBuffer: buf, filename: "vendor-report.pdf" });
  assert.equal(r.meta.sourceFormat, "pdf");
  assert.ok(r.title.length > 0);
  assert.ok(r.sections.length >= 1);
  const text = allText(r).replace(/\s+/g, " "); // PDF line wrap points vary
  assert.match(text, /Vendor B led on reliability/);
  assert.match(text, /Recommendation/);
  assert.ok(
    r.fidelity.warnings.some((w) => /layout|columns|tables/i.test(w)),
    "carries the layout-lossy disclaimer"
  );
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("pdf: password/corrupt errors map to next-action messages", async () => {
  const { mapPdfError } = await import("../public/assets/js/parsers/pdf.js");
  assert.match(
    mapPdfError({ name: "PasswordException", message: "x" }).message,
    /password-protected.*remove the password/is
  );
  assert.match(
    mapPdfError({ name: "InvalidPDFException", message: "x" }).message,
    /valid PDF.*re-export/is
  );
  assert.equal(mapPdfError(new RangeError("boom")).message, "boom");
});

test("pdf: truncated file rejects with the invalid-PDF message", async () => {
  const buf = (await load("vendor-report.pdf")).subarray(0, 120); // garbage tail
  await assert.rejects(
    pdf.parse({ fileBuffer: buf, filename: "broken.pdf" }),
    /valid PDF/i
  );
});

test("pdf: reports per-page progress", async () => {
  const calls = [];
  await pdf.parse({
    fileBuffer: await load("vendor-report.pdf"),
    filename: "vendor-report.pdf",
    onProgress: (p) => calls.push(p),
  });
  assert.deepEqual(calls, [{ page: 1, pages: 1 }]);
});

test("pdf: image-only PDF warns instead of failing", async () => {
  const buf = await load("scanned.pdf");
  const r = await pdf.parse({ fileBuffer: buf, filename: "scanned.pdf" });
  assert.ok(
    r.fidelity.warnings.some((w) => /scanned/i.test(w) && /no text layer/i.test(w)),
    "scanned warning present"
  );
  assert.ok(
    r.fidelity.warnings.some((w) => /upload the HTML/i.test(w)),
    "next-action message present"
  );
  assert.match(allText(r), /scanned/i);
});
