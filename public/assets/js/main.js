// UI entry point.
//
// Phase 1 frame (HANDOFF §1.5):
// - First screen: one big input target, privacy note beneath it,
//   no pipeline-explainer sidebar.
// - Result screen: 3-panel trust view — original | Markdown | fidelity.
// - Advanced options (format toggle, download) appear only after a result
//   exists (progressive disclosure). Nothing persists across refresh.

import { convertFile, UnsupportedFormatError } from "./router.js";
import { renderResult, setMarkdown, refreshFidelity, renderPreview } from "./result-view.js";
import { ensureTokenizer } from "./loader.js";
import { countTokensExact } from "./md-utils.js";
import { buildResultZip, buildBatchZip } from "./zipper.js";
import { PRESETS, formatWithPreset } from "./presets.js";
import { loadHistory, saveToHistory, clearHistory } from "./history.js";
import { ocrPdfPages, buildOcrResult } from "./ocr.js";

// --- theme -------------------------------------------------------------------

const THEME_KEY = "mim-theme";
const root = document.documentElement;

function currentTheme() {
  return (
    root.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode — theme just won't persist */
  }
  // the dependency DAG bakes theme colors into its SVG
  if (current && !els.result.hidden) {
    refreshFidelity(els, current.result);
    maybeOfferOcr();
  }
});

// --- elements ------------------------------------------------------------------

const els = {
  landing: document.getElementById("view-landing"),
  result: document.getElementById("view-result"),
  dropTarget: document.getElementById("drop-target"),
  dropError: document.getElementById("drop-error"),
  fileInput: document.getElementById("file-input"),
  meta: document.getElementById("result-meta"),
  original: document.getElementById("original-body"),
  markdown: document.getElementById("markdown-body"),
  preview: document.getElementById("markdown-preview"),
  mdSize: document.getElementById("md-size"),
  fidelity: document.getElementById("fidelity-body"),
  btnCopy: document.getElementById("btn-copy"),
  btnZip: document.getElementById("btn-zip"),
  btnMd: document.getElementById("btn-md"),
  btnOriginal: document.getElementById("btn-original"),
  panes: document.querySelector(".panes"),
};

let current = null; // { result, markdown, ms, filename, fileBuffer }
let activePreset = "standard"; // in-memory only — resets on refresh, by design

// --- preset segmented control ---------------------------------------------------

const presetSeg = document.getElementById("preset-seg");

for (const preset of PRESETS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "seg-item";
  btn.dataset.preset = preset.id;
  btn.title = preset.hint;
  btn.textContent = preset.label;
  btn.addEventListener("click", () => applyPreset(preset.id));
  presetSeg.appendChild(btn);
}

