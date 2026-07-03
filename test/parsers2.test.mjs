import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as XLSX from "xlsx";
globalThis.XLSX = XLSX;

import xlsx from "../public/assets/js/parsers/xlsx.js";
import json from "../public/assets/js/parsers/json.js";
import subtitles from "../public/assets/js/parsers/subtitles.js";
import text from "../public/assets/js/parsers/text.js";
import { findParser } from "../public/assets/js/parsers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => readFile(path.join(here, "fixtures", name));
const allText = (r) => r.sections.map((s) => `${s.heading}\n${s.content}`).join("\n");

// --- registry ---------------------------------------------------------------

test("registry routes the new extensions", () => {
  assert.equal(findParser(null, null, "a.xlsx"), xlsx);
  assert.equal(findParser(null, null, "a.xls"), xlsx);
  assert.equal(findParser(null, null, "a.json"), json);
  assert.equal(findParser(null, null, "a.jsonl"), json);
  assert.equal(findParser(null, null, "a.srt"), subtitles);
  assert.equal(findParser(null, null, "a.vtt"), subtitles);
  assert.equal(findParser(null, null, "a.md"), text);
  assert.equal(findParser(null, null, "a.txt"), text);
});

// --- xlsx ---------------------------------------------------------------------

test("xlsx: one section per sheet with GFM tables", async () => {
  const r = await xlsx.parse({ fileBuffer: await load("orders.xlsx"), filename: "orders.xlsx" });
  assert.equal(r.meta.sourceFormat, "xlsx");
  assert.equal(r.title, "orders");
  assert.ok(r.sections.some((s) => s.heading.includes("Orders")));
  assert.ok(r.sections.some((s) => s.heading.includes("Summary")));
  const t = allText(r);
  assert.match(t, /\| order_id \| date \| region \|/);
  assert.match(t, /\| 1001 \| 2026-01-05 \| North \|/); // dates → ISO, not serials
  assert.match(t, /pipe\\\|in\\\|note/); // pipes escaped
  assert.equal(r.fidelity.detected.tables, 2); // two sheets carry data
  assert.equal(r.fidelity.recovered.tables, 2);
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("xlsx: formulas use cached values, empty sheets get a note", async () => {
  const r = await xlsx.parse({ fileBuffer: await load("orders.xlsx"), filename: "orders.xlsx" });
  const t = allText(r);
  assert.match(t, /\| 79 \|/); // D4 cached formula value
  assert.ok(
    r.fidelity.warnings.some((w) => /Empty.*no data|empty/i.test(w)),
    "empty sheet warned"
  );
});

test("xlsx: corrupt workbook rejects with a friendly message", async () => {
  await assert.rejects(
    xlsx.parse({ fileBuffer: Buffer.from("not a zip"), filename: "x.xlsx" }),
    /valid Excel|couldn't read/i
  );
});

// --- json / jsonl ----------------------------------------------------------------

test("json: structure outline + pretty body", async () => {
  const r = await json.parse({ fileBuffer: await load("config.json"), filename: "config.json" });
  assert.equal(r.meta.sourceFormat, "json");
  const t = allText(r);
  assert.match(t, /`retry\.backoff_ms`\s+—\s+array\[3\] of number/);
  assert.match(t, /`steps`\s+—\s+array\[3\] of object/);
  assert.match(t, /`notes`\s+—\s+null/);
  assert.match(t, /"name": "fulfillment-pipeline"/); // pretty-printed body
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("json: BOM tolerated", async () => {
  const r = await json.parse({ fileBuffer: await load("bom.json"), filename: "bom.json" });
  assert.match(allText(r), /"bom": "present"/);
});

test("json: invalid document rejects with position info", async () => {
  await assert.rejects(
    json.parse({ doc: '{"a": 1,,}', filename: "bad.json" }),
    /isn't valid JSON/i
  );
});

test("jsonl: uniform records become a GFM table, bad lines warned", async () => {
  const r = await json.parse({ fileBuffer: await load("api-log.jsonl"), filename: "api-log.jsonl" });
  const t = allText(r);
  assert.match(t, /\| ts \| route \| ms \| ok \|/);
  assert.match(t, /\| 2026-03-01T10:00:12Z \| \/convert \| 1204 \| false \|/);
  assert.ok(
    r.fidelity.warnings.some((w) => /1 line.*not valid JSON.*skipped/i.test(w)),
    "bad line warned"
  );
  assert.equal(r.fidelity.detected.tables, 1);
});

// --- subtitles ----------------------------------------------------------------------

test("srt: transcript with timestamps, tags stripped, garbage skipped", async () => {
  const r = await subtitles.parse({ fileBuffer: await load("talk.srt"), filename: "talk.srt" });
  assert.equal(r.meta.sourceFormat, "subtitles");
  const t = allText(r);
  assert.match(t, /\[00:01\] Welcome back\. Today we cover the planning cadence for small teams\./);
  assert.match(t, /three meetings/);
  assert.ok(!t.includes("<i>"), "inline tags stripped");
  assert.ok(!/garbage block/.test(t), "malformed block skipped");
  assert.ok(r.fidelity.warnings.some((w) => /1 block.*skipped/i.test(w)));
  assert.match(t, /3 cues/);
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("vtt: WEBVTT header and cue settings handled", async () => {
  const r = await subtitles.parse({ fileBuffer: await load("talk.vtt"), filename: "talk.vtt" });
  const t = allText(r);
  assert.match(t, /\[00:01\] Welcome back\. Today we cover the planning cadence\./);
  assert.match(t, /five working days/);
  assert.ok(!t.includes("align:start"), "cue settings stripped");
  assert.ok(!t.includes("<b>"), "tags stripped");
});

// --- text / markdown -----------------------------------------------------------------

test("md: passthrough with sections and title from H1", async () => {
  const r = await text.parse({ fileBuffer: await load("notes.md"), filename: "notes.md" });
  assert.equal(r.title, "Planning notes");
  assert.ok(r.sections.some((s) => s.heading === "What worked"));
  assert.match(allText(r), /- Written memo before the meeting/);
  assert.ok(r.fidelity.qcScore >= 0.8, `qc ${r.fidelity.qcScore}`);
});

test("txt: verbatim content with an overview", async () => {
  const r = await text.parse({ fileBuffer: await load("plain.txt"), filename: "plain.txt" });
  assert.equal(r.title, "plain");
  const t = allText(r);
  assert.match(t, /4 lines/);
  assert.match(t, /line four after a blank/);
});

test("text: empty file rejects instead of emitting nothing", async () => {
  await assert.rejects(
    text.parse({ doc: "   \n  \n", filename: "empty.txt" }),
    /empty/i
  );
});
