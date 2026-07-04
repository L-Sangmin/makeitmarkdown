#!/usr/bin/env node
// Generate public/sitemap.xml and public/robots.txt.
//
// Owner-run:  node scripts/generate-sitemap.mjs [--origin https://your-domain.tld]
// Re-run together with apply-meta.mjs when the domain changes.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPages, canonicalPathFor } from "./page-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

const origin = (() => {
  const i = process.argv.indexOf("--origin");
  return i === -1
    ? "https://makeitmarkdown.pages.dev"
    : process.argv[i + 1].replace(/\/$/, "");
})();

// offline.html is a service-worker fallback (noindex); 404.html is the
// Cloudflare Pages not-found page. Neither belongs in the sitemap.
const EXCLUDE = new Set(["offline.html", "404.html"]);

const urls = collectPages(pub)
  .filter((rel) => !EXCLUDE.has(rel))
  .map((rel) => `  <url><loc>${origin}${canonicalPathFor(rel)}</loc></url>`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

writeFileSync(join(pub, "sitemap.xml"), sitemap);
writeFileSync(join(pub, "robots.txt"), robots);
console.log(`sitemap.xml (${urls.length} urls) + robots.txt written (origin: ${origin})`);
