// Result screen: 3-panel trust view (HANDOFF §1.5.3).
// ① original preview · ② converted Markdown · ③ fidelity report.
//
// Fidelity language rule (§1.5.3): counts are DETECTED elements — what the
// parser found — never promised as "preserved".

import { renderDependencyDag } from "./ipynb-dag.js";

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderResult(payload, els) {
  renderOriginal(els.original, payload);
  setMarkdown(els, payload.markdown);
  renderFidelity(els.fidelity, payload.result);
}

// Also used when the preset toggle reformats an existing result.
export function setMarkdown(els, markdown) {
  els.markdown.textContent = markdown;
  els.mdSize.textContent = sizeNote(markdown);
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

function renderOriginal(container, payload) {
  container.textContent = "";
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
  const format = payload.result.meta?.sourceFormat;

  if (!payload.fileBuffer) {
    const note = document.createElement("p");
    note.className = "original-note";
    note.textContent =
      "Restored from this browser's local history — the original file itself was not kept.";
    container.appendChild(note);
    return;
  }

  if (format === "ipynb") {
    try {
      const raw = new TextDecoder("utf-8").decode(payload.fileBuffer);
      container.appendChild(renderNotebook(JSON.parse(raw)));
      return;
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
    return;
  }

  if (format === "docx") {
    const note = document.createElement("p");
    note.className = "original-note";
    note.textContent =
      "Binary Word document — no inline preview for .docx yet. " +
      "The Markdown panel holds the converted content.";
    container.appendChild(note);
    return;
  }

  const pre = document.createElement("pre");
  pre.className = "nb-src";
  pre.textContent = new TextDecoder("utf-8").decode(payload.fileBuffer).slice(0, 20000);
  container.appendChild(pre);
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

  const tone = score >= 90 ? "" : " qc--warn";

  container.innerHTML = `
    <p class="sr-only">${escapeHtml(srSummary)}</p>
    <div class="qc${tone}" aria-hidden="true">
      <div class="qc-score"><span class="count-num" data-n="${score}">0</span><span class="qc-pct">%</span></div>
      <div class="qc-label">QC score<span>5-point structural check</span></div>
    </div>
    <div class="qc-bar${tone}" aria-hidden="true"><span style="transform: scaleX(${score / 100})"></span></div>
    <div class="counts" aria-hidden="true">
      ${counts
        .map(
          ([label, n]) => `
        <div class="count${n === 0 ? " is-zero" : ""}">
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
