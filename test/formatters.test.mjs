import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import ipynb from "../public/assets/js/parsers/ipynb.js";
import { formatStandard } from "../public/assets/js/standard-formatter.js";
import { formatObsidian } from "../public/assets/js/obsidian-formatter.js";
import { PRESETS, formatWithPreset } from "../public/assets/js/presets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, "fixtures", name);

async function parseFixture(name) {
  const buf = await readFile(fixture(name));
  return ipynb.parse({ fileBuffer: buf, filename: name });
}

// A synthetic schema result: formatters must work on the schema alone,
// with no parser in sight.
function paperResult() {
  return {
    title: "A Study of Widgets",
    authors: ["A. Author", "B. Author"],
    abstract: "We study widgets.",
    sections: [
      { heading: "Abstract", level: 2, content: "We study widgets in depth." },
      { heading: "Methods", level: 2, content: "We counted widgets." },
      { heading: "Results", level: 2, content: "Widgets increased." },
      { heading: "Limitations", level: 2, content: "Only three widgets." },
      { heading: "References", level: 2, content: "1. Widget et al." },
    ],
    figures: [
      { id: "fig_1", caption: "Widget counts", url: "data:image/png;base64,AAAA", alt: "counts" },
    ],
    tables: [],
    references: [],
    doi: "10.1234/widgets",
    journal: "Journal of Widgets",
    year: 2026,
    fidelity: {
      detected: { tables: 0, figures: 1, equations: 0, codeCells: 0 },
      recovered: { tables: 0, figures: 1, equations: 0 },
      warnings: [],
      qcScore: 1,
    },
    meta: { sourceFormat: "html", parserVersion: "0.1.0", filename: "widgets.html" },
  };
}

// --- standard formatter options ---------------------------------------------

test("standard: default output is unchanged plain GFM", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const md = formatStandard(r);
  assert.match(md, /^# Sales Analysis\n/);
  assert.match(md, /\n## Cell \[2\] · type:code · id:bb22cc33\n/);
  assert.ok(!md.includes("<!--"), "no comments injected by default");
  assert.ok(!md.startsWith("---"), "no frontmatter by default");
});

test("chat preset: truncates long outputs and shows a token estimate", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const md = formatWithPreset(r, "chat");
  assert.match(md, /<!-- token estimate: ≈\d[\d,]* tokens \(.+\) -->/);
  const rows = md.split("\n").filter((l) => l.startsWith("row "));
  assert.ok(rows.length <= 12, `kept ${rows.length} output rows`);
  assert.match(md, /… \[\+\d+ more output lines\]/);
});

test("chat preset: does not touch source code blocks", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const md = formatWithPreset(r, "chat");
  assert.match(md, /import matplotlib\.pyplot as plt/); // code intact
});

test("rag preset: chunk comments + stable anchors per section", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const md = formatWithPreset(r, "rag");
  assert.match(md, /<!-- chunk: cell-2-type-code-id-bb22cc33 -->/);
  assert.match(md, /<a id="cell-2-type-code-id-bb22cc33"><\/a>/);
  // anchors are unique
  const anchors = [...md.matchAll(/<a id="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(new Set(anchors).size, anchors.length);
});

test("archive preset: full frontmatter, faithful body", () => {
  const md = formatWithPreset(paperResult(), "archive");
  assert.ok(md.startsWith("---\n"));
  assert.match(md, /title: "A Study of Widgets"/);
  assert.match(md, /authors:\n {2}- "A\. Author"\n {2}- "B\. Author"/);
  assert.match(md, /doi: "10\.1234\/widgets"/);
  assert.match(md, /journal: "Journal of Widgets"/);
  assert.match(md, /year: 2026/);
  assert.match(md, /source: "widgets\.html"/);
  assert.match(md, /\n## Methods\n/); // body unchanged
});

// --- obsidian formatter --------------------------------------------------------

test("obsidian: callout mapping per HANDOFF §7", () => {
  const md = formatObsidian(paperResult());
  assert.match(md, /^> \[!abstract\] Abstract$/m);
  assert.match(md, /^> \[!warning\] Methods$/m);
  assert.match(md, /^> \[!important\] Results$/m);
  assert.match(md, /^> \[!caution\] Limitations$/m);
  assert.match(md, /^> \[!quote\]- References$/m); // collapsed
  assert.match(md, /^> We study widgets in depth\.$/m); // content quoted
});

test("obsidian: unmatched headings stay plain sections", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const md = formatObsidian(r);
  assert.match(md, /\n## Cell \[2\] · type:code · id:bb22cc33\n/);
  assert.ok(!/\[!\w+\] Cell \[2\]/.test(md), "cells are not callouts");
});

test("obsidian: figure placeholders become wikilinks", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const md = formatObsidian(r);
  assert.ok(md.includes("![[figures/cell_5_output_1.png]]"), "wikilink present");
  assert.ok(!md.includes("[Figure: cell_5_output_1.png]"), "placeholder replaced");
});

test("obsidian: frontmatter with title and source", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  r.meta.filename = "sales-analysis.ipynb";
  const md = formatObsidian(r);
  assert.ok(md.startsWith("---\n"));
  assert.match(md, /title: "Sales Analysis"/);
  assert.match(md, /source: "sales-analysis\.ipynb"/);
  assert.match(md, /format: ipynb/);
});

// --- preset registry --------------------------------------------------------------

test("preset registry: five presets, unknown ids fall back to standard", async () => {
  assert.deepEqual(
    PRESETS.map((p) => p.id),
    ["standard", "chat", "rag", "obsidian", "archive"]
  );
  const r = await parseFixture("sales-analysis.ipynb");
  assert.equal(formatWithPreset(r, "nope"), formatStandard(r));
});
