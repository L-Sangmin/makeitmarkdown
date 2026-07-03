// Lazy loader for the heavyweight vendored parser libraries. The landing
// page ships none of them (~2.4MB combined); the router pulls in exactly
// what the dropped file needs, once, on demand.

const VENDOR = "/assets/vendor";

const SCRIPT_LIBS = {
  mammoth: `${VENDOR}/mammoth-1.12.0.browser.min.js`,
  TurndownService: `${VENDOR}/turndown-7.2.4.js`,
  turndownPluginGfm: `${VENDOR}/turndown-plugin-gfm-1.0.2.js`,
  Readability: `${VENDOR}/readability-0.6.0.js`,
  XLSX: `${VENDOR}/xlsx-0.20.3.full.min.js`,
};

const LIBS_BY_EXT = {
  ipynb: [],
  csv: [],
  tsv: [],
  json: [],
  jsonl: [],
  ndjson: [],
  srt: [],
  vtt: [],
  md: [],
  markdown: [],
  txt: [],
  text: [],
  xlsx: ["XLSX"],
  xlsm: ["XLSX"],
  xls: ["XLSX"],
  docx: ["mammoth", "TurndownService", "turndownPluginGfm"],
  html: ["Readability", "TurndownService", "turndownPluginGfm"],
  htm: ["Readability", "TurndownService", "turndownPluginGfm"],
  pdf: ["pdfjs"],
};

const scriptPromises = new Map();

function loadScript(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.onload = resolve;
        el.onerror = () => reject(new Error(`failed to load ${src}`));
        document.head.appendChild(el);
      })
    );
  }
  return scriptPromises.get(src);
}

async function ensureLib(name) {
  if (name === "pdfjs") {
    if (!globalThis.pdfjsLib) {
      const mod = await import(`${VENDOR}/pdfjs-6.1.200.min.mjs`);
      mod.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdfjs-worker-6.1.200.min.mjs`;
      globalThis.pdfjsLib = mod;
    }
    return;
  }
  if (!globalThis[name]) await loadScript(SCRIPT_LIBS[name]);
}

export async function ensureLibsFor(filename) {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  for (const name of LIBS_BY_EXT[ext] ?? []) {
    await ensureLib(name);
  }
}