function syncPresetSeg() {
  for (const btn of presetSeg.querySelectorAll(".seg-item")) {
    const active = btn.dataset.preset === activePreset;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}
syncPresetSeg();

function applyPreset(id) {
  activePreset = id;
  syncPresetSeg();
  if (!current) return;
  current.markdown = formatWithPreset(current.result, id);
  setMarkdown(els, current.markdown);
  resetExactCount();
}

// --- markdown pane: raw/preview toggle + exact token count -----------------------

const btnMdRaw = document.getElementById("md-view-raw");
const btnMdPreview = document.getElementById("md-view-preview");
const btnExact = document.getElementById("md-exact");

function setMdView(mode) {
  const preview = mode === "preview";
  els.markdown.hidden = preview;
  els.preview.hidden = !preview;
  for (const [btn, active] of [[btnMdRaw, !preview], [btnMdPreview, preview]]) {
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  if (preview) renderPreview(els);
}
btnMdRaw.addEventListener("click", () => setMdView("raw"));
btnMdPreview.addEventListener("click", () => setMdView("preview"));

function resetExactCount() {
  btnExact.disabled = false;
  btnExact.hidden = false;
  btnExact.textContent = "count exactly";
}

// --- original pane: collapsible (auto-collapsed when there is no real viewer) --

function setOriginalCollapsed(collapsed) {
  els.panes.classList.toggle("orig-collapsed", collapsed);
  els.btnOriginal.textContent = collapsed ? "Show original" : "Hide original";
  els.btnOriginal.setAttribute("aria-pressed", String(!collapsed));
}

els.btnOriginal.addEventListener("click", () => {
  setOriginalCollapsed(!els.panes.classList.contains("orig-collapsed"));
});

// --- downloads: markdown only, or the full zip -----------------------------------

els.btnMd.addEventListener("click", () => {
  if (!current) return;
  const stem = current.filename.replace(/\.[^.]+$/, "") || "converted";
  const blob = new Blob([current.markdown], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${stem}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnExact.addEventListener("click", async () => {
  if (!current) return;
  btnExact.disabled = true;
  btnExact.textContent = "counting…";
  try {
    await ensureTokenizer();
    const n = countTokensExact(current.markdown);
    els.mdSize.textContent =
      `${current.markdown.length.toLocaleString("en-US")} chars · ${n.toLocaleString("en-US")} tokens (o200k)`;
    btnExact.hidden = true;
  } catch {
    // Most likely offline before the tokenizer was ever cached.
    btnExact.textContent = "count unavailable";
  }
});

// --- OCR offer for scanned PDFs ---------------------------------------------------
// Appears under the fidelity report only when the pdf parser flagged a scan.
// Everything runs locally; the engine (~8 MB) downloads once, on click.

function maybeOfferOcr() {
  els.fidelity.querySelector(".ocr-offer")?.remove();
  const r = current?.result;
  const scanned =
    r?.meta?.sourceFormat === "pdf" &&
    !r.meta.ocr &&
    current.fileBuffer &&
    (r.fidelity?.warnings ?? []).some((w) => /appears to be scanned/i.test(w));
  if (!scanned) return;

  const box = document.createElement("div");
  box.className = "ocr-offer";
  const note = document.createElement("p");
  note.innerHTML =
    "<strong>Scanned PDF?</strong> You can try OCR — it runs locally " +
    "(~8&nbsp;MB engine, downloaded once) and takes a few seconds per page. " +
    "Output is <em>approximate</em>: fine for reading, risky for exact numbers and tables.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-solid ocr-btn";
  btn.textContent = "Try OCR (experimental)";
  btn.addEventListener("click", () => runOcr(btn));
  box.append(note, btn);
  els.fidelity.appendChild(box);
}

async function runOcr(btn) {
  if (!current?.fileBuffer) return;
  btn.disabled = true;
  btn.textContent = "Loading OCR engine…";
  try {
    const pages = await ocrPdfPages(current.fileBuffer, {
      onProgress: ({ page, pages: total }) => {
        btn.textContent = `Recognizing page ${page}/${total}…`;
      },
    });
    current.result = buildOcrResult(current.result, pages);
    current.markdown = formatWithPreset(current.result, activePreset);
    setOriginalCollapsed(renderResult(current, els) === "note");
    resetExactCount();
    maybeOfferOcr(); // meta.ocr is set now — the offer removes itself
    saveToHistory(current, activePreset);
    renderHistoryList();
    els.meta.textContent = `${current.filename} · OCR, approximate · processed locally — refresh clears it`;
  } catch {
    btn.disabled = false;
    btn.textContent = "OCR failed — try again";
  }
}

// --- views ----------------------------------------------------------------------

function showResult() {
  els.landing.hidden = true;
  els.result.hidden = false;
  // move keyboard/SR context into the new view without a visible ring
  els.result.setAttribute("tabindex", "-1");
  els.result.focus({ preventScroll: true });
}

function showLanding() {
  els.result.hidden = true;
  els.landing.hidden = false;
  current = null;
  els.fileInput.value = "";
  hideError();
  els.dropTarget.focus({ preventScroll: true });
}

function showError(html) {
  els.dropError.innerHTML = html;
  els.dropError.hidden = false;
}

function hideError() {
  els.dropError.hidden = true;
}

// --- conversion -----------------------------------------------------------------

const NOT_READY = /not implemented yet/;

// "Converted in 0.2s" — the speed is a feature; keep raw ms only when it's
// genuinely instant.
function formatDuration(ms) {
  if (ms < 100) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 9500 ? 1 : 0)}s`;
}

// Busy state appears only when conversion takes >150ms (first heavy library
// load) — fast paths never flash.
function setBusy(filename) {
  const timer = setTimeout(() => {
    els.dropTarget.classList.add("is-busy");
    els.dropTarget.setAttribute("aria-busy", "true");
    els.dropTarget.querySelector(".drop-busy-label").textContent = `Converting ${filename}…`;
  }, 150);
  return () => {
    clearTimeout(timer);
    els.dropTarget.classList.remove("is-busy");
    els.dropTarget.removeAttribute("aria-busy");
  };
}

async function handleFile(file) {
  hideError();
  const clearBusy = setBusy(file.name);
  const busyLabel = els.dropTarget.querySelector(".drop-busy-label");
  try {
    const payload = await convertFile(file, {
      onProgress: ({ page, pages }) => {
        if (pages > 1) busyLabel.textContent = `Converting ${file.name} — page ${page}/${pages}`;
      },
    });
    payload.markdown = formatWithPreset(payload.result, activePreset);
    current = payload;
    syncPresetSeg();

    els.meta.textContent = `${payload.filename} · converted in ${formatDuration(payload.ms)} · processed locally — refresh clears it`;

    setOriginalCollapsed(renderResult(payload, els) === "note");
    resetExactCount();
    maybeOfferOcr();
    showResult();
    saveToHistory(payload, activePreset);
    renderHistoryList();
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      showError(
        `That file type isn't supported yet. Works today: <code>.ipynb</code> · <code>.docx</code> · <code>.pptx</code> · <code>.xlsx</code> · <code>.csv</code> · <code>.json</code> · <code>.html</code> · <code>.pdf</code> · <code>.eml</code> · <code>.srt</code> · <code>.md</code> · <code>.txt</code>.`
      );
    } else if (NOT_READY.test(err.message ?? "")) {
      showError(
        `That format's parser isn't wired up yet — drop one of the supported types listed under the target.`
      );
    } else {
      showError(`Couldn't read that file: ${escapeText(err.message ?? "unknown error")}`);
    }
  } finally {
    clearBusy();
  }
}

