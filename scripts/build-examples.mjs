// Build-time generator for /examples — static before/after pages per sample.
// Run: node scripts/build-examples.mjs   (commit the output)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import * as turndownPluginGfm from "turndown-plugin-gfm";
import { Readability } from "@mozilla/readability";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

globalThis.DOMParser = new JSDOM("").window.DOMParser;
globalThis.TurndownService = TurndownService;
globalThis.turndownPluginGfm = turndownPluginGfm;
globalThis.Readability = Readability;
globalThis.mammoth = mammoth;
globalThis.pdfjsLib = pdfjsLib;
globalThis.XLSX = XLSX;

const { findParser } = await import("../public/assets/js/parsers/index.js");
const { formatStandard } = await import("../public/assets/js/standard-formatter.js");

const SAMPLES = [
  {
    file: "sales-analysis.ipynb",
    sampleKey: "sales-analysis",
    slug: "ipynb-to-markdown",
    title: "Jupyter notebook → LLM-ready Markdown",
    blurb: "Cell addresses, dependency hints and figure placeholders from a pandas + matplotlib notebook.",
    keywords: "ipynb to markdown llm, jupyter notebook llm context",
  },
  {
    file: "out-of-order.ipynb",
    sampleKey: "out-of-order",
    slug: "notebook-execution-order",
    title: "Out-of-order notebook, caught and flagged",
    blurb: "Execution-order warnings and stale-state detection on a messy notebook.",
    keywords: "jupyter execution order, notebook reproducibility llm",
  },
  {
    file: "q1-operations-review.docx",
    sampleKey: "docx",
    slug: "docx-to-markdown",
    title: "Word document → Markdown with heading semantics",
    blurb: "Styles map to real headings; the table survives as GFM.",
    keywords: "docx to markdown, word to markdown llm",
  },
  {
    file: "sales.csv",
    sampleKey: "sales-csv",
    slug: "csv-for-llm",
    title: "CSV → typed table for LLM context",
    blurb: "Column types annotated, truncation explicit, pipes escaped.",
    keywords: "csv to markdown llm, feed csv to chatgpt",
  },
  {
    file: "article.html",
    sampleKey: "article",
    slug: "html-article-to-markdown",
    title: "Web article → clean Markdown",
    blurb: "Navigation and ads stripped; the article, its table and figures kept.",
    keywords: "html to markdown clean, readability to markdown",
  },
  {
    file: "vendor-report.pdf",
    sampleKey: "pdf",
    slug: "pdf-to-markdown",
    title: "PDF → Markdown, with honest limits",
    blurb: "Per-page text extraction with the layout-lossy disclaimer attached.",
    keywords: "pdf to markdown llm, clean pdf for rag",
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = ({ title, description, body }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${esc(title)} — MakeItMarkdown examples</title>
  <meta name="description" content="${esc(description)}" />
  <script>try{var t=localStorage.getItem("mim-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
  <link rel="stylesheet" href="/assets/css/main.css" />
  <link rel="stylesheet" href="/assets/css/article.css" />
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/">MakeItMarkdown</a>
    <a class="wordmark" style="font-weight:500;color:var(--fg-muted)" href="/examples/">Examples</a>
  </header>
  <div class="article-wrap">
  ${body}
  </div>
</body>
</html>
`;

await mkdir("public/examples", { recursive: true });
const cards = [];

for (const s of SAMPLES) {
  const buf = await readFile(`public/assets/samples/${s.file}`);
  const parser = findParser(null, null, s.file);
  const result = await parser.parse({ fileBuffer: buf, filename: s.file });
  const md = formatStandard(result);
  const d = result.fidelity.detected;
  const shownMd = md.length > 7000 ? `${md.slice(0, 7000)}\n… (${md.length - 7000} more characters — convert it yourself for the full output)` : md;

  const body = `
    <p class="article-kicker">Example · ${esc(s.file)}</p>
    <article>
      <h1>${esc(s.title)}</h1>
      <p class="article-byline">${esc(s.blurb)}</p>
      <table>
        <tr><th>QC score</th><th>Tables</th><th>Figures</th><th>Code cells</th><th>Output size</th></tr>
        <tr><td>${Math.round(result.fidelity.qcScore * 100)}%</td><td>${d.tables}</td><td>${d.figures}</td><td>${d.codeCells}</td><td>${md.length.toLocaleString("en-US")} chars ≈ ${Math.round(md.length / 4).toLocaleString("en-US")} tokens</td></tr>
      </table>
      ${result.fidelity.warnings.length ? `<h2>Fidelity warnings</h2><ul>${result.fidelity.warnings.slice(0, 6).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <h2>Converted Markdown</h2>
      <pre><code>${esc(shownMd)}</code></pre>
      <div class="article-cta">
        <p>Run this conversion live — or drop your own file. Everything stays in your browser.</p>
        <a href="/?sample=${esc(s.sampleKey)}">Open in the tool →</a>
      </div>
      <p class="article-footer">Keywords: ${esc(s.keywords)} · <a href="/examples/">All examples</a></p>
    </article>`;

  await writeFile(
    `public/examples/${s.slug}.html`,
    page({ title: s.title, description: s.blurb, body })
  );
  cards.push(
    `<li><a class="post-card" href="/examples/${s.slug}.html"><h2>${esc(s.title)}</h2><p>${esc(s.blurb)}</p><span class="post-date">${esc(s.file)} · QC ${Math.round(result.fidelity.qcScore * 100)}%</span></a></li>`
  );
  console.log("built", s.slug, `(qc ${result.fidelity.qcScore})`);
}

await writeFile(
  "public/examples/index.html",
  page({
    title: "Conversion examples",
    description: "Before/after conversions for every supported format — notebooks, Word, CSV, HTML articles and PDFs into LLM-ready Markdown.",
    body: `<article><h1>Examples</h1><p class="article-byline">Real conversions of the built-in samples — what goes in, what comes out, and what the fidelity report says.</p><ul class="post-list">${cards.join("\n")}</ul><p class="article-footer">All conversion happens in your browser. <a href="/">Open the tool</a> · <a href="/blog/">Writing</a> · <a href="/about.html">About</a> · <a href="/privacy.html">Privacy</a> · <a href="/contact.html">Contact</a></p></article>`,
  })
);
console.log("built index —", SAMPLES.length, "examples");
