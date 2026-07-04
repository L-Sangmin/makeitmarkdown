// Result screen: 3-panel trust view (HANDOFF §1.5.3).
// ① original preview · ② converted Markdown · ③ fidelity report.
//
// Fidelity language rule (§1.5.3): counts are DETECTED elements — what the
// parser found — never promised as "preserved".

import { renderDependencyDag } from "./ipynb-dag.js";
import { qcChecks, figureFilename } from "./md-utils.js";

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderResult(payload, els) {
  const viewerKind = renderOriginal(els.original, payload);
  setMarkdown(els, payload.markdown, payload.result?.figures);
  renderFidelity(els.fidelity, payload.result);
  return viewerKind; // "rich" | "text" | "note" — drives the collapse default
}

// Also used when the preset toggle reformats an existing result.
export function setMarkdown(els, markdown, figures) {
  els.markdown.textContent = markdown;
  els.mdSize.textContent = sizeNote(markdown);
  els._markdown = markdown;
  if (figures !== undefined) els._figures = figures;
  if (els.preview && !els.preview.hidden) renderPreview(els);
}

// Rendered view of the current Markdown — how a chat UI would display it.
// marked + DOMPurify are static on the page (the notebook preview uses them).
// Two preview-only affordances on top of plain rendering:
// - a leading YAML frontmatter block (Obsidian/Archive presets) becomes a
//   Properties box instead of stray horizontal rules;
// - [Figure: …] placeholders and ![[…]] embeds render as labelled chips.
export function renderPreview(els) {
  let md = els._markdown ?? "";
  let fmHtml = "";
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (fm) {
    fmHtml = frontmatterBox(fm[1]);
    md = md.slice(fm[0].length);
  }
  const body = globalThis.DOMPurify.sanitize(globalThis.marked.parse(md), {
    USE_PROFILES: { html: true },
  });
  els.preview.innerHTML = fmHtml + figureChips(body, els._figures);
  resolvePreviewImages(els.preview, els._figures);
}

// figures/… image paths resolve to the extracted data URLs so the preview
// shows the actual figure; external image URLs are never fetched — they
// become chips (the URL still travels in the Markdown itself).
function resolvePreviewImages(container, figures) {
  const byName = new Map();
  for (const fig of figures ?? []) {
    if (/^data:image\//.test(fig.url ?? "")) byName.set(figureFilename(fig), fig);
  }
  for (const img of [...container.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("data:image/")) continue;
    const local = /^(?:\.\/)?figures\/(.+)$/.exec(src);
    const fig = local ? byName.get(local[1]) : null;
    if (fig) {
      img.src = fig.url;
      img.className = "md-fig";
      img.loading = "lazy";
      continue;
    }
    const chip = document.createElement("span");
    chip.className = "fig-ph";
    chip.title = /^https?:/.test(src)
      ? "External image — the URL travels in the Markdown, but nothing is fetched from here"
      : "Figure file — included in the .zip's figures/ folder";
    chip.innerHTML = FIG_SVG;
    chip.append(img.getAttribute("alt") || src);
    img.replaceWith(chip);
  }
}

function frontmatterBox(yaml) {
  const rows = yaml
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const i = line.indexOf(":");
      const key = i > 0 ? line.slice(0, i).trim() : "";
      const val = i > 0 ? line.slice(i + 1).trim() : line.trim();
      return key
        ? `<div class="fm-row"><span class="fm-key">${escapeHtml(key)}</span><span class="fm-val">${escapeHtml(val)}</span></div>`
        : `<div class="fm-row"><span class="fm-key"></span><span class="fm-val">${escapeHtml(val)}</span></div>`;
    })
    .join("");
  return `<aside class="fm-props" aria-label="Frontmatter properties">
    <p class="fm-kicker">Properties <span class="fm-note">frontmatter — shown as a panel here; travels as YAML</span></p>
    ${rows}
  </aside>`;
}

// The chips are injected into already-sanitized HTML; the placeholder text
// inside them is escaped again on the way in.
const FIG_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L6 23"/></svg>';

