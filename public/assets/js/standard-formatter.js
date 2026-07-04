// Standard Markdown (GFM) formatter — consumes the common parse schema
// (HANDOFF §10). Presets (§1.5.5) pass option sets; they never fork the
// schema or the parsers.
//
// options:
//   truncateOutputLines: number — cap fenced blocks under "**Output:**"
//   tokenEstimate: boolean      — prepend an estimate comment
//   chunkComments: boolean      — "<!-- chunk: slug -->" before sections
//   headingAnchors: boolean     — stable <a id="slug"></a> per section
//   frontmatter: "none"|"full"  — YAML header

import { makeSlugger, buildFrontmatter, linkifyFigures } from "./md-utils.js";

export function formatStandard(parseResult, options = {}) {
  const slug = makeSlugger();
  const out = [];

  if (options.frontmatter === "full") {
    out.push(buildFrontmatter(parseResult, "full"));
  }
  if (parseResult.title) out.push(`# ${parseResult.title}`, "");

  for (const s of parseResult.sections ?? []) {
    const level = Math.min(6, Math.max(1, s.level ?? 2));
    if (options.chunkComments || options.headingAnchors) {
      const id = slug(s.heading);
      if (options.chunkComments) out.push(`<!-- chunk: ${id} -->`);
      if (options.headingAnchors) out.push(`<a id="${id}"></a>`);
    }
    out.push(`${"#".repeat(level)} ${s.heading}`, "");
    let content = linkifyFigures(s.content ?? "", parseResult.figures);
    if (options.truncateOutputLines) {
      content = truncateOutputBlocks(content, options.truncateOutputLines);
    }
    if (content) out.push(content, "");
  }

  let md = out.join("\n");
  if (options.tokenEstimate) {
    const tokens = Math.round(md.length / 4);
    const chars = md.length >= 1000 ? `${(md.length / 1000).toFixed(1)}K chars` : `${md.length} chars`;
    md = `<!-- token estimate: ≈${tokens.toLocaleString("en-US")} tokens (${chars}) -->\n\n${md}`;
  }
  return md;
}

// Cap fenced blocks that follow an "**Output:**" marker. Source code blocks
// are left alone — only outputs are expendable in a token-lean paste.
function truncateOutputBlocks(content, maxLines) {
  const lines = content.split("\n");
  const out = [];
  let inOutput = false;
  let fence = null;
  let kept = 0;
  let dropped = 0;

  for (const line of lines) {
    if (!fence && /^\*\*Output:\*\*$/.test(line.trim())) inOutput = true;
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);

    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        if (dropped > 0) out.push(`… [+${dropped} more output lines]`);
        out.push(line);
        fence = null;
        continue;
      }
      if (inOutput && kept >= maxLines) {
        dropped++;
        continue;
      }
      kept++;
      out.push(line);
      continue;
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      kept = 0;
      dropped = 0;
      out.push(line);
      continue;
    }

    if (line.trim().startsWith("## ")) inOutput = false;
    out.push(line);
  }
  return out.join("\n");
}
