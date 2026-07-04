// Shared page inventory for the owner-run build scripts
// (generate-og.mjs, apply-meta.mjs, generate-sitemap.mjs).

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every public HTML page, as paths relative to public/.
// assets/ is excluded (sample fixtures live there).
export function collectPages(pub) {
  const pages = [];
  (function walk(dir) {
    for (const name of readdirSync(join(pub, dir))) {
      const rel = dir ? `${dir}/${name}` : name;
      const full = join(pub, rel);
      if (statSync(full).isDirectory()) {
        if (rel !== "assets") walk(rel);
      } else if (name.endsWith(".html")) {
        pages.push(rel);
      }
    }
  })("");
  return pages.sort();
}

// index.html -> home, blog/index.html -> blog-index, formats/pdf.html -> formats-pdf
export function slugFor(rel) {
  if (rel === "index.html") return "home";
  return rel.replace(/\.html$/, "").replaceAll("/", "-");
}

// Canonical URL path: index pages canonicalize to the directory.
export function canonicalPathFor(rel) {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel;
}
