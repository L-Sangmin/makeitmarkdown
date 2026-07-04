#!/usr/bin/env node
// Inject canonical + Open Graph + Twitter tags into every public page.
//
// Owner-run, idempotent (re-running replaces the managed block):
//   node scripts/apply-meta.mjs [--origin https://your-domain.tld]
//
// The origin defaults to the Cloudflare Pages project URL; when the
// custom domain goes live, re-run with --origin (and re-run
// generate-sitemap.mjs) — nothing else references the domain.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPages, slugFor, canonicalPathFor } from "./page-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

const origin = (() => {
  const i = process.argv.indexOf("--origin");
  return i === -1
    ? "https://makeitmarkdown.pages.dev"
    : process.argv[i + 1].replace(/\/$/, "");
})();

const BEGIN = "  <!-- meta:managed (scripts/apply-meta.mjs) -->";
const END = "  <!-- /meta:managed -->";

let changed = 0;
for (const rel of collectPages(pub)) {
  const file = join(pub, rel);
  let html = readFileSync(file, "utf8");

  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1].trim();
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!title) {
    console.warn(`skip (no title): ${rel}`);
    continue;
  }

  const canonical = origin + canonicalPathFor(rel);
  const ogImage = `${origin}/assets/og/${slugFor(rel)}.png`;
  const ogType = rel.startsWith("blog/") && rel !== "blog/index.html"
    ? "article"
    : "website";
  const isOffline = rel === "offline.html";

  if (!existsSync(join(pub, "assets/og", slugFor(rel) + ".png"))) {
    console.warn(`warn (no og image yet): ${rel}`);
  }

  const lines = [
    BEGIN,
    `  <link rel="canonical" href="${canonical}" />`,
    `  <meta property="og:site_name" content="MakeItMarkdown" />`,
    `  <meta property="og:type" content="${ogType}" />`,
    `  <meta property="og:url" content="${canonical}" />`,
    `  <meta property="og:title" content="${escapeAttr(title)}" />`,
    desc ? `  <meta property="og:description" content="${escapeAttr(desc)}" />` : null,
    `  <meta property="og:image" content="${ogImage}" />`,
    `  <meta property="og:image:width" content="1200" />`,
    `  <meta property="og:image:height" content="630" />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    isOffline ? `  <meta name="robots" content="noindex" />` : null,
    END,
  ].filter(Boolean);

  // Drop any previously managed block, plus hand-written og tags that the
  // managed block replaces (index.html had a partial set).
  html = html.replace(
    new RegExp(`\\n?${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}`),
    "",
  );
  html = html.replace(
    /^\s*<meta property="og:(title|description|type)"[^>]*\/>\n/gm,
    "",
  );

  // Insert right after the description (or the title when there is none).
  const anchor = desc
    ? html.match(/^.*<meta name="description"[^>]*\/>.*$/m)[0]
    : html.match(/^.*<\/title>.*$/m)[0];
  html = html.replace(anchor, anchor + "\n" + lines.join("\n"));

  writeFileSync(file, html);
  changed++;
}

function escapeAttr(s) {
  return s.replaceAll('"', "&quot;");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log(`meta applied to ${changed} pages (origin: ${origin})`);
