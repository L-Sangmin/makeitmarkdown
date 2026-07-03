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
};

test("qcChecks: five labelled checks, all passing on a clean result", () => {
  const checks = qcChecks(goodResult);
  assert.equal(checks.length, 5);
  for (const c of checks) {
    assert.equal(typeof c.label, "string");
    assert.equal(typeof c.note, "string");
    assert.equal(c.pass, true);
  }
  assert.equal(qcScore(goodResult), 1);
});

test("qcChecks: failures line up with the score fraction", () => {
  const bad = { ...goodResult, title: "", sections: [goodResult.sections[0]] };
  const checks = qcChecks(bad);
  const failed = checks.filter((c) => !c.pass);
  assert.equal(failed.length, 2); // title + section count
  assert.equal(qcScore(bad), 3 / 5);
});

test("countTokensExact: uses the o200k global and matches the library", () => {
  globalThis.GPTTokenizer_o200k_base = { encode };
  const md = "# Title\n\nSome **bold** text with a | table | cell |.";
  assert.equal(countTokensExact(md), encode(md).length);
  assert.ok(countTokensExact(md) > 0);
  delete globalThis.GPTTokenizer_o200k_base;
  assert.throws(() => countTokensExact("x"), /tokenizer not loaded/);
});
