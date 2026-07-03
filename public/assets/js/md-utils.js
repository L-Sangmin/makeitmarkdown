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

// QC per HANDOFF §16, expressed as a fraction instead of a boolean.
export function qcScore(r) {
  const checks = [
    (r.title?.length ?? 0) > 0,
    (r.sections?.length ?? 0) >= 3,
    (r.figures ?? []).every((f) => f.url && f.caption),
    (r.tables ?? []).every((t) => t.markdown),
    !r.sections?.some((s) => /\?\?|□□/.test(s.content)),
  ];
  return checks.filter(Boolean).length / checks.length;
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
