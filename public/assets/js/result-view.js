// Result screen: 3-panel trust view (HANDOFF §1.5.3).
// ① original preview · ② converted Markdown · ③ fidelity report.
//
// Fidelity language rule (§1.5.3): counts are DETECTED elements — what the
// parser found — never promised as "preserved".

import { renderDependencyDag } from "./ipynb-dag.js";
import { qcChecks } from "./md-utils.js";

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderResult(payload, els) {
  const viewerKind = renderOriginal(els.original, payload);
  setMarkdown(els, payload.markdown);
  renderFidelity(els.fidelity, payload.result);
  return viewerKind; // "rich" | "text" | "note" — drives the collapse default
}

// Also used when the preset toggle reformats an existing result.
export function setMarkdown(els, markdown) {
  els.markdown.textContent = markdown;
  els.mdSize.textContent = sizeNote(markdown);
  els._markdown = markdown;
  if (els.preview && !els.preview.hidden) renderPreview(els);
}

// Rendered view of the current Markdown — how a chat UI would display it.
// marked + DOMPurify are static on the page (the notebook preview uses them).
export function renderPreview(els) {
  els.preview.innerHTML = globalThis.DOMPurify.sanitize(
    globalThis.marked.parse(els._markdown ?? ""),
    { USE_PROFILES: { html: true } }
  );
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
    // Slide-card preview rebuilt from the parsed sections — the binary
    // itself has no cheap visual rendering in a browser.
    const wrap = document.createElement("div");
    wrap.className = "slide-preview";
    for (const sec of payload.result.sections ?? []) {
      const card = document.createElement("div");
      card.className = "slide-card";
      const h = document.createElement("h3");
      h.textContent = sec.heading;
      const pre = document.createElement("pre");
      pre.textContent = sec.content;
      card.append(h, pre);
      wrap.appendChild(card);
    }
    container.appendChild(wrap);
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
    .map(
      (c) => `
      <li class="${c.pass ? "qc-pass" : "qc-fail"}">
        <span class="qc-mark">${c.pass ? "✓" : "✗"}</span>
        <span><strong>${escapeHtml(c.label)}</strong> — ${escapeHtml(c.note)}</span>
      </li>`
    )
    .join("");

  container.innerHTML = `
    <p class="sr-only">${escapeHtml(srSummary)}</p>
    <button type="button" class="qc qc-toggle" aria-expanded="false"
      aria-label="QC score ${score} percent — show the five structural checks">
      <div class="qc-score" aria-hidden="true"><span class="count-num" data-n="${score}">0</span><span class="qc-pct">%</span></div>
      <div class="qc-label" aria-hidden="true">QC score<span>5-point structural check · details</span></div>
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
