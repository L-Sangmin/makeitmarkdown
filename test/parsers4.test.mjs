import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import * as turndownPluginGfm from "turndown-plugin-gfm";

globalThis.DOMParser = new JSDOM("").window.DOMParser;
globalThis.TurndownService = TurndownService;
globalThis.turndownPluginGfm = turndownPluginGfm;

const { tex } = await import("../public/assets/js/parsers/tex.js");
const { mbox } = await import("../public/assets/js/parsers/mbox.js");
const { findParser } = await import("../public/assets/js/parsers/index.js");
const FIXTURES = new URL("./fixtures/", import.meta.url);

test("tex: title, authors, abstract, section outline", async () => {
  const buf = await readFile(new URL("paper.tex", FIXTURES));
  const r = await tex.parse({ fileBuffer: buf, filename: "paper.tex" });
  assert.equal(r.title, "Throughput Analysis of Regional Fulfillment");
  assert.deepEqual(r.authors, ["Jordan Lee", "Sam Park"]);
  assert.match(r.abstract, /\*\*4%\*\* cost increase/);
  const heads = r.sections.map((s) => s.heading);
  assert.deepEqual(heads, ["Abstract", "Introduction", "Method", "Results", "References"]);
});

test("tex: equations fenced, tabular → GFM, figure placeholder, cite/ref mapped", async () => {
  const buf = await readFile(new URL("paper.tex", FIXTURES));
  const r = await tex.parse({ fileBuffer: buf, filename: "paper.tex" });
  const method = r.sections.find((s) => s.heading === "Method").content;
  assert.match(method, /\$\$\nT = \\frac\{U\}\{\\Delta t\} \\cdot \\eta\n\$\$/);
  assert.match(method, /^- Collect unit counts per region$/m);
  assert.equal(r.fidelity.detected.equations, 1);
  const results = r.sections.find((s) => s.heading === "Results").content;
  assert.match(results, /\| Region \| Units \| Avg days \|/);
  assert.match(results, /\[Figure: throughput\.png\]/);
  const intro = r.sections.find((s) => s.heading === "Introduction").content;
  assert.match(intro, /\[lee2024\]/);
  assert.match(intro, /\(ref: sec:results\)/);
  assert.ok(r.fidelity.warnings.some((w) => /macros are not expanded/.test(w)));
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("mbox: split into messages, quotes truncated, honest title", async () => {
  const buf = await readFile(new URL("team.mbox", FIXTURES));
  const r = await mbox.parse({ fileBuffer: buf, filename: "team.mbox" });
  assert.equal(r.title, "team — 2 messages");
  assert.equal(r.sections.length, 2);
  assert.match(r.sections[0].heading, /Message 1 · Kickoff/);
  assert.match(r.sections[1].heading, /Message 2 · Re: Kickoff/);
  assert.match(r.sections[1].content, /more quoted lines truncated/);
  assert.ok(r.fidelity.warnings.some((w) => /quoted reply chains truncated in 1 message/.test(w)));
});

test("registry routes .tex and .mbox", () => {
  assert.equal(findParser(null, null, "paper.tex")?.name, "tex");
  assert.equal(findParser(null, null, "archive.mbox")?.name, "mbox");
});
