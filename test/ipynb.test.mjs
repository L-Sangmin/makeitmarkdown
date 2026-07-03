import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import ipynb from "../public/assets/js/parsers/ipynb.js";
import { renderDependencyDag } from "../public/assets/js/ipynb-dag.js";
import { formatStandard } from "../public/assets/js/standard-formatter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, "fixtures", name);

async function parseFixture(name) {
  const buf = await readFile(fixture(name));
  return ipynb.parse({ fileBuffer: buf, filename: name });
}

const sectionByHeading = (result, needle) =>
  result.sections.find((s) => s.heading.includes(needle));

// --- canHandle -------------------------------------------------------------

test("canHandle accepts .ipynb filenames only", () => {
  assert.equal(ipynb.canHandle(null, null, "analysis.ipynb"), true);
  assert.equal(ipynb.canHandle(null, null, "ANALYSIS.IPYNB"), true);
  assert.equal(ipynb.canHandle(null, null, "analysis.docx"), false);
  assert.equal(ipynb.canHandle(null, null, undefined), false);
});

// --- basic schema ----------------------------------------------------------

test("parses clean notebook into the shared schema", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  assert.equal(r.title, "Sales Analysis");
  assert.equal(r.meta.sourceFormat, "ipynb");
  // 1 overview section + 8 cells
  assert.equal(r.sections.length, 9);
  assert.ok(r.fidelity);
  assert.equal(r.fidelity.detected.codeCells, 5);
});

test("code cell headings follow 'Cell [n] · type:code · id:…' format", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const s = sectionByHeading(r, "Cell [2]");
  assert.ok(s, "section for execution count 2 exists");
  assert.equal(s.heading, "Cell [2] · type:code · id:bb22cc33");
  assert.equal(s.level, 2);
  assert.match(s.content, /```python\n/);
  assert.match(s.content, /df = pd\.read_csv/);
});

test("markdown cells keep their content under a cell heading", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const s = r.sections.find((x) => x.heading.includes("type:markdown"));
  assert.ok(s);
  assert.match(s.content, /Monthly revenue overview/);
});

// --- dependency hints -------------------------------------------------------

test("emits approximate dependency hints between cells", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const c3 = sectionByHeading(r, "Cell [3]");
  assert.match(c3.content, /> ⚠️ depends on: `df` \(defined in Cell \[2\]\)/);
  const c5 = sectionByHeading(r, "Cell [5]");
  assert.match(c5.content, /`monthly` \(defined in Cell \[4\]\)/);
});

test("overview section labels hints as approximate, not full dataflow", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  assert.match(r.sections[0].content, /approximate cell dependency hints/i);
});

test("does not invent dependencies for names defined in the same cell", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const c5 = sectionByHeading(r, "Cell [5]");
  // fig/ax/plt defined locally in cell 5 — only `monthly` is external
  assert.doesNotMatch(c5.content, /`fig`/);
  assert.doesNotMatch(c5.content, /`plt` \(defined/);
});

// --- execution order --------------------------------------------------------

test("flags decreasing execution_count as execution-order change", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const c2 = sectionByHeading(r, "Cell [2]");
  assert.match(c2.content, /execution order changed/i);
  assert.ok(
    r.fidelity.warnings.some((w) => /execution order/i.test(w)),
    "fidelity carries an execution-order warning"
  );
});

test("clean notebook has no execution-order warnings", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  assert.ok(!r.fidelity.warnings.some((w) => /execution order/i.test(w)));
});

test("flags variables used before their defining cell ran", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  assert.ok(
    r.fidelity.warnings.some((w) => /totals/.test(w) && /Cell \[2\]/.test(w)),
    "forward-use of `totals` in Cell [2] warned"
  );
});

test("unexecuted code cells get a position-based label", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const s = r.sections.find((x) => x.heading.includes("not executed"));
  assert.ok(s);
  assert.match(s.heading, /^Cell \[p5\] · type:code \(not executed\)/);
});

// --- outputs -----------------------------------------------------------------

test("maps image/png outputs to figure placeholders and figures[]", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const c5 = sectionByHeading(r, "Cell [5]");
  assert.match(c5.content, /\[Figure: cell_5_output_1\.png\]/);
  assert.equal(r.figures.length, 1);
  assert.equal(r.figures[0].id, "cell_5_output_1");
  assert.ok(r.figures[0].url.startsWith("data:image/png;base64,"));
  assert.match(r.figures[0].caption, /Cell \[5\]/);
  assert.equal(r.fidelity.detected.figures, 1);
  assert.equal(r.fidelity.recovered.figures, 1);
});

test("truncates long text outputs and says so", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const c5 = sectionByHeading(r, "Cell [5]");
  assert.match(c5.content, /truncated/i);
  const rows = c5.content.split("\n").filter((l) => l.startsWith("row "));
  assert.ok(rows.length <= 30, `kept ${rows.length} rows`);
  assert.ok(r.fidelity.warnings.some((w) => /truncat/i.test(w)));
});

test("outputs containing ``` get a longer fence", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const c2 = sectionByHeading(r, "Cell [2]");
  assert.match(c2.content, /````/);
});

