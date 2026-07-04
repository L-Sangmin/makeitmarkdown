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
  setMarkdown(els, current.markdown, current.result?.figures);
  resetExactCount();
  updateTokSave();
}

// --- token savings strip (top of the fidelity pane) -------------------------------
// Everything here is arithmetic on measured sizes: raw file bytes and Markdown
// characters, both at the same ≈4 chars/token estimate the size note uses.
// Prefill time uses a stated 1,000 tok/s reading rate — an assumption, labelled.

const tokSaveBox = document.getElementById("tok-save");
let tokSaveSeq = 0;

function fmtTok(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
}

// Raw side is exact only when the file is genuinely text (it decodes as
// UTF-8); binary containers (docx/pdf/…) keep a byte-based estimate — an
// exact token count of ZIP bytes would be a meaningless number.
function rawText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

// The raw side never changes when the preset does — cache it per buffer, or
// every preset click re-tokenizes the whole file and the UI feels stuck.
let rawTokCache = { buffer: null, count: 0, exact: false };

function rawTokens(buffer) {
  if (rawTokCache.buffer !== buffer) {
    const text = rawText(buffer);
    rawTokCache = {
      buffer,
      count: text !== null ? countTokensExact(text) : Math.round(buffer.byteLength / 4),
      exact: text !== null,
    };
  }
  return rawTokCache;
}

// Resolves after the browser has painted once — lets the ≈ estimate and its
// counting pulse reach the screen before the synchronous tokenizer pass blocks.
function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function renderTokSave({ before, after, beforeExact, afterExact }) {
  const reduction = 1 - after / before;
  const secSaved = (before - after) / 1000;
  const pctLabel =
    reduction >= 0.005 ? `&minus;${Math.round(reduction * 100)}%` : `&plusmn;0%`;
  const barPct = Math.max(2, Math.min(100, Math.round((after / before) * 100)));
  const timeNote =
    secSaved >= 0.1
      ? `&approx;${secSaved >= 10 ? Math.round(secSaved) : secSaved.toFixed(1)}s less prefill at 1k tok/s`
      : "about the same size";
  const mark = (exact) => (exact ? "" : "&approx;");

  tokSaveBox.title =
    (beforeExact && afterExact
      ? "Exact o200k token counts (the tokenizer current frontier models use)."
      : beforeExact || afterExact
        ? "Markdown side is an exact o200k count; the raw side of a binary container stays a byte-based ≈4 chars/token estimate."
        : "Estimates at ≈4 chars per token; exact o200k counts load in the background.") +
    " Prefill time assumes 1,000 tokens/s.";
  tokSaveBox.innerHTML = `
    <div class="tok-pct">
      <span class="tok-pct-num">${pctLabel}</span>
      <span class="tok-pct-label">tokens vs raw${beforeExact && afterExact ? " · o200k" : ""}</span>
      <div class="tok-bar" role="presentation"><span style="width:${barPct}%"></span></div>
    </div>
    <div class="tok-nums">
      <span class="tok-line"><span class="tok-k">raw file</span> ${mark(beforeExact)}${fmtTok(before)} tok</span>
      <span class="tok-line"><span class="tok-k">Markdown</span> ${mark(afterExact)}${fmtTok(after)} tok</span>
      <span class="tok-time">${timeNote}</span>
    </div>`;
  tokSaveBox.hidden = false;
}

function updateTokSave() {
  if (!tokSaveBox) return;
  const seq = ++tokSaveSeq;
  const rawBytes = current?.fileBuffer?.byteLength;
  if (!rawBytes || !current.markdown) {
    tokSaveBox.hidden = true;
    return;
  }
  // instant estimate first — exact numbers swap in when the tokenizer lands
  renderTokSave({
    before: Math.round(rawBytes / 4),
    after: Math.round(current.markdown.length / 4),
    beforeExact: false,
    afterExact: false,
  });

  tokSaveBox.classList.add("is-counting");
  const markdown = current.markdown;
  const buffer = current.fileBuffer;
  ensureTokenizer()
    .then(afterPaint)
    .then(() => {
      if (seq !== tokSaveSeq || current?.markdown !== markdown) return;
      const raw = rawTokens(buffer);
      const after = countTokensExact(markdown);
      renderTokSave({
        before: raw.count,
        after,
        beforeExact: raw.exact,
        afterExact: true,
      });
      tokSaveBox.classList.remove("is-counting");
      applyExactSizeNote(markdown, after);
    })
    .catch(() => {
      // offline before the tokenizer was cached — estimates stand
      tokSaveBox.classList.remove("is-counting");
    });
}