function figureChips(html, figures) {
  const byName = new Map();
  for (const fig of figures ?? []) {
    if (/^data:image\//.test(fig.url ?? "")) byName.set(figureFilename(fig), fig);
  }
  return html
    .replace(/\[Figure: ([^\]<]+)\]/g, (_, name) =>
      `<span class="fig-ph" title="Detected figure — not extracted from this format">${FIG_SVG}${escapeHtml(name)}</span>`)
    .replace(/!\[\[(?:\.\/)?figures\/([^\]<]+)\]\]/g, (_, name) => {
      const fig = byName.get(name);
      return fig
        ? `<img class="md-fig" loading="lazy" alt="${escapeHtml(name)}" src="${fig.url}">`
        : `<span class="fig-ph" title="Obsidian embed — resolves inside a vault">${FIG_SVG}${escapeHtml(name)}</span>`;
    })
    .replace(/!\[\[([^\]<]+)\]\]/g, (_, name) =>
      `<span class="fig-ph" title="Obsidian embed — resolves inside a vault">${FIG_SVG}${escapeHtml(name)}</span>`);
}

// The DAG bakes theme colors into its SVG — re-render it when the theme flips.
export function refreshFidelity(els, result) {
  renderFidelity(els.fidelity, result);
}

function sizeNote(md) {
  const chars = md.length;
  const tokens = Math.round(chars / 4);
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
  return `${fmt(chars)} chars ≈ ${fmt(tokens)} tokens`;
}

// --- ① original preview ------------------------------------------------------

let lastObjectUrl = null;
let slideObjectUrls = [];

function renderOriginal(container, payload) {
  container.textContent = "";
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
  for (const url of slideObjectUrls) URL.revokeObjectURL(url);
  slideObjectUrls = [];
  const format = payload.result.meta?.sourceFormat;

  if (!payload.fileBuffer) {
    const note = document.createElement("p");
    note.className = "original-note";
    note.textContent =
      "Restored from this browser's local history — the original file itself was not kept.";
    container.appendChild(note);
    return "note";
  }

  if (format === "ipynb") {
    try {
      const raw = new TextDecoder("utf-8").decode(payload.fileBuffer);
      container.appendChild(renderNotebook(JSON.parse(raw)));
      return "rich";
    } catch {
      /* fall through to plain text */
    }
  }

  if (format === "pdf") {
    const blob = new Blob([payload.fileBuffer], { type: "application/pdf" });
    lastObjectUrl = URL.createObjectURL(blob);
    const embed = document.createElement("embed");
    embed.type = "application/pdf";
    embed.src = lastObjectUrl;
    embed.className = "pdf-embed";
    container.appendChild(embed);
    return "rich";
  }

  if (format === "docx") {
    fillAsync(container, async () => {
      const { value } = await globalThis.mammoth.convertToHtml({
        arrayBuffer: payload.fileBuffer.slice(0),
      });
      return sanitized(value);
    });
    return "rich";
  }

  if (format === "xlsx") {
    fillAsync(container, async () => {
      const wb = globalThis.XLSX.read(payload.fileBuffer, { type: "array", cellDates: true });
      const parts = [];
      for (const name of wb.SheetNames.slice(0, 3)) {
        parts.push(`<h3>${escapeHtml(name)}</h3>`);
        parts.push(globalThis.XLSX.utils.sheet_to_html(wb.Sheets[name], { header: "", footer: "" }));
      }
      if (wb.SheetNames.length > 3) {
        parts.push(`<p>… ${wb.SheetNames.length - 3} more sheet(s) not previewed.</p>`);
      }
      return sanitized(parts.join("\n"));
    });
    return "rich";
  }

  if (format === "pptx") {
    // Real slide rendering: shapes and pictures are placed at their true
    // XML coordinates (EMU) inside cards with the deck's real aspect
    // ratio. Falls back to the text slide-cards if the geometry pass fails.
    const note = document.createElement("p");
    note.className = "original-note";
    note.textContent = "Rendering slides…";
    container.appendChild(note);
    renderPptxSlides(payload.fileBuffer)
      .then((el) => container.replaceChildren(el))
      .catch(() => container.replaceChildren(textSlideCards(payload.result)));
    return "rich";
  }

  if (format === "html") {
    const raw = new TextDecoder("utf-8").decode(payload.fileBuffer);
    const div = document.createElement("div");
    div.className = "md-preview doc-preview";
    div.innerHTML = sanitized(raw);
    container.appendChild(div);
    return "rich";
  }

  const pre = document.createElement("pre");
  pre.className = "nb-src";
  pre.textContent = new TextDecoder("utf-8").decode(payload.fileBuffer).slice(0, 20000);
  container.appendChild(pre);
  return "text";
}

const sanitized = (html) =>
  globalThis.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

