// Input routing: detect what the user dropped/pasted and dispatch to a parser
// via the registry (parsers/index.js).
//
// Phase 1 scope: file upload / paste only (HANDOFF §14). URL auto-fetch and
// API-key inputs arrive in later phases — do not add them here yet.

import { findParser } from "./parsers/index.js";
import { ensureLibsFor } from "./loader.js";

export class UnsupportedFormatError extends Error {
  constructor(filename) {
    super(`No parser for "${filename}"`);
    this.name = "UnsupportedFormatError";
    this.filename = filename;
  }
}

export async function convertFile(file) {
  const parser = findParser(null, null, file.name);
  if (!parser) throw new UnsupportedFormatError(file.name);

  await ensureLibsFor(file.name);
  const fileBuffer = await file.arrayBuffer();
  const t0 = performance.now();
  const result = await parser.parse({ fileBuffer, filename: file.name });
  const ms = Math.max(1, Math.round(performance.now() - t0));
  return { result, ms, filename: file.name, fileBuffer };
}
