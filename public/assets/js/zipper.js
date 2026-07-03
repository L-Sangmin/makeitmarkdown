// ZIP handling (JSZip, MIT — self-hosted in /assets/vendor).
//
// Out: result bundle download (.md + extracted figures) — HANDOFF §14 Week 2.
// In (later): uploaded ZIP bundles (.html + local asset folder) — map local
// images to Blob URLs and rewrite src attributes before parsing.

export async function buildResultZip({ markdown, filename, figures = [] }) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error("JSZip is not loaded");

  const stem = filename.replace(/\.[^.]+$/, "") || "converted";
  const zip = new JSZip();
  zip.file(`${stem}.md`, markdown);

  for (const fig of figures) {
    const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/s.exec(fig.url ?? "");
    if (!m) continue;
    const ext = m[1] === "image/png" ? "png" : "jpg";
    zip.file(`figures/${fig.id}.${ext}`, m[2], { base64: true });
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, name: `${stem}-markdown.zip` };
}