// --- pptx: geometry-faithful slide rendering --------------------------------
//
// A .pptx stores every shape's position and size in EMUs (914,400 per
// inch). Re-reading the slide XML here lets the original panel show real
// slides: true aspect ratio, text boxes and pictures where they actually
// sit, run-level size/weight/color. Fonts and theme fills are approximated
// (slides render on a white canvas like PowerPoint's default), autofit and
// exotic geometry are ignored — the fidelity report stays the source of
// truth for what was detected.

const EMU_PER_PT = 12700;

function slideByLocal(root, name) {
  const out = [];
  for (const el of root.getElementsByTagName("*")) {
    if (el.localName === name) out.push(el);
  }
  return out;
}

function slideXfrm(el) {
  const xfrm = slideByLocal(el, "xfrm")[0];
  if (!xfrm) return null;
  const off = slideByLocal(xfrm, "off")[0];
  const ext = slideByLocal(xfrm, "ext")[0];
  if (!off || !ext) return null;
  return {
    x: +off.getAttribute("x"), y: +off.getAttribute("y"),
    cx: +ext.getAttribute("cx"), cy: +ext.getAttribute("cy"),
  };
}

function slideSolidFill(scope) {
  const fill = slideByLocal(scope, "solidFill")[0];
  const rgb = fill && slideByLocal(fill, "srgbClr")[0];
  return rgb ? `#${rgb.getAttribute("val")}` : null;
}

const SLIDE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp" };

// Placeholder shapes usually inherit their box from the slide layout (or
// the master); collect those boxes keyed by placeholder type/idx.
async function placeholderGeom(zip, rels, parseXml) {
  const geom = new Map();
  const layoutTarget = [...rels.values()].find((t) => /slideLayout\d+\.xml$/.test(t));
  if (!layoutTarget) return geom;
  const layoutPath = layoutTarget.replace(/^(\.\.\/)+/, "ppt/");
  const layoutEntry = zip.file(layoutPath);
  if (!layoutEntry) return geom;
  const layoutXml = parseXml(await layoutEntry.async("text"));

  let masterXml = null;
  const layoutRelsEntry = zip.file(
    layoutPath.replace(/slideLayouts\/(slideLayout\d+\.xml)$/, "slideLayouts/_rels/$1.rels"),
  );
  if (layoutRelsEntry) {
    const relsXml = parseXml(await layoutRelsEntry.async("text"));
    const masterTarget = slideByLocal(relsXml, "Relationship")
      .map((r) => r.getAttribute("Target"))
      .find((t) => /slideMaster\d+\.xml$/.test(t ?? ""));
    const masterEntry = masterTarget && zip.file(masterTarget.replace(/^(\.\.\/)+/, "ppt/"));
    if (masterEntry) masterXml = parseXml(await masterEntry.async("text"));
  }

  for (const src of [masterXml, layoutXml]) { // layout wins over master
    if (!src) continue;
    for (const sp of slideByLocal(src, "sp")) {
      const ph = slideByLocal(sp, "ph")[0];
      const box = slideXfrm(sp);
      if (!ph || !box) continue;
      geom.set(`${ph.getAttribute("type") ?? "body"}|${ph.getAttribute("idx") ?? ""}`, box);
      geom.set(`${ph.getAttribute("type") ?? "body"}|*`, box);
    }
  }
  return geom;
}

function lookupPlaceholder(geomMap, sp) {
  const ph = slideByLocal(sp, "ph")[0];
  if (!ph) return null;
  const type = ph.getAttribute("type") ?? "body";
  const idx = ph.getAttribute("idx") ?? "";
  return (
    geomMap.get(`${type}|${idx}`) ??
    geomMap.get(`${type}|*`) ??
    (type === "ctrTitle" ? geomMap.get("title|*") : null) ??
    (type === "body" || idx ? geomMap.get(`body|${idx}`) ?? geomMap.get("body|*") : null)
  );
}

