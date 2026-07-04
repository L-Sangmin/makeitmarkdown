// Shared helpers for parsers that emit Markdown through Turndown, plus the
// QC score used by every parser's fidelity block (HANDOFF §16).
//
// Libraries resolve from globals: vendored UMD builds in the browser, the
// matching npm packages in Node tests.

export function makeTurndown() {
  const td = new globalThis.TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    hr: "---",
  });
  globalThis.turndownPluginGfm.gfm(td); // tables, strikethrough, task lists

  // <mim-fig>id</mim-fig> markers survive Turndown's bracket escaping —
  // parsers swap <img> nodes for these before conversion.
  td.addRule("mimFigure", {
    filter: (node) => node.nodeName === "MIM-FIG",
    replacement: (content) => `\n\n[Figure: ${content}]\n\n`,
  });
  return td;
}

// Split converted Markdown into schema sections on ATX headings.
// Preamble text before the first heading becomes a fallback section.
// Section levels are clamped to ≥2 so the document title stays the only H1.
export function splitMarkdownSections(markdown, fallbackHeading = "Document") {
  const sections = [];
  let heading = null;
  let level = 2;
  let buf = [];

  const flush = () => {
    const content = buf.join("\n").trim();
    if (heading === null && !content) {
      buf = [];
      return;
    }
    sections.push({ heading: heading ?? fallbackHeading, level: heading ? level : 2, content });
    buf = [];
  };

  for (const line of markdown.split("\n")) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flush();
      level = Math.max(2, m[1].length);
      heading = m[2];
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// Extract GFM table blocks (used to fill tables[] and recovered counts).
export function extractMdTables(markdown) {
  const tables = [];
  let current = [];
  for (const line of `${markdown}\n`.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      current.push(line.trim());
    } else {
      if (current.length >= 2) tables.push(current.join("\n"));
      current = [];
    }
  }
  return tables;
}

// The structural QC checks, individually labelled so the fidelity panel
// can show which ones passed. Each check scores 0..1 (partial credit) and
// carries a weight; qcScore is the weighted mean. Structure and element
// recovery weigh double — they are what "fidelity" means here.

// Warnings that describe actual content loss (vs. purely informational
// notes). Each one costs a quarter of the "No loss reported" check.
const LOSS_WARNING =
  /not extracted|not expanded|truncat|skipp|flatten|approximate|no text|showing the first|could not|failed/i;

export function qcChecks(r) {
  const sections = r.sections ?? [];
  const figures = r.figures ?? [];
  const tables = r.tables ?? [];
  const d = r.fidelity?.detected ?? {};
  const rec = r.fidelity?.recovered ?? {};

  const detectedTotal =
    (d.tables ?? 0) + (d.figures ?? 0) + (d.equations ?? 0) + (d.codeCells ?? 0);
  const recoveredTotal =
    (rec.tables ?? 0) + (rec.figures ?? 0) + (rec.equations ?? 0) + (rec.codeCells ?? 0);

  const frac = (num, den) => (den === 0 ? 1 : Math.min(1, num / den));
  const lossCount = (r.fidelity?.warnings ?? []).filter((w) => LOSS_WARNING.test(w)).length;
  const nonEmpty = sections.filter((s) => (s.content ?? "").trim().length > 0).length;
  const clean = sections.filter((s) => !/\?\?|□□|�/.test(s.content ?? "")).length;

  const checks = [
    {
      label: "Title recovered",
      weight: 1,
      score: (r.title?.length ?? 0) > 0 ? 1 : 0,
      note: "a real document title was found",
    },
    {
      label: "Sectioned structure",
      weight: 2,
      score: sections.length >= 3 ? 1 : sections.length === 2 ? 0.6 : sections.length === 1 ? 0.3 : 0,
      note: "headings split the document into addressable sections",
    },
    {
      label: "Sections carry content",
      weight: 1,
      score: sections.length ? nonEmpty / sections.length : 0,
      note: `${nonEmpty} of ${sections.length} section(s) are non-empty`,
    },
    {
      label: "Elements recovered",
      weight: 2,
      score: frac(recoveredTotal, detectedTotal),
      note:
        detectedTotal === 0
          ? "no tables, figures, equations or code cells to lose"
          : `${recoveredTotal} of ${detectedTotal} detected element(s) made it into the output`,
    },
    {
      label: "Figures addressable",
      weight: 1,
      score: figures.length ? figures.filter((f) => f.url && f.caption).length / figures.length : 1,
      note: "every detected figure has a file and a caption",
    },
    {
      label: "Tables intact",
      weight: 1,
      score: tables.length ? tables.filter((t) => t.markdown).length / tables.length : 1,
      note: "every detected table produced Markdown markup",
    },
    {
      label: "No extraction noise",
      weight: 1,
      score: sections.length ? clean / sections.length : 1,
      note: "no ??/□□/� replacement-character debris in the text",
    },
    {
      label: "No loss reported",
      weight: 1,
      score: Math.max(0, 1 - lossCount / 4),
      note: lossCount
        ? `${lossCount} warning(s) report dropped or truncated content`
        : "no warning reports dropped or truncated content",
    },
  ];
  for (const c of checks) c.pass = c.score >= 0.995;
  return checks;
}

