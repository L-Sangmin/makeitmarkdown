// UI entry point.
//
// Phase 1 frame (HANDOFF §1.5):
// - First screen: one big input target, privacy note beneath it,
//   no pipeline-explainer sidebar.
// - Result screen: 3-panel trust view — original | Markdown | fidelity.
// - Advanced options (format toggle, download) appear only after a result
//   exists (progressive disclosure). Nothing persists across refresh.

import { convertFile, UnsupportedFormatError } from "./router.js";
import { renderResult } from "./result-view.js";
import { buildResultZip } from "./zipper.js";
import { formatStandard } from "./standard-formatter.js";

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

// --- views ----------------------------------------------------------------------

function showResult() {
  els.landing.hidden = true;
  els.result.hidden = false;
}

function showLanding() {
  els.result.hidden = true;
  els.landing.hidden = false;
  current = null;
  els.fileInput.value = "";
  hideError();
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

async function handleFile(file) {
  hideError();
  try {
    const payload = await convertFile(file);
    payload.markdown = formatStandard(payload.result);
    current = payload;

    const time = payload.ms < 1000 ? `${payload.ms}ms` : `${(payload.ms / 1000).toFixed(1)}s`;
    els.meta.textContent = `${payload.filename} · converted in ${time} · processed locally — refresh clears it`;

    renderResult(payload, els);
    showResult();
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      showError(
        `That file type isn't supported. Today: <code>.ipynb</code> — coming: <code>.docx</code> · <code>.csv</code> · <code>.html</code> · <code>.pdf</code>.`
      );
    } else if (NOT_READY.test(err.message ?? "")) {
      showError(
        `That format's parser lands in a later phase. <code>.ipynb</code> works today — try a notebook.`
      );
    } else {
      showError(`Couldn't read that file: ${escapeText(err.message ?? "unknown error")}`);
    }
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

const SAMPLES = ["sales-analysis", "out-of-order"];

async function loadSample(name = "sales-analysis") {
  if (!SAMPLES.includes(name)) return;
  const res = await fetch(`/assets/samples/${name}.ipynb`);
  const blob = await res.blob();
  handleFile(new File([blob], `${name}.ipynb`, { type: "application/x-ipynb+json" }));
}

document.getElementById("btn-sample")?.addEventListener("click", () => loadSample());

// Deep link for demos/tests: /?sample=sales-analysis | out-of-order
const sampleParam = new URLSearchParams(location.search).get("sample");
if (sampleParam) loadSample(sampleParam === "1" ? "sales-analysis" : sampleParam);

// --- result actions ----------------------------------------------------------------------

document.getElementById("btn-new")?.addEventListener("click", showLanding);

els.btnCopy?.addEventListener("click", async () => {
  if (!current) return;
  await navigator.clipboard.writeText(current.markdown);
  const old = els.btnCopy.textContent;
  els.btnCopy.textContent = "Copied ✓";
  setTimeout(() => (els.btnCopy.textContent = old), 1200);
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
