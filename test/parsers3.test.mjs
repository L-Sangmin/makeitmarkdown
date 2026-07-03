import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import TurndownService from "turndown";
import * as turndownPluginGfm from "turndown-plugin-gfm";

globalThis.DOMParser = new JSDOM("").window.DOMParser;
globalThis.JSZip = JSZip;
globalThis.TurndownService = TurndownService;
globalThis.turndownPluginGfm = turndownPluginGfm;

const { pptx } = await import("../public/assets/js/parsers/pptx.js");
const { eml, truncateQuotedChains, decodeEncodedWords } = await import("../public/assets/js/parsers/eml.js");
const { findParser } = await import("../public/assets/js/parsers/index.js");

const FIXTURES = new URL("./fixtures/", import.meta.url);

// --- pptx --------------------------------------------------------------------

test("pptx: slides become titled sections in order", async () => {
  const buf = await readFile(new URL("quarterly-kickoff.pptx", FIXTURES));
  const r = await pptx.parse({ fileBuffer: buf, filename: "quarterly-kickoff.pptx" });
  assert.equal(r.title, "Quarterly Kickoff");
  assert.equal(r.sections.length, 3);
  assert.match(r.sections[0].heading, /^Slide 1 · Quarterly Kickoff/);
  assert.match(r.sections[1].heading, /^Slide 2 · Priorities/);
  assert.match(r.sections[2].heading, /^Slide 3 · Pipeline/);
});

test("pptx: bullets keep nesting, notes surface, furniture skipped", async () => {
  const buf = await readFile(new URL("quarterly-kickoff.pptx", FIXTURES));
  const r = await pptx.parse({ fileBuffer: buf, filename: "quarterly-kickoff.pptx" });
  const s2 = r.sections[1].content;
  assert.match(s2, /^- Ship the vendor consolidation$/m);
  assert.match(s2, /^ {2}- Finish contract review$/m);
  assert.match(s2, /\*\*Speaker notes:\*\* Emphasize the onboarding metric/);
  assert.ok(!/^- 2$/m.test(s2), "slide-number placeholder must not leak into notes");
});

test("pptx: table → GFM, image → extracted figure, chart → honest warning", async () => {
  const buf = await readFile(new URL("quarterly-kickoff.pptx", FIXTURES));
  const r = await pptx.parse({ fileBuffer: buf, filename: "quarterly-kickoff.pptx" });
  assert.equal(r.tables.length, 1);
  assert.match(r.tables[0].markdown, /\| region \| units \| revenue \|/);
  assert.match(r.tables[0].markdown, /\| North \| 1204 \| 96432.10 \|/);
  assert.equal(r.figures.length, 1);
  assert.match(r.figures[0].url, /^data:image\/png;base64,/);
  assert.match(r.sections[2].content, /\[Figure: slide_3_image_1\.png\]/);
  assert.ok(r.fidelity.warnings.some((w) => /1 chart detected/.test(w)));
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("pptx: registry routes .pptx", () => {
  assert.equal(findParser(null, null, "deck.pptx")?.name, "pptx");
});

// --- eml ---------------------------------------------------------------------

test("eml: headers decoded, plain part preferred, qp decoded", async () => {
  const buf = await readFile(new URL("team-thread.eml", FIXTURES));
  const r = await eml.parse({ fileBuffer: buf, filename: "team-thread.eml" });
  assert.equal(r.title, "Re: Vendor consolidation — next steps"); // RFC2047 B-encoded
  assert.match(r.sections[0].content, /\*\*From:\*\* Jordan Lee/);
  const body = r.sections[1].content;
  assert.match(body, /Agreed on both counts — let's lock the shortlist Friday\./); // =E2=80=94 decoded
  assert.ok(!/<html>/i.test(body), "plain part must win over html");
});

test("eml: long quoted chain truncated with an explicit note + warning", async () => {
  const buf = await readFile(new URL("team-thread.eml", FIXTURES));
  const r = await eml.parse({ fileBuffer: buf, filename: "team-thread.eml" });
  const body = r.sections[1].content;
  assert.match(body, /> … \(\d+ more quoted lines truncated\)/);
  assert.ok(r.fidelity.warnings.some((w) => /quoted reply chain truncated/.test(w)));
  // the newest message must be intact
  assert.match(body, /Contract review finished/);
});

test("eml: attachments listed, not extracted; QC solid", async () => {
  const buf = await readFile(new URL("team-thread.eml", FIXTURES));
  const r = await eml.parse({ fileBuffer: buf, filename: "team-thread.eml" });
  const att = r.sections.find((s) => s.heading === "Attachments");
  assert.ok(att, "attachments section exists");
  assert.match(att.content, /`criteria\.pdf`/);
  assert.ok(r.fidelity.warnings.some((w) => /1 attachment listed but not extracted/.test(w)));
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("eml: unit — encoded words and quote truncation", () => {
  assert.equal(decodeEncodedWords("=?UTF-8?Q?caf=C3=A9_notes?="), "café notes");
  const lines = Array.from({ length: 12 }, (_, i) => `> line ${i}`).join("\n");
  const { text, truncated } = truncateQuotedChains(`hello\n\n${lines}\n\nbye`);
  assert.equal(truncated, 4);
  assert.match(text, /> … \(4 more quoted lines truncated\)/);
  assert.match(text, /^hello$/m);
  assert.match(text, /^bye$/m);
});

test("eml: registry routes .eml", () => {
  assert.equal(findParser(null, null, "thread.eml")?.name, "eml");
});