const escapeText = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Multiple files: convert each, show the first result, keep the rest for a
// single batch ZIP download.
async function handleFiles(files) {
  const list = [...files];
  if (list.length <= 1) {
    if (list[0]) await handleFile(list[0]);
    return;
  }

  hideError();
  const busyLabel = els.dropTarget.querySelector(".drop-busy-label");
  const clearBusy = setBusy(list[0].name);
  const payloads = [];
  const failures = [];

  try {
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      busyLabel.textContent = `Converting ${i + 1}/${list.length}: ${file.name}`;
      try {
        const payload = await convertFile(file);
        payload.markdown = formatWithPreset(payload.result, activePreset);
        payloads.push(payload);
        saveToHistory(payload, activePreset);
      } catch (err) {
        failures.push(`${file.name}: ${err.message ?? "failed"}`);
      }
    }
  } finally {
    clearBusy();
  }
  renderHistoryList();

  if (!payloads.length) {
    showError(`None of the ${list.length} files could be converted.<br>${escapeText(failures[0] ?? "")}`);
    return;
  }

  current = payloads[0];
  current.batch = payloads;
  syncPresetSeg();
  const failNote = failures.length ? ` · ${failures.length} failed` : "";
  els.meta.textContent = `${payloads.length} files converted${failNote} · showing ${current.filename} · Download .zip bundles all`;
  setOriginalCollapsed(renderResult(current, els) === "note");
  resetExactCount();
  maybeOfferOcr();
  showResult();
}

// --- input wiring ------------------------------------------------------------------

els.dropTarget.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files?.length) handleFiles(els.fileInput.files);
});

// The whole window accepts drops — the card is the affordance, not the boundary.
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropTarget.classList.add("is-dragover");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) els.dropTarget.classList.remove("is-dragover");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropTarget.classList.remove("is-dragover");
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

document.addEventListener("paste", (e) => {
  if (e.clipboardData?.files?.length) handleFiles(e.clipboardData.files);
});