async function renderPptxSlides(fileBuffer) {
  const zip = await globalThis.JSZip.loadAsync(fileBuffer.slice(0));
  const parseXml = (text) => new DOMParser().parseFromString(text, "text/xml");

  const pres = parseXml(await zip.file("ppt/presentation.xml").async("text"));
  const sldSz = slideByLocal(pres, "sldSz")[0];
  // Modern PowerPoint 16:9 default when the part omits an explicit size.
  const W = sldSz ? +sldSz.getAttribute("cx") : 12192000;
  const H = sldSz ? +sldSz.getAttribute("cy") : 6858000;
  const slideWidthPt = W / EMU_PER_PT;
  // 1pt of slide text as a percentage of the slide's width — with
  // container queries this keeps text proportional at any panel size.
  const ptToCqw = (pt) => `${((pt / slideWidthPt) * 100).toFixed(3)}cqw`;

  const entries = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(a.name.match(/(\d+)/)[1]) - Number(b.name.match(/(\d+)/)[1]));
  if (!entries.length) throw new Error("no slides");

  const wrap = document.createElement("div");
  wrap.className = "pptx-slides";

  for (const entry of entries) {
    const xml = parseXml(await entry.async("text"));
    const relsEntry = zip.file(entry.name.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"));
    const rels = new Map();
    if (relsEntry) {
      for (const rel of slideByLocal(parseXml(await relsEntry.async("text")), "Relationship")) {
        rels.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
      }
    }

    const slide = document.createElement("div");
    slide.className = "pptx-slide";
    slide.style.aspectRatio = `${W} / ${H}`;
    const bg = slideByLocal(xml, "bg")[0];
    const bgColor = bg && slideSolidFill(bg);
    if (bgColor) slide.style.background = bgColor;

    const phGeom = await placeholderGeom(zip, rels, parseXml);
    const tree = slideByLocal(xml, "spTree")[0];
    if (tree) await renderShapeTree(tree, slide, { W, H, zip, rels, entry, ptToCqw, phGeom });

    const n = Number(entry.name.match(/slide(\d+)\.xml$/)[1]);
    const label = document.createElement("p");
    label.className = "pptx-slide-num";
    label.textContent = `Slide ${n}`;
    const item = document.createElement("figure");
    item.className = "pptx-slide-item";
    item.append(slide, label);
    wrap.appendChild(item);
  }
  return wrap;
}