export function qcScore(r) {
  const checks = qcChecks(r);
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * c.score, 0);
  return Math.round((got / total) * 100) / 100;
}

// Exact token count via the lazily-loaded o200k tokenizer (loader.js
// ensureTokenizer). Throws if the vendor script isn't loaded yet.
export function countTokensExact(text) {
  const t = globalThis.GPTTokenizer_o200k_base;
  if (!t?.encode) throw new Error("tokenizer not loaded");
  return t.encode(text).length;
}

export function toArrayBuffer(src) {
  if (src instanceof ArrayBuffer) return src;
  if (ArrayBuffer.isView(src)) {
    return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
  }
  throw new Error("expected ArrayBuffer or typed array input");
}

export function decodeText(input) {
  const src = input?.fileBuffer ?? input?.doc;
  if (src == null) throw new Error("parser needs input.fileBuffer or input.doc");
  if (typeof src === "string") return src;
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(toArrayBuffer(src));
  return new TextDecoder("utf-8").decode(bytes);
}

export const filenameStem = (filename, fallback) =>
  (filename ?? "").replace(/\.[^.]+$/, "") || fallback;

// --- formatter helpers -------------------------------------------------------

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

// Stable, unique anchor slugs for one document.
export function makeSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

const yamlString = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// YAML frontmatter from the shared schema. mode: "basic" | "full".
// Only fields that exist are emitted.
export function buildFrontmatter(result, mode = "basic") {
  const lines = ["---"];
  if (result.title) lines.push(`title: ${yamlString(result.title)}`);
  if (result.meta?.filename) lines.push(`source: ${yamlString(result.meta.filename)}`);
  if (result.meta?.sourceFormat) lines.push(`format: ${result.meta.sourceFormat}`);
  if (mode === "full") {
    if (result.authors?.length) {
      lines.push("authors:");
      for (const a of result.authors) lines.push(`  - ${yamlString(a)}`);
    }
    if (result.year != null) lines.push(`year: ${result.year}`);
    if (result.journal) lines.push(`journal: ${yamlString(result.journal)}`);
    if (result.doi) lines.push(`doi: ${yamlString(result.doi)}`);
    lines.push(`tool: ${yamlString(`MakeItMarkdown (${result.meta?.parserVersion ?? "dev"})`)}`);
  }
  lines.push(`converted: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("---", "");
  return lines.join("\n");
}

// Map "[Figure: id]" / "[Figure: id.ext]" placeholders to a per-figure
// filename (used by the Obsidian wikilink pass and the ZIP layout).
const EXT_BY_MIME = { png: "png", jpeg: "jpg", gif: "gif", "svg+xml": "svg", webp: "webp", bmp: "bmp" };

export function figureFilename(fig) {
  const mime = /^data:image\/([\w.+-]+)/.exec(fig.url ?? "")?.[1];
  const ext = EXT_BY_MIME[mime] ?? "png";
  return /\.[a-z0-9]+$/i.test(fig.id) ? fig.id : `${fig.id}.${ext}`;
}
