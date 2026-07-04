import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "gpt-tokenizer";

import { qcChecks, qcScore, countTokensExact } from "../public/assets/js/md-utils.js";

const goodResult = {
  title: "Quarterly report",
  sections: [
    { heading: "Intro", level: 2, content: "clean" },
    { heading: "Middle", level: 2, content: "clean" },
    { heading: "End", level: 2, content: "clean" },
  ],
  figures: [{ id: "f1", url: "x.png", caption: "chart" }],
  tables: [{ id: "t1", markdown: "| a |\n| --- |\n| 1 |" }],
  fidelity: {
    detected: { tables: 1, figures: 1, equations: 0, codeCells: 0 },
    recovered: { tables: 1, figures: 1, equations: 0, codeCells: 0 },
    warnings: [],
  },
};

test("qcChecks: weighted checks, all passing on a clean result", () => {
  const checks = qcChecks(goodResult);
  assert.equal(checks.length, 8);
  for (const c of checks) {
    assert.equal(typeof c.label, "string");
    assert.equal(typeof c.note, "string");
    assert.ok(c.weight >= 1);
    assert.equal(c.score, 1);
    assert.equal(c.pass, true);
  }
  assert.equal(qcScore(goodResult), 1);
});

test("qcScore: weighted partial credit — structure counts double", () => {
  // title lost (weight 1) and only 1 of 3 sections kept (structure weight 2
  // scores 0.3; content/noise checks stay full because the section is clean)
  const bad = { ...goodResult, title: "", sections: [goodResult.sections[0]] };
  const checks = qcChecks(bad);
  const title = checks.find((c) => c.label === "Title recovered");
  const structure = checks.find((c) => c.label === "Sectioned structure");
  assert.equal(title.score, 0);
  assert.equal(structure.score, 0.3);
  // weights: 1+2+1+2+1+1+1+1 = 10 → (0 + 0.3*2 + 7) / 10
  assert.equal(qcScore(bad), 0.76);
});

test("qcScore: loss warnings and dropped elements cost score", () => {
  const lossy = {
    ...goodResult,
    fidelity: {
      detected: { tables: 2, figures: 2, equations: 0, codeCells: 0 },
      recovered: { tables: 1, figures: 1, equations: 0, codeCells: 0 },
      warnings: [
        "3 attachment(s) listed by name, not extracted",
        "quoted reply chain truncated",
      ],
    },
  };
  const checks = qcChecks(lossy);
  const rec = checks.find((c) => c.label === "Elements recovered");
  const loss = checks.find((c) => c.label === "No loss reported");
  assert.equal(rec.score, 0.5);
  assert.equal(loss.score, 0.5);
  assert.ok(qcScore(lossy) < qcScore(goodResult));
});

test("qcChecks: replacement-character debris scales with dirty sections", () => {
  const noisy = {
    ...goodResult,
    sections: [
      { heading: "A", level: 2, content: "clean" },
      { heading: "B", level: 2, content: "br□□ken" },
      { heading: "C", level: 2, content: "clean" },
    ],
  };
  const noise = qcChecks(noisy).find((c) => c.label === "No extraction noise");
  assert.ok(Math.abs(noise.score - 2 / 3) < 1e-9);
  assert.equal(noise.pass, false);
});

test("countTokensExact: uses the o200k global and matches the library", () => {
  globalThis.GPTTokenizer_o200k_base = { encode };
  const md = "# Title\n\nSome **bold** text with a | table | cell |.";
  assert.equal(countTokensExact(md), encode(md).length);
  assert.ok(countTokensExact(md) > 0);
  delete globalThis.GPTTokenizer_o200k_base;
  assert.throws(() => countTokensExact("x"), /tokenizer not loaded/);
});