async function renderShapeTree(tree, slide, ctx) {
  const { W, H } = ctx;
  const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
  let flow = null; // shapes with no resolvable box stack here instead of vanishing
  for (const el of tree.children) {
    if (el.localName === "sp") {
      const geo = slideXfrm(el) ?? lookupPlaceholder(ctx.phGeom, el);
      const box = document.createElement("div");
      box.className = "pptx-shape";
      if (geo) {
        box.style.left = pct(geo.x, W);
        box.style.top = pct(geo.y, H);
        box.style.width = pct(geo.cx, W);
        box.style.height = pct(geo.cy, H);
      }
      const spPr = slideByLocal(el, "spPr")[0];
      const fill = spPr && slideSolidFill(spPr);
      if (fill) box.style.background = fill;
      const geom = spPr && slideByLocal(spPr, "prstGeom")[0]?.getAttribute("prst");
      if (geom === "ellipse") box.style.borderRadius = "50%";
      else if (geom === "roundRect") box.style.borderRadius = "6%";
      renderShapeText(el, box, ctx);
      if (geo) {
        slide.appendChild(box);
      } else if (box.childNodes.length) {
        box.classList.add("pptx-shape-flow");
        if (!flow) {
          flow = document.createElement("div");
          flow.className = "pptx-flow";
          slide.appendChild(flow);
        }
        flow.appendChild(box);
      }
    } else if (el.localName === "pic") {
      const geo = slideXfrm(el);
      const blip = slideByLocal(el, "blip")[0];
      const target = blip && ctx.rels.get(blip.getAttribute("r:embed") ?? blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"));
      if (!target) continue;
      const mediaPath = target.replace(/^(\.\.\/)+/, "ppt/");
      const media = ctx.zip.file(mediaPath);
      if (!media) continue;
      const ext = mediaPath.split(".").pop().toLowerCase();
      if (!SLIDE_MIME[ext]) continue; // wmf/emf etc. have no browser rendering
      const blob = new Blob([await media.async("arraybuffer")], { type: SLIDE_MIME[ext] });
      const url = URL.createObjectURL(blob);
      slideObjectUrls.push(url);
      const img = document.createElement("img");
      img.className = "pptx-pic";
      img.src = url;
      img.alt = "";
      if (geo) {
        img.style.left = pct(geo.x, W);
        img.style.top = pct(geo.y, H);
        img.style.width = pct(geo.cx, W);
        img.style.height = pct(geo.cy, H);
        slide.appendChild(img);
      } else {
        img.classList.add("pptx-pic-flow");
        if (!flow) {
          flow = document.createElement("div");
          flow.className = "pptx-flow";
          slide.appendChild(flow);
        }
        flow.appendChild(img);
      }
    }
    // group shapes (grpSp) and charts keep their space unrendered — the
    // fidelity report counts them; inventing layout would be dishonest.
  }
}

function renderShapeText(sp, box, ctx) {
  for (const p of slideByLocal(sp, "p")) {
    const par = document.createElement("p");
    par.className = "pptx-par";
    const pPr = slideByLocal(p, "pPr")[0];
    const algn = pPr?.getAttribute("algn");
    if (algn === "ctr") par.style.textAlign = "center";
    else if (algn === "r") par.style.textAlign = "right";
    const lvl = Number(pPr?.getAttribute("lvl") ?? 0);
    if (lvl > 0) par.style.paddingLeft = `${lvl * 1.25}em`;
    for (const node of p.children) {
      if (node.localName === "br") {
        par.appendChild(document.createElement("br"));
        continue;
      }
      if (node.localName !== "r") continue;
      const t = slideByLocal(node, "t").map((x) => x.textContent).join("");
      if (!t) continue;
      const run = document.createElement("span");
      run.textContent = t;
      const rPr = slideByLocal(node, "rPr")[0];
      const sz = rPr?.getAttribute("sz");
      run.style.fontSize = ctx.ptToCqw(sz ? +sz / 100 : 18);
      if (rPr?.getAttribute("b") === "1") run.style.fontWeight = "650";
      if (rPr?.getAttribute("i") === "1") run.style.fontStyle = "italic";
      const color = rPr && slideSolidFill(rPr);
      if (color) run.style.color = color;
      par.appendChild(run);
    }
    if (par.childNodes.length) box.appendChild(par);
  }
}

// Fallback when the geometry pass fails: text cards from parsed sections.
function textSlideCards(result) {
  const wrap = document.createElement("div");
  wrap.className = "slide-preview";
  for (const sec of result.sections ?? []) {
    const card = document.createElement("div");
    card.className = "slide-card";
    const h = document.createElement("h3");
    h.textContent = sec.heading;
    const pre = document.createElement("pre");
    pre.textContent = sec.content;
    card.append(h, pre);
    wrap.appendChild(card);
  }
  return wrap;
}

// Async viewers show a placeholder, then swap in the rendered preview.
function fillAsync(container, render) {
  const note = document.createElement("p");
  note.className = "original-note";
  note.textContent = "Rendering preview…";
  container.appendChild(note);
  render()
    .then((html) => {
      const div = document.createElement("div");
      div.className = "md-preview doc-preview";
      div.innerHTML = html;
      container.replaceChildren(div);
    })
    .catch(() => {
      note.textContent = "Preview unavailable for this file — the Markdown panel holds the converted content.";
    });
}

function renderNotebook(nb) {
  const frag = document.createDocumentFragment();
  const join = (t) => (Array.isArray(t) ? t.join("") : (t ?? ""));

  for (const cell of nb.cells ?? []) {
    const div = document.createElement("div");
    div.className = "nb-cell";

    if (cell.cell_type === "markdown") {
      const md = document.createElement("div");
      md.className = "nb-md";
      md.innerHTML = globalThis.DOMPurify.sanitize(
        globalThis.marked.parse(join(cell.source)),
        { USE_PROFILES: { html: true } }
      );
      div.appendChild(md);
    } else if (cell.cell_type === "code") {
      const prompt = document.createElement("span");
      prompt.className = "nb-prompt";
      prompt.textContent = `In [${cell.execution_count ?? " "}]`;
      div.appendChild(prompt);

      const pre = document.createElement("pre");
      pre.className = "nb-src";
      pre.textContent = join(cell.source);
      div.appendChild(pre);

      for (const out of cell.outputs ?? []) {
        const node = renderOutput(out, join);
        if (node) div.appendChild(node);
      }
    } else {
      const pre = document.createElement("pre");
      pre.className = "nb-src";
      pre.textContent = join(cell.source);
      div.appendChild(pre);
    }
    frag.appendChild(div);
  }
  return frag;
}

function renderOutput(out, join) {
  const imageMime = ["image/png", "image/jpeg"].find((m) => out.data?.[m]);
  if (imageMime) {
    const img = document.createElement("img");
    img.className = "nb-img";
    img.alt = "cell output figure";
    img.src = `data:${imageMime};base64,${join(out.data[imageMime]).replace(/\n/g, "")}`;
    return img;
  }
  let text = "";
  if (out.output_type === "stream") text = join(out.text);
  else if (out.data?.["text/plain"]) text = join(out.data["text/plain"]);
  else if (out.output_type === "error") {
    text = (out.traceback ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  }
  if (!text) return null;
  const pre = document.createElement("pre");
  pre.className = `nb-out${out.output_type === "error" ? " nb-err" : ""}`;
  pre.textContent = text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  return pre;
}

// --- ③ fidelity report ---------------------------------------------------------

function renderFidelity(container, result) {
  const f = result.fidelity ?? {};
  const d = f.detected ?? {};
  const score = Math.round((f.qcScore ?? 0) * 100);

  const counts = [
    ["code cells", d.codeCells ?? 0],
    ["figures", d.figures ?? 0],
    ["tables", d.tables ?? 0],
    ["equations", d.equations ?? 0],
  ];

  const warnings = f.warnings ?? [];
  const warnHtml = warnings.length
    ? `<ul class="warn-list">${warnings
        .map((w) => `<li><span class="warn-mark">⚠</span>${escapeHtml(w)}</li>`)
        .join("")}</ul>`
    : `<p class="warn-none">✓ No warnings.</p>`;

  // Screen readers get the numbers directly; the animated counters are
  // decorative from their point of view.
  const srSummary =
    `QC score ${score} percent. ` +
    counts.map(([label, n]) => `${n} ${label} detected`).join(", ") +
    `. ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`;

  const checks = qcChecks(result);
  const checksHtml = checks
    .map((c) => {
      const kind = c.pass ? "qc-pass" : c.score > 0 ? "qc-part" : "qc-fail";
      const mark = c.pass ? "✓" : c.score > 0 ? "△" : "✗";
      const pct = c.pass || c.score === 0 ? "" : ` (${Math.round(c.score * 100)}%)`;
      const wt = c.weight > 1 ? `<span class="qc-weight">×${c.weight}</span>` : "";
      return `
      <li class="${kind}">
        <span class="qc-mark">${mark}</span>
        <span><strong>${escapeHtml(c.label)}</strong>${wt} — ${escapeHtml(c.note)}${pct}</span>
      </li>`;
    })
    .join("");

  container.innerHTML = `
    <p class="sr-only">${escapeHtml(srSummary)}</p>
    <button type="button" class="qc qc-toggle" aria-expanded="false"
      aria-label="QC score ${score} percent — show the ${checks.length} weighted structural checks">
      <div class="qc-score" aria-hidden="true"><span class="count-num" data-n="${score}">0</span><span class="qc-pct">%</span></div>
      <div class="qc-label" aria-hidden="true">QC score<span>${checks.length} weighted structural checks · details</span></div>
      <svg class="qc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <ul class="qc-checks" hidden>${checksHtml}</ul>
    <div class="counts" aria-hidden="true">
      ${counts
        .map(
          ([label, n]) => `
        <div class="count">
          <span class="count-num" data-n="${n}">0</span>
          <span class="count-label">${label} detected</span>
        </div>`
        )
        .join("")}
    </div>
    <p class="fidelity-note">
      Counts are elements the parser <em>detected</em> — not a guarantee that
      everything survived conversion.
    </p>
    <h3 class="fidelity-sub">Warnings</h3>
    ${warnHtml}
    ${result.notebook ? `<h3 class="fidelity-sub">Cell dependencies</h3><div class="dag-wrap">${dagSvg(result.notebook)}</div>` : ""}
  `;

  const toggle = container.querySelector(".qc-toggle");
  const checkList = container.querySelector(".qc-checks");
  toggle.addEventListener("click", () => {
    const open = checkList.hidden;
    checkList.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
  });

  animateCounts(container);
}

function dagSvg(notebook) {
  const theme = document.documentElement.dataset.theme
    ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  return renderDependencyDag(notebook, { theme });
}

// Subtle 0 → n count-up. Instant when the user prefers reduced motion.
function animateCounts(container) {
  const nums = container.querySelectorAll(".count-num");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const el of nums) el.textContent = el.dataset.n;
    return;
  }
  const DURATION = 450;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / DURATION);
    const eased = 1 - Math.pow(1 - p, 3);
    for (const el of nums) el.textContent = Math.round(Number(el.dataset.n) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