// --- fidelity / QC ------------------------------------------------------------

test("clean notebook scores qc >= 0.8", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  assert.ok(r.fidelity.qcScore >= 0.8, `qcScore ${r.fidelity.qcScore}`);
  assert.ok(r.fidelity.qcScore <= 1);
});

// --- notebook block for the DAG -------------------------------------------------

test("exposes edges keyed by cell position with variable names", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const edges = r.notebook.edges.map((e) => `${e.from}->${e.to}:${e.vars.join(",")}`);
  assert.ok(edges.includes("3->5:df"), `df edge present in ${edges}`);
  assert.ok(edges.includes("6->7:monthly"), `monthly edge present in ${edges}`);
});

// --- module aliases are ambient, not dataflow ---------------------------------

function inlineNb(cells) {
  return JSON.stringify({
    cells,
    metadata: { language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  });
}

const codeCell = (id, n, source, outputs = []) => ({
  cell_type: "code", id, execution_count: n, metadata: {}, source, outputs,
});

test("f-string prefixes do not become phantom identifiers", async () => {
  const doc = inlineNb([
    codeCell("x1", 1, 'msg = f"hello {1 + 1}"\n'),
    codeCell("x2", 2, "print(msg)\n"),
    codeCell("x3", 3, 'with open("data.txt") as f:\n    pass\n'),
  ]);
  const r = await ipynb.parse({ doc, filename: "t.ipynb" });
  assert.ok(!r.fidelity.warnings.some((w) => w.includes("`f`")), "no phantom `f` warning");
  const edges = r.notebook.edges.map((e) => e.vars.join(","));
  assert.deepEqual(edges, ["msg"]);
});

test("pure reassignment is not a dependency on the earlier value", async () => {
  const doc = inlineNb([
    codeCell("r1", 1, "x = 1\n"),
    codeCell("r2", 2, "x = 2\n"), // overwrites, never reads
    codeCell("r3", 3, "x = x + 1\n"), // reads then writes
  ]);
  const r = await ipynb.parse({ doc, filename: "t.ipynb" });
  const edges = r.notebook.edges.map((e) => `${e.from}->${e.to}:${e.vars.join(",")}`);
  assert.deepEqual(edges, ["2->3:x"]);
});

test("module import aliases are excluded from hints, edges and warnings", async () => {
  const doc = inlineNb([
    codeCell("m1", 2, "arr = np.zeros(3)\n"), // np used before its import ran
    codeCell("m2", 3, "import numpy as np\n"),
    codeCell("m3", 4, "total = arr.sum()\n"),
  ]);
  const r = await ipynb.parse({ doc, filename: "t.ipynb" });
  assert.equal(r.notebook.edges.length, 1);
  assert.deepEqual(r.notebook.edges[0].vars, ["arr"]);
  assert.ok(
    !r.fidelity.warnings.some((w) => w.includes("`np`")),
    "no forward-use warning for module alias"
  );
  const c4 = sectionByHeading(r, "Cell [4]");
  assert.doesNotMatch(c4.content, /`np`/);
});

test("overview lists import aliases as excluded", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  assert.match(r.sections[0].content, /Imports.*`pd`.*`plt`/s);
  assert.match(r.sections[0].content, /excluded from dependency hints/);
});

test("caps forward-use warnings at 10 with an aggregate line", async () => {
  const uses = Array.from({ length: 12 }, (_, i) => `print(v${i})`).join("\n");
  const defs = Array.from({ length: 12 }, (_, i) => `v${i} = ${i}`).join("\n");
  const doc = inlineNb([codeCell("a", 1, uses + "\n"), codeCell("b", 2, defs + "\n")]);
  const r = await ipynb.parse({ doc, filename: "t.ipynb" });
  const fw = r.fidelity.warnings.filter((w) => /earlier run/.test(w));
  assert.equal(fw.length, 10);
  assert.ok(r.fidelity.warnings.some((w) => /\+2 more/.test(w)));
});

