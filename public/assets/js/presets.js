// Target presets (HANDOFF §1.5.5): small option sets layered on top of the
// two formatters. One schema → two formatters — presets never fork either.

import { formatStandard } from "./standard-formatter.js";
import { formatObsidian } from "./obsidian-formatter.js";

export const PRESETS = [
  {
    id: "standard",
    label: "Standard",
    hint: "Plain GFM, nothing added",
    format: (r) => formatStandard(r),
  },
  {
    id: "chat",
    label: "Chat",
    hint: "Token-lean for ChatGPT/Claude paste: long outputs truncated, token estimate up top",
    format: (r) => formatStandard(r, { truncateOutputLines: 12, tokenEstimate: true }),
  },
  {
    id: "rag",
    label: "RAG",
    hint: "Chunk-boundary comments and stable heading anchors for pipelines",
    format: (r) => formatStandard(r, { chunkComments: true, headingAnchors: true }),
  },
  {
    id: "obsidian",
    label: "Obsidian",
    hint: "Callouts, ![[wikilink]] figures and frontmatter for your vault",
    format: (r) => formatObsidian(r),
  },
  {
    id: "archive",
    label: "Archive",
    hint: "Full frontmatter (authors, DOI, year), faithful body for citation/archive",
    format: (r) => formatStandard(r, { frontmatter: "full" }),
  },
];

export function formatWithPreset(parseResult, presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  return preset.format(parseResult);
}
