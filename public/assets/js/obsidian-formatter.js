// Obsidian formatter — consumes the common parse schema (HANDOFF §10).
// Callout mapping per HANDOFF §7, figures as ![[wikilinks]] (matching the
// figures/ folder in the ZIP download), YAML frontmatter.

import { buildFrontmatter, figureFilename } from "./md-utils.js";

// HANDOFF §7: heading keyword → callout type. "-" = collapsed by default.
const CALLOUT_RULES = [
  { re: /abstract/i, tag: "abstract", collapsed: false },
  { re: /result|conclusion|summary|finding/i, tag: "important", collapsed: false },
  { re: /figure/i, tag: "example", collapsed: true },
  { re: /table/i, tag: "info", collapsed: true },
  { re: /method/i, tag: "warning", collapsed: false },
  { re: /limitation/i, tag: "caution", collapsed: false },
  { re: /supplement/i, tag: "note", collapsed: false },
  { re: /reference|bibliograph/i, tag: "quote", collapsed: true },
];

// Cell sections ("Cell [5] · type:code · id:…") never map to callouts —
// their headings are addresses, not semantic section names.
function calloutFor(heading) {
  if (/^Cell \[/.test(heading)) return null;
  return CALLOUT_RULES.find((r) => r.re.test(heading)) ?? null;
}

function wikifyFigures(content, figures) {
  let out = content;
  for (const fig of figures ?? []) {
    const filename = figureFilename(fig);
    const link = `![[figures/${filename}]]`;
    out = out
      .replaceAll(`[Figure: ${filename}]`, link)
      .replaceAll(`[Figure: ${fig.id}]`, link);
  }
  return out;
}

export function formatObsidian(parseResult, options = {}) {
  const out = [buildFrontmatter(parseResult, options.frontmatter ?? "basic")];

  if (parseResult.title) out.push(`# ${parseResult.title}`, "");

  for (const s of parseResult.sections ?? []) {
    const content = wikifyFigures(s.content ?? "", parseResult.figures);
    const callout = calloutFor(s.heading);

    if (callout) {
      out.push(`> [!${callout.tag}]${callout.collapsed ? "-" : ""} ${s.heading}`);
      for (const line of content.split("\n")) {
        out.push(line ? `> ${line}` : ">");
      }
      out.push("");
    } else {
      const level = Math.min(6, Math.max(1, s.level ?? 2));
      out.push(`${"#".repeat(level)} ${s.heading}`, "");
      if (content) out.push(content, "");
    }
  }
  return out.join("\n");
}
