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
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227%22%20fill%3D%22%234f46e5%22%2F%3E%3Ctext%20x%3D%2213%22%20y%3D%2222.5%22%20font-family%3D%22ui-monospace%2CMenlo%2Cmonospace%22%20font-size%3D%2216%22%20font-weight%3D%22700%22%20fill%3D%22white%22%20text-anchor%3D%22middle%22%3EM%3C%2Ftext%3E%3Cpath%20d%3D%22M24%2012v7.5m0%200l-3.4-3.4m3.4%203.4l3.4-3.4%22%20stroke%3D%22white%22%20stroke-width%3D%222.4%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20fill%3D%22none%22%2F%3E%3C%2Fsvg%3E" />
  <title>${esc(title)} — MakeItMarkdown examples</title>
  <meta name="description" content="${esc(description)}" />
  <script>try{var t=localStorage.getItem("mim-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
  <link rel="stylesheet" href="/assets/css/main.css" />
  <link rel="stylesheet" href="/assets/css/article.css" />
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/">MakeItMarkdown</a>
    <span class="bar-spacer"></span>
    <a class="wordmark" style="font-weight:500;color:var(--fg-muted)" href="/examples/">Examples</a>
    <button class="theme-toggle" type="button" aria-label="Toggle color theme" onclick="(function(){var r=document.documentElement,c=r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=c==='dark'?'light':'dark';r.dataset.theme=n;try{localStorage.setItem('mim-theme',n)}catch(e){}})()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>
    </button>
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
    body: `<article><h1>Examples</h1><p class="article-byline">Real conversions of the built-in samples — what goes in, what comes out, and what the fidelity report says.</p><ul class="post-list">${cards.join("\n")}</ul><p class="article-footer">All conversion happens in your browser. <a href="/">Open the tool</a> · <a href="/blog/">Context Lab</a> · <a href="/about.html">About</a> · <a href="/privacy.html">Privacy</a> · <a href="/contact.html">Contact</a></p></article>`,
  })
);
console.log("built index —", SAMPLES.length, "examples");
