// Standard Markdown (GFM) formatter — consumes the common parse schema
// (HANDOFF §10). Presets (§1.5.5) are option sets layered on top; they must
// not fork the schema or the pipeline. Minimal version: title + sections.

export function formatStandard(parseResult, preset = {}) {
  const out = [];
  if (parseResult.title) out.push(`# ${parseResult.title}`, "");

  for (const s of parseResult.sections ?? []) {
    const level = Math.min(6, Math.max(1, s.level ?? 2));
    out.push(`${"#".repeat(level)} ${s.heading}`, "");
    if (s.content) out.push(s.content, "");
  }
  return out.join("\n");
}
