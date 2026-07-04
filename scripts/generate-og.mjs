#!/usr/bin/env node
// Generate 1200×630 Open Graph PNGs for every public page.
//
// Owner-run build script (never runs for visitors):
//   node scripts/generate-og.mjs [--only <substring>]
//
// For each public/**/*.html page it extracts the kicker, the h1 and the
// page's hero SVG (article-hero/icon-hero), composes a 1200×630 card in
// the site's light-theme design language, and renders it to
// public/assets/og/<slug>.png with the system Chrome in headless mode.
// No runtime or npm dependencies beyond the existing dev ones (jsdom).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { collectPages, slugFor } from "./page-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const outDir = join(pub, "assets", "og");
const tmpDir = join(root, ".og-tmp");

const CHROME =
  process.env.OG_CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? null : process.argv[i + 1];
})();

const fontSans = pathToFileURL(join(pub, "assets/fonts/inter-var-latin.woff2"));
const fontMono = pathToFileURL(
  join(pub, "assets/fonts/jetbrains-mono-var-latin.woff2"),
);

// Light-theme token values (mirrors :root in assets/css/main.css).
const T = {
  bg: "#fafafa",
  raised: "#ffffff",
  fg: "#18181b",
  muted: "#52525b",
  faint: "#71717a",
  border: "#e4e4e7",
  accent: "#4f46e5",
  accentSoft: "#f4f3fd",
  ok: "#15803d",
  warn: "#b45309",
};

function extract(file) {
  const html = readFileSync(file, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const h1 = doc.querySelector("h1")?.textContent?.trim() ?? "MakeItMarkdown";
  const kicker =
    doc.querySelector(".article-kicker")?.textContent?.trim() ?? "";
  const hero =
    doc.querySelector('[class*="article-hero"] svg')?.outerHTML ?? null;
  return { h1, kicker, hero };
}

// The favicon mark, blown up as the fallback art.
function markArt() {
  return `<svg viewBox="0 0 32 32" width="240" height="240">
    <rect width="32" height="32" rx="7" fill="${T.accent}"/>
    <text x="13" y="22.5" font-family="'JetBrains Mono',monospace" font-size="16" font-weight="700" fill="white" text-anchor="middle">M</text>
    <path d="M24 12v7.5m0 0l-3.4-3.4m3.4 3.4l3.4-3.4" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}

function extArt(ext) {
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:64px;font-weight:600;color:${T.accent};letter-spacing:-0.02em">${ext}</div>`;
}

function artFor(rel, hero) {
  if (hero) {
    // Hero SVGs size themselves for the article column; let them fill the tile.
    const svg = hero
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "");
    return `<div class="hero-svg">${svg}</div>`;
  }
  const fmt = rel.match(/^formats\/([a-z]+)\.html$/);
  if (fmt && fmt[1] !== "index") return extArt("." + fmt[1]);
  return markArt();
}

function cardHtml({ h1, kicker, art }) {
  const kickerHtml = kicker
    ? `<p class="kicker">${escapeHtml(kicker)}</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Inter"; src: url("${fontSans}") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "JetBrains Mono"; src: url("${fontMono}") format("woff2"); font-weight: 100 800; }
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: ${T.bg}; color: ${T.fg};
    font-family: "Inter", system-ui, sans-serif;
    display: flex; flex-direction: column;
    padding: 64px 72px 56px;
    border-bottom: 14px solid ${T.accent};
  }
  .wordmark { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .row { flex: 1; display: flex; align-items: center; gap: 64px; }
  .text { flex: 1; min-width: 0; }
  .kicker {
    font-family: "JetBrains Mono", monospace; font-size: 22px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.14em; color: ${T.accent};
    margin-bottom: 26px;
  }
  h1 {
    font-size: 66px; line-height: 1.12; font-weight: 700; letter-spacing: -0.025em;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .tile {
    width: 430px; height: 310px; flex: none;
    background: ${T.accentSoft}; border: 1px solid ${T.border}; border-radius: 28px;
    display: flex; align-items: center; justify-content: center;
    color: ${T.muted};
    --fg: ${T.fg}; --fg-muted: ${T.muted}; --fg-faint: ${T.faint};
    --bg: ${T.bg}; --bg-raised: ${T.raised}; --border: ${T.border};
    --border-strong: #d0d0d5; --accent: ${T.accent}; --accent-soft: rgb(79 70 229 / 0.06);
    --ok: ${T.ok}; --warn: ${T.warn};
    --font-mono: "JetBrains Mono", monospace; --font-sans: "Inter", sans-serif;
  }
  .hero-svg { width: 360px; height: 250px; display: flex; align-items: center; justify-content: center; }
  .hero-svg svg { width: 100%; height: 100%; }
  .foot {
    display: flex; align-items: center; gap: 12px;
    font-size: 22px; color: ${T.faint};
  }
  .foot .lock { color: ${T.muted}; }
  </style></head><body>
    <div class="wordmark">MakeItMarkdown</div>
    <div class="row">
      <div class="text">${kickerHtml}<h1>${escapeHtml(h1)}</h1></div>
      <div class="tile">${art}</div>
    </div>
    <p class="foot"><svg class="lock" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Runs in your browser — files never leave it.</p>
  </body></html>`;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const pages = collectPages(pub).filter((p) => !only || p.includes(only));
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

let done = 0;
for (const rel of pages) {
  const slug = slugFor(rel);
  const { h1, kicker, hero } = extract(join(pub, rel));
  const html = cardHtml({ h1, kicker, art: artFor(rel, hero) });
  const tmpHtml = join(tmpDir, slug + ".html");
  writeFileSync(tmpHtml, html);
  const out = join(outDir, slug + ".png");
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    `--screenshot=${out}`,
    pathToFileURL(tmpHtml).href,
  ], { stdio: "pipe" });
  done++;
  console.log(`og ✓ ${slug}.png  (${relative(pub, join(pub, rel))})`);
}
rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${done} OG images written to public/assets/og/`);