// Shared by the "count exactly" button and the automatic pass above.
function applyExactSizeNote(markdown, n = null) {
  if (current?.markdown !== markdown) return;
  if (n === null) n = countTokensExact(markdown);
  els.mdSize.textContent =
    `${markdown.length.toLocaleString("en-US")} chars · ${n.toLocaleString("en-US")} tokens (o200k)`;
  btnExact.hidden = true;
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

// --- original pane: header folds/expands it (auto-collapsed without a viewer) --

function setOriginalCollapsed(collapsed) {
  els.panes.classList.toggle("orig-collapsed", collapsed);
  els.btnOriginal.setAttribute("aria-expanded", String(!collapsed));
  els.btnOriginal.setAttribute(
    "aria-label",
    collapsed ? "Expand the original panel" : "Collapse the original panel"
  );
}

els.btnOriginal.addEventListener("click", () => {
  setOriginalCollapsed(!els.panes.classList.contains("orig-collapsed"));
});

// --- downloads: one button, a small menu for .md vs .zip --------------------------

const btnDownload = document.getElementById("btn-download");
const dlPop = document.querySelector(".dl-pop");

function setDlOpen(open) {
  dlPop.hidden = !open;
  btnDownload.setAttribute("aria-expanded", String(open));
}

btnDownload?.addEventListener("click", (e) => {
  e.stopPropagation();
  setDlOpen(dlPop.hidden);
});
document.addEventListener("click", (e) => {
  if (!dlPop.hidden && !e.target.closest(".dl-menu")) setDlOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dlPop.hidden) {
    e.stopImmediatePropagation(); // closing the menu must not also exit the result view
    setDlOpen(false);
    btnDownload.focus();
  }
});
dlPop?.addEventListener("click", (e) => {
  if (e.target.closest(".dl-item")) setDlOpen(false);
});

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
    applyExactSizeNote(current.markdown);
  } catch {
    // Most likely offline before the tokenizer was ever cached.
    btnExact.textContent = "count unavailable";
  }
});

// --- landing strips: gentle first-view reveal + stat count-up --------------------

if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const animateStat = (el) => {
    const m = /^(\d+)(.*)$/.exec(el.textContent.trim());
    if (!m) return;
    const target = Number(m[1]);
    const suffix = m[2];
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 700);
      el.textContent = `${Math.round(target * (1 - Math.pow(1 - p, 3)))}${suffix}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        entry.target.querySelectorAll(".stat-num").forEach(animateStat);
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.2 }
  );
  document.querySelectorAll(".strip").forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

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
    updateTokSave();
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
  // brief head-shake on the target (restart cleanly if already playing)
  els.dropTarget.classList.remove("is-rejected");
  void els.dropTarget.offsetWidth;
  els.dropTarget.classList.add("is-rejected");
  els.dropTarget.addEventListener(
    "animationend",
    () => els.dropTarget.classList.remove("is-rejected"),
    { once: true }
  );
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
    updateTokSave();
    maybeOfferOcr();
    showResult();
    saveToHistory(payload, activePreset);
    renderHistoryList();
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      showError(
        `That file type isn't supported yet. Works today: <code>.ipynb</code> · <code>.docx</code> · <code>.pptx</code> · <code>.xlsx</code> · <code>.csv</code> · <code>.json</code> · <code>.html</code> · <code>.pdf</code> · <code>.tex</code> · <code>.eml</code> · <code>.mbox</code> · <code>.srt</code> · <code>.md</code> · <code>.txt</code>. ` +
          `<a href="/blog/llm-file-upload-errors.html">Why files get rejected — and the workarounds →</a>`
      );
    } else if (NOT_READY.test(err.message ?? "")) {
      showError(
        `That format's parser isn't wired up yet — drop one of the supported types listed under the target.`
      );
    } else {
      showError(
        `Couldn't read that file: ${escapeText(err.message ?? "unknown error")}. ` +
          `<a href="/blog/#g5">Common fixes →</a>`
      );
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
  updateTokSave();
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
  updateTokSave();
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

// Files dropped on an article's CTA box arrive via IndexedDB (cta-drop.js).
// Consume-once: the entry is deleted before conversion starts.
(function consumeRelay() {
  if (!("indexedDB" in window)) return;
  const rq = indexedDB.open("mim-relay", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("files");
  rq.onsuccess = () => {
    const tx = rq.result.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const get = store.get("pending");
    get.onsuccess = () => {
      const entry = get.result;
      store.delete("pending");
      if (entry?.files?.length && Date.now() - entry.ts < 60_000) {
        handleFiles(entry.files);
      }
    };
  };
})();

// --- result actions ----------------------------------------------------------------------

document.getElementById("btn-new")?.addEventListener("click", showLanding);

function flashCopied() {
  const copyIcon = els.btnCopy.querySelector(".ic-copy");
  const checkIcon = els.btnCopy.querySelector(".ic-check");
  copyIcon.hidden = true;
  checkIcon.hidden = false;
  els.btnCopy.classList.add("is-done");
  els.btnCopy.setAttribute("aria-label", "Copied");

  let toast = els.btnCopy.querySelector(".copy-toast");
  if (!toast) {
    toast = document.createElement("span");
    toast.className = "copy-toast";
    toast.setAttribute("role", "status");
    toast.textContent = "Copied";
    els.btnCopy.appendChild(toast);
  }
  toast.classList.remove("is-shown");
  void toast.offsetWidth; // restart the animation on rapid re-copies
  toast.classList.add("is-shown");

  setTimeout(() => {
    copyIcon.hidden = false;
    checkIcon.hidden = true;
    els.btnCopy.classList.remove("is-done");
    els.btnCopy.setAttribute("aria-label", "Copy Markdown");
    toast.classList.remove("is-shown");
  }, 1400);
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