// --- DAG SVG ---------------------------------------------------------------------

test("renders dependency chain as inline SVG", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const svg = renderDependencyDag(r.notebook);
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /viewBox/);
  for (const label of ["In[2]", "In[3]", "In[4]", "In[5]"]) {
    assert.ok(svg.includes(label), `${label} node present`);
  }
  assert.ok(!svg.includes("In[1]"), "pure-import cell stays out of the DAG");
  assert.ok(svg.includes(">df<") || /df/.test(svg), "df arc label present");
  assert.match(svg, /approximate/i);
});

test("DAG arc labels cap at three variable names", () => {
  const notebook = {
    cells: [
      { position: 1, display: "In[1]", type: "code", execCount: 1 },
      { position: 2, display: "In[2]", type: "code", execCount: 2 },
    ],
    edges: [{ from: 1, to: 2, vars: ["a", "b", "c", "d", "e"] }],
    execOrderFlags: [],
  };
  const svg = renderDependencyDag(notebook);
  assert.ok(svg.includes("a, b, c +2"), "capped label present");
  assert.ok(!svg.includes(">a, b, c, d, e<"), "full list not rendered");
});

test("DAG marks out-of-order cells", async () => {
  const r = await parseFixture("out-of-order.ipynb");
  const svg = renderDependencyDag(r.notebook);
  assert.ok(svg.includes("⚠"), "warning marker present");
});

test("DAG with no edges says so instead of rendering nothing", () => {
  const svg = renderDependencyDag({ cells: [], edges: [] });
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /no cross-cell dependencies/i);
});

function bigNotebook(nNodes, edgesPerNode = 2) {
  const cells = Array.from({ length: nNodes }, (_, i) => ({
    position: i + 1, display: `In[${i + 1}]`, type: "code", execCount: i + 1,
  }));
  const edges = [];
  for (let to = 2; to <= nNodes; to++) {
    for (let k = 1; k <= edgesPerNode && to - k >= 1; k++) {
      edges.push({ from: to - k, to, vars: [`v${to}`] });
    }
  }
  return { cells, edges, execOrderFlags: [] };
}

test("dense graphs drop per-arc labels but keep the arcs", () => {
  const svg = renderDependencyDag(bigNotebook(20));
  // arcs still drawn
  assert.ok((svg.match(/<path /g) ?? []).length > 5);
  // no variable labels (would be v2, v3, …)
  assert.ok(!/>v\d+</.test(svg), "arc var labels suppressed when dense");
});

test("large graphs cap the node count and say how many of how many", () => {
  const svg = renderDependencyDag(bigNotebook(60));
  const nodeCount = (svg.match(/In\[\d+\]/g) ?? []).length;
  assert.ok(nodeCount <= 16, `capped to ${nodeCount} nodes`);
  assert.match(svg, /of 60 cells/i);
});

test("small graphs are not capped and keep labels", () => {
  const svg = renderDependencyDag(bigNotebook(5, 1));
  assert.ok((svg.match(/In\[\d+\]/g) ?? []).length === 5);
  assert.ok(/>v\d+</.test(svg), "labels kept when sparse");
  assert.doesNotMatch(svg, /of \d+ cells/i);
});

// --- standard formatter ------------------------------------------------------------

test("formatStandard assembles title + cell sections", async () => {
  const r = await parseFixture("sales-analysis.ipynb");
  const mdOut = formatStandard(r);
  assert.match(mdOut, /^# Sales Analysis\n/);
  assert.match(mdOut, /\n## Cell \[2\] · type:code · id:bb22cc33\n/);
  assert.match(mdOut, /\*\*Output:\*\*/);
});

// --- real-world hard case (skipped if file absent) -----------------------------------

const REAL = "/Volumes/Samsung SSD 860 EVO/MakeitMarkdown/test_data/team31_notebook.ipynb";

test("parses a 3.5MB 110-cell real notebook", { skip: !existsSync(REAL) }, async () => {
  const buf = await readFile(REAL);
  const r = await ipynb.parse({ fileBuffer: buf, filename: "team31_notebook.ipynb" });
  assert.equal(r.sections.length, 111); // overview + 110 cells
  assert.equal(r.fidelity.detected.codeCells, 67);
  assert.equal(r.fidelity.detected.figures, 7);
  assert.ok(r.fidelity.qcScore > 0);
  const svg = renderDependencyDag(r.notebook);
  assert.ok(svg.startsWith("<svg"));
});