// --- sample ---------------------------------------------------------------------------

const SAMPLES = {
  "sales-analysis": "sales-analysis.ipynb",
  "out-of-order": "out-of-order.ipynb",
  "sales-csv": "sales.csv",
  article: "article.html",
  docx: "q1-operations-review.docx",
  pdf: "vendor-report.pdf",
  "scanned-pdf": "scanned.pdf",
  pptx: "quarterly-kickoff.pptx",
  eml: "team-thread.eml",
};

async function loadSample(name = "sales-analysis") {
  const filename = SAMPLES[name];
  if (!filename) return;
  const res = await fetch(`/assets/samples/${filename}`);
  const blob = await res.blob();
  handleFile(new File([blob], filename));
}

document.getElementById("btn-sample")?.addEventListener("click", () => loadSample());

// --- recent conversions (localStorage, this browser only) ------------------------

const historyBox = document.getElementById("history");
const historyList = document.getElementById("history-list");

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderHistoryList() {
  const entries = loadHistory();
  historyBox.hidden = entries.length === 0;
  historyList.textContent = "";
  for (const entry of entries) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-item";
    btn.innerHTML =
      `<span class="history-name"></span>` +
      `<span class="history-meta">${timeAgo(entry.ts)} · ~${Math.round(entry.markdown.length / 4).toLocaleString("en-US")} tokens</span>`;
    btn.querySelector(".history-name").textContent = entry.filename;
    btn.addEventListener("click", () => restoreFromHistory(entry));
    li.appendChild(btn);
    historyList.appendChild(li);
  }
}

function restoreFromHistory(entry) {
  current = {
    result: entry.result,
    markdown: entry.markdown,
    filename: entry.filename,
    fileBuffer: null,
    ms: 0,
  };
  activePreset = entry.preset ?? "standard";
  syncPresetSeg();
  els.meta.textContent = `${entry.filename} · restored from local history (${timeAgo(entry.ts)}) — stored only in this browser`;
  setOriginalCollapsed(renderResult(current, els) === "note");
  resetExactCount();
  maybeOfferOcr();
  showResult();
}

document.getElementById("btn-clear-history")?.addEventListener("click", () => {
  clearHistory();
  renderHistoryList();
});

// Offline support — after the first visit the whole tool works with no
// network at all, which is also the privacy claim made verifiable.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

renderHistoryList();

// Deep links for demos/tests: ?sample=<name> and ?preset=<id>
const params = new URLSearchParams(location.search);
const presetParam = params.get("preset");
if (presetParam && PRESETS.some((p) => p.id === presetParam)) {
  activePreset = presetParam;
  syncPresetSeg();
}
const sampleParam = params.get("sample");
if (sampleParam) loadSample(sampleParam === "1" ? "sales-analysis" : sampleParam);

// --- result actions ----------------------------------------------------------------------

document.getElementById("btn-new")?.addEventListener("click", showLanding);

function flashCopied() {
  els.btnCopy.textContent = "Copied ✓";
  els.btnCopy.classList.add("is-done");
  setTimeout(() => {
    els.btnCopy.textContent = "Copy";
    els.btnCopy.classList.remove("is-done");
  }, 1200);
}

els.btnCopy?.addEventListener("click", async () => {
  if (!current) return;
  await navigator.clipboard.writeText(current.markdown);
  flashCopied();
});

// ⌘C / Ctrl+C with nothing selected copies the whole result.
document.addEventListener("copy", (e) => {
  if (!current || els.result.hidden) return;
  if (!window.getSelection()?.isCollapsed) return; // real selection wins
  e.preventDefault();
  e.clipboardData.setData("text/plain", current.markdown);
  flashCopied();
});

// Esc backs out to the input screen.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.result.hidden) showLanding();
});

els.btnZip?.addEventListener("click", async () => {
  if (!current) return;
  const { blob, name } =
    current.batch?.length > 1
      ? await buildBatchZip(current.batch)
      : await buildResultZip({
          markdown: current.markdown,
          filename: current.filename,
          figures: current.result.figures,
        });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
