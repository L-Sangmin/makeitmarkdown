import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// minimal localStorage shim
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { loadHistory, saveToHistory, clearHistory, HISTORY_LIMIT } = await import(
  "../public/assets/js/history.js"
);

const payload = (name, mdSize = 100) => ({
  filename: name,
  markdown: "x".repeat(mdSize),
  result: {
    title: name,
    sections: [{ heading: "Overview", level: 2, content: "hi" }],
    figures: [{ id: "f1", caption: "c", url: "data:image/png;base64,AAAA", alt: "" }],
    tables: [],
    fidelity: { detected: {}, recovered: {}, warnings: [], qcScore: 1 },
    meta: { sourceFormat: "csv" },
    notebook: null,
  },
});

beforeEach(() => store.clear());

test("saves and loads entries, newest first", () => {
  saveToHistory(payload("a.csv"), "standard");
  saveToHistory(payload("b.csv"), "chat");
  const h = loadHistory();
  assert.equal(h.length, 2);
  assert.equal(h[0].filename, "b.csv");
  assert.equal(h[0].preset, "chat");
  assert.ok(h[0].ts > 0);
});

test("keeps at most the limit, drops oldest", () => {
  for (let i = 0; i < HISTORY_LIMIT + 3; i++) saveToHistory(payload(`f${i}.csv`), "standard");
  const h = loadHistory();
  assert.equal(h.length, HISTORY_LIMIT);
  assert.equal(h[0].filename, `f${HISTORY_LIMIT + 2}.csv`);
});

test("strips figure binaries before storing", () => {
  saveToHistory(payload("a.csv"), "standard");
  const h = loadHistory();
  assert.equal(h[0].result.figures[0].url, "");
  assert.equal(h[0].result.figures[0].id, "f1");
});

test("oversized results are skipped without throwing", () => {
  assert.equal(saveToHistory(payload("huge.csv", 900_000), "standard"), false);
  assert.equal(loadHistory().length, 0);
});

test("re-saving the same filename replaces the old entry", () => {
  saveToHistory(payload("a.csv"), "standard");
  saveToHistory(payload("a.csv"), "rag");
  const h = loadHistory();
  assert.equal(h.length, 1);
  assert.equal(h[0].preset, "rag");
});

test("clearHistory empties and corrupted storage loads as empty", () => {
  saveToHistory(payload("a.csv"), "standard");
  clearHistory();
  assert.deepEqual(loadHistory(), []);
  localStorage.setItem("mim-history", "{corrupt");
  assert.deepEqual(loadHistory(), []);
});
