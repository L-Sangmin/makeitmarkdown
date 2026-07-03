// UI entry point.
//
// Phase 1 frame (HANDOFF §1.5):
// - First screen: one big input target, privacy note beneath it,
//   no pipeline-explainer sidebar.
// - Result screen: 3-panel trust view — original | Markdown | fidelity.
// - Advanced options (format toggle, download) appear only after a result
//   exists (progressive disclosure). Nothing persists across refresh.

import { convertFile, UnsupportedFormatError } from "./router.js";
import { renderResult, setMarkdown, refreshFidelity } from "./result-view.js";
import { buildResultZip } from "./zipper.js";
import { PRESETS, formatWithPreset } from "./presets.js";

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
  if (current && !els.result.hidden) refreshFidelity(els, current.result);
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
  mdSize: document.getElementById("md-size"),
  fidelity: document.getElementById("fidelity-body"),
  btnCopy: document.getElementById("btn-copy"),
  btnZip: document.getElementById("btn-zip"),
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

    renderResult(payload, els);
    showResult();
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      showError(
        `That file type isn't supported yet. Works today: <code>.ipynb</code> · <code>.docx</code> · <code>.xlsx</code> · <code>.csv</code> · <code>.json</code> · <code>.html</code> · <code>.pdf</code> · <code>.srt</code> · <code>.md</code> · <code>.txt</code>.`
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

// --- input wiring ------------------------------------------------------------------

els.dropTarget.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) handleFile(file);
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
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

document.addEventListener("paste", (e) => {
  const file = e.clipboardData?.files?.[0];
  if (file) handleFile(file);
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
};

async function loadSample(name = "sales-analysis") {
  const filename = SAMPLES[name];
  if (!filename) return;
  const res = await fetch(`/assets/samples/${filename}`);
  const blob = await res.blob();
  handleFile(new File([blob], filename));
}

document.getElementById("btn-sample")?.addEventListener("click", () => loadSample());

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
  const { blob, name } = await buildResultZip({
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
