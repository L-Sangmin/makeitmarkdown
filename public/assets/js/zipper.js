// ZIP handling (JSZip, MIT — self-hosted in /assets/vendor).
//
// Out: result bundle download (.md + extracted figures) — HANDOFF §14 Week 2.
// In (later): uploaded ZIP bundles (.html + local asset folder) — map local
// images to Blob URLs and rewrite src attributes before parsing.

import { figureFilename } from "./md-utils.js";

function addResult(zip, root, { markdown, filename, figures = [] }) {
  const stem = filename.replace(/\.[^.]+$/, "") || "converted";
  const base = root ? `${root}/` : "";
  zip.file(`${base}${stem}.md`, markdown);

  for (const fig of figures) {
    // Only extracted figures (data URLs) can be bundled; external image
    // URLs from saved webpages are listed in the Markdown but never
    // fetched — the site makes no network requests with your content.
    const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(fig.url ?? "");
    if (!m) continue;
    zip.file(`${base}figures/${figureFilename(fig)}`, m[1], { base64: true });
  }
  return stem;
}

export async function buildResultZip({ markdown, filename, figures = [] }) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error("JSZip is not loaded");

  const zip = new JSZip();
  const stem = addResult(zip, "", { markdown, filename, figures });
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, name: `${stem}-markdown.zip` };
}

// Batch: one folder per converted file, name collisions suffixed -2, -3, …
export async function buildBatchZip(payloads) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error("JSZip is not loaded");

  const zip = new JSZip();
  const used = new Map();
  for (const p of payloads) {
    const stem = p.filename.replace(/\.[^.]+$/, "") || "converted";
    const n = (used.get(stem) ?? 0) + 1;
    used.set(stem, n);
    const folder = n === 1 ? stem : `${stem}-${n}`;
    addResult(zip, folder, {
      markdown: p.markdown,
      filename: p.filename,
      figures: p.result?.figures ?? [],
    });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, name: `makeitmarkdown-batch-${payloads.length}-files.zip` };
}
