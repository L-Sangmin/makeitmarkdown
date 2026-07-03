import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

const { buildOcrResult } = await import("../public/assets/js/ocr.js");

test("ocr: vendored engine + language recognize a rendered text image", { timeout: 60000 }, async () => {
  const png = await readFile(new URL("./fixtures/ocr-hello.png", import.meta.url));
  const worker = await createWorker("eng", 1, {
    langPath: fileURLToPath(new URL("../public/assets/vendor/ocr/", import.meta.url)),
    gzip: false,
    cacheMethod: "none",
  });
  try {
    const { data } = await worker.recognize(png);
    const text = data.text.toUpperCase();
    assert.match(text, /HELLO WORLD/);
    assert.match(text, /42/);
  } finally {
    await worker.terminate();
  }
});

test("ocr: result assembly caps QC and states approximation", () => {
  const base = { title: "scan", meta: { sourceFormat: "pdf" }, sections: [], tables: [], figures: [] };
  const r = buildOcrResult(base, ["Recognized text", ""]);
  assert.equal(r.sections.length, 2);
  assert.match(r.sections[0].heading, /Page 1 \(OCR\)/);
  assert.match(r.sections[1].content, /No text recognized/);
  assert.ok(r.fidelity.warnings.some((w) => /approximate/.test(w)));
  assert.equal(r.fidelity.qcScore, 0.6);
  assert.equal(r.meta.ocr, true);
});
