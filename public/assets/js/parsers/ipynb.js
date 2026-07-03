// Parser: Jupyter Notebook (.ipynb) — top-priority differentiator (HANDOFF §4.1).
//
// Emits every cell as its own section ("Cell [n] · type:code · id:…"),
// flags execution-order changes, annotates approximate cross-cell variable
// dependencies (static regex analysis — NOT full dataflow), maps image
// outputs to figure placeholders, and truncates long text outputs.
//
// Returns the shared schema (HANDOFF §10) plus a `notebook` block consumed
// by the dependency DAG mini-map (ipynb-dag.js).

const PARSER_VERSION = "0.1.0";

const MAX_OUTPUT_LINES = 30;
const MAX_OUTPUT_CHARS = 4000;
const LARGE_SOURCE_CHARS = 300_000;

const DEPENDENCY_NOTE =
  'Dependency annotations ("depends on") are approximate cell dependency ' +
  "hints from static regex analysis of assignments and imports — not full " +
  "dataflow analysis. Re-assignments inside branches, dynamic scope tricks " +
  "and string-built code can fool them.";

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "case", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
  "match", "nonlocal", "not", "or", "pass", "raise", "return", "self", "try",
  "while", "with", "yield",
]);

const PY_BUILTINS = new Set([
  "abs", "all", "any", "ascii", "bin", "bool", "bytearray", "bytes",
  "callable", "chr", "classmethod", "compile", "complex", "delattr", "dict",
  "dir", "divmod", "enumerate", "eval", "exec", "filter", "float", "format",
  "frozenset", "getattr", "globals", "hasattr", "hash", "help", "hex", "id",
  "input", "int", "isinstance", "issubclass", "iter", "len", "list",
  "locals", "map", "max", "memoryview", "min", "next", "object", "oct",
  "open", "ord", "pow", "print", "property", "range", "repr", "reversed",
  "round", "set", "setattr", "slice", "sorted", "staticmethod", "str", "sum",
  "super", "tuple", "type", "vars", "zip", "Exception", "ValueError",
  "TypeError", "KeyError", "IndexError", "RuntimeError", "StopIteration",
  "NotImplementedError", "FileNotFoundError", "ZeroDivisionError",
]);

// ---------------------------------------------------------------------------
// input decoding & normalization

function decodeInput(input) {
  const src = input?.fileBuffer ?? input?.doc;
  if (src == null) {
    throw new Error("ipynb parser needs input.fileBuffer or input.doc");
  }
  if (typeof src === "string") return src;
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src);
  return new TextDecoder("utf-8").decode(bytes);
}

const joinText = (t) => (Array.isArray(t) ? t.join("") : (t ?? ""));

function normalizeCells(nb) {
  return (nb.cells ?? []).map((c, i) => {
    const position = i + 1;
    const execCount =
      c.cell_type === "code" && Number.isInteger(c.execution_count)
        ? c.execution_count
        : null;
    return {
      position,
      type: c.cell_type,
      id: typeof c.id === "string" && c.id ? c.id : `c${position}`,
      execCount,
      label: execCount != null ? String(execCount) : `p${position}`,
      source: joinText(c.source),
      outputs: Array.isArray(c.outputs) ? c.outputs : [],
      attachments: c.attachments ?? null,
    };
  });
}

// Markdown cells often embed figures as huge base64 data URIs (or nbformat
// attachment: refs). Both bloat the Markdown into unreadable token walls —
// extract them into figures[] and leave a [Figure: …] placeholder that the
// ZIP layout and the Obsidian wikilink pass both understand.
function extractMarkdownImages(cell, body, figures, fidelity) {
  let count = 0;

  const makeFigure = (alt, mime, b64) => {
    count += 1;
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const id = `cell_${cell.label}_figure_${count}`;
    figures.push({
      id,
      caption: alt || `Figure from Cell [${cell.label}]`,
      url: `data:${mime};base64,${b64}`,
      alt: alt ?? "",
    });
    fidelity.detected.figures += 1;
    fidelity.recovered.figures += 1;
    return `[Figure: ${id}.${ext}]`;
  };

  body = body.replace(
    /!\[([^\]]*)\]\(\s*data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+?)\s*\)/g,
    (_, alt, mime, b64) => makeFigure(alt, mime, b64.replace(/\s+/g, ""))
  );

  body = body.replace(/!\[([^\]]*)\]\(attachment:([^)\s]+)\)/g, (match, alt, name) => {
    const attachment = cell.attachments?.[decodeURIComponent(name)];
    const mime = attachment && Object.keys(attachment).find((k) => k.startsWith("image/"));
    if (!mime) return match; // unknown attachment — leave the reference alone
    return makeFigure(alt || name, mime, joinText(attachment[mime]).replace(/\s+/g, ""));
  });

  return body;
}

// ---------------------------------------------------------------------------
// static python analysis (approximate, line-based)

// Blanks out string/comment content while preserving line structure.
// Includes string prefixes (f"", rb'', …) so they can't leak as identifiers.
function stripStringsAndComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/[rRbBuUfF]{0,3}(?:"""[\s\S]*?"""|'''[\s\S]*?''')/g, blank)
    .replace(/[rRbBuUfF]{0,3}(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, blank)
    .replace(/#[^\n]*/g, blank);
}

function targetNames(fragment) {
  const names = [];
  for (const piece of fragment.split(",")) {
    const t = piece.trim().replace(/^[(*\s]+|[)\s]+$/g, "");
    // `df["col"]` / `obj.attr` are mutations of existing names, not new defs
    if (/^[A-Za-z_]\w*$/.test(t)) names.push(t);
  }
  return names;
}

// Names bound by an import statement line (`import numpy as np`,
// `from utils import helper as h`). These are "ambient" — excluded from
// dependency hints so every cell doesn't depend on the import cell.
function importedNames(part) {
  const asMatch = part.match(/\bas\s+([A-Za-z_]\w*)/);
  if (asMatch) return [asMatch[1]];
  const plain = part.trim().match(/^([A-Za-z_]\w*)/);
  return plain && plain[1] !== "*" ? [plain[1]] : [];
}

function importDefs(line) {
  let m;
  if ((m = line.match(/^\s*import\s+(.+)$/))) {
    return m[1].split(",").flatMap(importedNames);
  }
  if ((m = line.match(/^\s*from\s+\S+\s+import\s+(.+)$/))) {
    return m[1].replace(/[()]/g, "").split(",")
      .map((p) => p.trim()).filter(Boolean).flatMap(importedNames);
  }
  return [];
}

function lineDefs(line) {
  const defs = [];
  let m;

  if ((m = line.match(/^\s*(?:async\s+)?for\s+(.+?)\s+in\s/))) {
    defs.push(...targetNames(m[1]));
  }
  if ((m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/))) defs.push(m[1]);
  if ((m = line.match(/^\s*class\s+([A-Za-z_]\w*)/))) defs.push(m[1]);

  // `with … as x`, `except … as e` (import lines never reach here)
  const asRe = /\bas\s+([A-Za-z_]\w*)/g;
  while ((m = asRe.exec(line))) defs.push(m[1]);

  // simple / tuple / annotated assignment (not ==, not kwargs: line-anchored)
  if ((m = line.match(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/))) {
    defs.push(...targetNames(m[1]));
  }
  // augmented assignment reads the previous value too — caller adds the use
  if ((m = line.match(/^\s*([A-Za-z_]\w*)\s*(?:[+\-*/%&|^@]|\*\*|\/\/|<<|>>)=(?!=)/))) {
    defs.push(m[1]);
  }
  // walrus
  const walrus = /\(\s*([A-Za-z_]\w*)\s*:=/g;
  while ((m = walrus.exec(line))) defs.push(m[1]);

  return defs;
}

function lineUses(line, knownLocal, defNames = new Set()) {
  const uses = new Set();
  const seen = new Set();
  const idRe = /[A-Za-z_]\w*/g;
  let m;
  while ((m = idRe.exec(line))) {
    const name = m[0];
    const start = m.index;
    const isFirstOccurrence = !seen.has(name);
    seen.add(name);
    if (PY_KEYWORDS.has(name) || PY_BUILTINS.has(name)) continue;
    if (start > 0 && line[start - 1] === ".") continue; // attribute access
    // binding occurrence: `x = …`, `for x in …` — the first appearance of a
    // name this line defines is a write, not a read (`x = x + 1` keeps the
    // second occurrence as a read)
    if (isFirstOccurrence && defNames.has(name)) continue;
    // kwarg heuristic: `f(x=1)` — ident preceded by ( or , and followed by `=`
    const after = line.slice(start + name.length).match(/^\s*=(?!=)/);
    if (after) {
      const before = line.slice(0, start).trimEnd();
      const prev = before[before.length - 1];
      if (prev === "(" || prev === ",") continue;
    }
    if (!knownLocal.has(name)) uses.add(name);
  }
  return uses;
}

function analyzePythonCell(source) {
  const defines = new Set();
  const uses = new Set();
  const importAliases = new Set();
  const cleaned = stripStringsAndComments(source);
  let inImportParens = false;

  for (const raw of cleaned.split("\n")) {
    const t = raw.trim();
    if (!t) continue;

    // continuation lines of `from x import (a,\n b,\n c)`
    if (inImportParens) {
      for (const part of t.replace(/[()]/g, "").split(",")) {
        for (const name of importedNames(part)) {
          defines.add(name);
          importAliases.add(name);
        }
      }
      if (t.includes(")")) inImportParens = false;
      continue;
    }

    if (t.startsWith("%%")) continue; // cell magic header line
    if (t.startsWith("%") || t.startsWith("!")) continue; // line magic / shell

    if (/^(?:import|from)\s/.test(t)) {
      for (const name of importDefs(t)) {
        defines.add(name);
        importAliases.add(name);
      }
      if (t.includes("(") && !t.includes(")")) inImportParens = true;
      continue;
    }

    const augmented = t.match(/^([A-Za-z_]\w*)\s*(?:[+\-*/%&|^@]|\*\*|\/\/|<<|>>)=(?!=)/);
    if (augmented && !defines.has(augmented[1])) uses.add(augmented[1]);

    const defNames = new Set(lineDefs(raw));
    for (const u of lineUses(raw, defines, defNames)) uses.add(u);
    for (const d of defNames) defines.add(d);
  }
  return { defines, uses, importAliases };
}

// ---------------------------------------------------------------------------
// cross-cell dependency + execution-order analysis

function analyzeNotebook(cells, isPython) {
  const codeCells = cells.filter((c) => c.type === "code");
  const edges = []; // { from: position, to: position, vars: [] }
  const warnings = [];
  const execOrderFlags = [];

  // Execution-order changes: walk in notebook order, flag decreasing counts.
  let prevExec = null;
  for (const cell of codeCells) {
    if (cell.execCount == null) continue;
    if (prevExec != null && cell.execCount < prevExec) {
      cell.execOrderNote = `execution order changed — In[${cell.execCount}] appears after In[${prevExec}] in notebook order`;
      execOrderFlags.push(cell.position);
      warnings.push(
        `Cell [${cell.label}]: execution order changed (In[${cell.execCount}] appears after In[${prevExec}]) — outputs may not reflect top-to-bottom state`
      );
    }
    prevExec = Math.max(prevExec ?? -Infinity, cell.execCount);
  }

  const seen = new Map();
  for (const cell of codeCells) {
    if (cell.execCount == null) continue;
    if (seen.has(cell.execCount)) {
      warnings.push(
        `duplicate execution count In[${cell.execCount}] — notebook was partially re-run; cell numbering may be ambiguous`
      );
    }
    seen.set(cell.execCount, cell.position);
  }

  if (!isPython) {
    return { edges, warnings, execOrderFlags, analyzed: false, importAliases: new Set() };
  }

  // Pass 1: per-cell static analysis; imported names are ambient notebook-wide.
  const importAliases = new Set();
  for (const cell of codeCells) {
    cell.analysis = analyzePythonCell(cell.source);
    for (const a of cell.analysis.importAliases) importAliases.add(a);
  }

  // Pass 2: dependency links in execution order (nulls last, stable by position).
  const ordered = [...codeCells].sort(
    (a, b) => (a.execCount ?? Infinity) - (b.execCount ?? Infinity) || a.position - b.position
  );
  const definedBy = new Map(); // name -> cell (latest definer so far)
  const pendingForwardUses = [];

  for (const cell of ordered) {
    const { defines, uses } = cell.analysis;
    const deps = new Map(); // definer position -> Set(vars)

    for (const name of uses) {
      if (importAliases.has(name)) continue; // ambient import, not dataflow
      const definer = definedBy.get(name);
      if (definer) {
        if (!deps.has(definer.position)) deps.set(definer.position, new Set());
        deps.get(definer.position).add(name);
      } else {
        pendingForwardUses.push({ name, cell });
      }
    }

    cell.deps = [...deps.entries()]
      .map(([position, vars]) => ({ position, vars: [...vars].sort() }))
      .sort((a, b) => a.position - b.position);
    for (const d of cell.deps) {
      edges.push({ from: d.position, to: cell.position, vars: d.vars });
    }
    for (const name of defines) {
      if (!importAliases.has(name)) definedBy.set(name, cell);
    }
  }

  // Forward uses: name resolved only by a cell that runs later.
  const forward = [];
  for (const { name, cell } of pendingForwardUses) {
    const definer = definedBy.get(name);
    if (definer && definer !== cell) {
      forward.push(
        `\`${name}\` used in Cell [${cell.label}] but defined only in Cell [${definer.label}] — value likely came from an earlier run`
      );
    }
  }
  const MAX_FORWARD = 10;
  warnings.push(...forward.slice(0, MAX_FORWARD));
  if (forward.length > MAX_FORWARD) {
    warnings.push(`… +${forward.length - MAX_FORWARD} more variables used before their defining cell ran`);
  }

  return { edges, warnings, execOrderFlags, analyzed: true, importAliases };
}

// ---------------------------------------------------------------------------
// markdown emission helpers

function fence(text, lang = "") {
  const runs = text.match(/`{3,}/g);
  const len = runs ? Math.max(3, Math.max(...runs.map((r) => r.length)) + 1) : 3;
  const f = "`".repeat(len);
  return `${f}${lang}\n${text.replace(/\n$/, "")}\n${f}`;
}

function truncateOutput(text) {
  const lines = text.split("\n");
  const overLines = lines.length > MAX_OUTPUT_LINES + 1;
  const overChars = text.length > MAX_OUTPUT_CHARS;
  if (!overLines && !overChars) return { text, truncated: false };

  let kept = lines.slice(0, MAX_OUTPUT_LINES);
  let body = kept.join("\n");
  if (body.length > MAX_OUTPUT_CHARS) body = body.slice(0, MAX_OUTPUT_CHARS);
  const omitted = Math.max(0, lines.length - kept.length);
  const marker =
    omitted > 0
      ? `… [output truncated: ${omitted} more lines]`
      : `… [output truncated: ${text.length - body.length} more characters]`;
  return { text: `${body}\n${marker}`, truncated: true };
}

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------------------
// parser

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && filename.toLowerCase().endsWith(".ipynb");
  },

  async parse(input) {
    const nb = JSON.parse(decodeInput(input));
    if (!Number.isInteger(nb.nbformat) || nb.nbformat < 4) {
      throw new Error(
        `unsupported notebook format (nbformat ${nb.nbformat ?? "unknown"}) — only nbformat 4+ is supported`
      );
    }

    const filename = input.filename ?? "notebook.ipynb";
    const language = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? "unknown";
    const kernel = nb.metadata?.kernelspec?.display_name ?? language;
    const isPython = language === "python";

    const cells = normalizeCells(nb);
    const { edges, warnings, execOrderFlags, analyzed, importAliases } = analyzeNotebook(cells, isPython);

    const figures = [];
    const fidelity = {
      detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
      recovered: { tables: 0, figures: 0, equations: 0 },
      warnings,
      qcScore: 0,
    };
    let truncatedOutputs = 0;

    const labelByPosition = new Map(cells.map((c) => [c.position, c.label]));
    const sections = [];

    for (const cell of cells) {
      const flags = [];
      if (cell.type === "code") {
        fidelity.detected.codeCells += 1;
        if (cell.execCount == null) flags.push("(not executed)");
      }
      const heading = `Cell [${cell.label}] · type:${cell.type}${flags.length ? " " + flags.join(" ") : ""} · id:${cell.id.slice(0, 8)}`;
      const parts = [];

      if (cell.execOrderNote) parts.push(`> ⚠ ${cell.execOrderNote}`);

      if (cell.deps?.length) {
        const list = cell.deps
          .flatMap((d) =>
            d.vars.map((v) => `\`${v}\` (defined in Cell [${labelByPosition.get(d.position)}])`)
          )
          .join(", ");
        parts.push(`> ⚠️ depends on: ${list}`);
      }

      if (cell.type === "markdown") {
        const body = extractMarkdownImages(cell, cell.source.trimEnd(), figures, fidelity);
        parts.push(body);
        // detected-only counts from markdown content
        fidelity.detected.equations += (body.match(/\$\$[\s\S]+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)/g) ?? []).length;
        const mdTables = (body.match(/^\s*\|.+\|\s*$/gm) ?? []).length > 1 ? 1 : 0;
        fidelity.detected.tables += mdTables;
        fidelity.recovered.tables += mdTables; // markdown tables pass through verbatim
        fidelity.recovered.equations += (body.match(/\$\$[\s\S]+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)/g) ?? []).length;
      } else if (cell.type === "code") {
        parts.push(fence(cell.source.trimEnd(), isPython ? "python" : language));
        const rendered = renderOutputs(cell, figures, fidelity, () => (truncatedOutputs += 1));
        if (rendered.length) parts.push("**Output:**", ...rendered);
      } else {
        parts.push(fence(cell.source.trimEnd()));
      }

      sections.push({ heading, level: 2, content: parts.filter(Boolean).join("\n\n") });
    }

    // overview section (prepended)
    const codeCount = fidelity.detected.codeCells;
    const mdCount = cells.filter((c) => c.type === "markdown").length;
    const rawCount = cells.length - codeCount - mdCount;
    const unexecuted = cells.filter((c) => c.type === "code" && c.execCount == null).length;
    const execLine = execOrderFlags.length
      ? `⚠ ${execOrderFlags.length} cell(s) executed out of notebook order`
      : "execution counts are in notebook order";
    const importList = [...importAliases].sort();
    const shownImports = importList.slice(0, 12);
    const importLine =
      analyzed && importAliases.size
        ? `- Imports: ${shownImports.map((a) => `\`${a}\``).join(", ")}` +
          (importList.length > shownImports.length ? ` (+${importList.length - shownImports.length} more)` : "") +
          ` — imported names, excluded from dependency hints`
        : null;
    const overview = [
      `- Source: \`${filename}\` · ${kernel} (${language})`,
      `- Cells: ${cells.length} (${codeCount} code · ${mdCount} markdown${rawCount ? ` · ${rawCount} raw` : ""}${unexecuted ? ` · ${unexecuted} not executed` : ""})`,
      `- Execution: ${execLine}`,
      importLine,
      "",
      `> ${analyzed ? DEPENDENCY_NOTE : `Dependency hints are only available for Python notebooks (kernel here: ${language}).`}`,
    ].filter((l) => l !== null).join("\n");
    sections.unshift({ heading: "Notebook overview", level: 2, content: overview });

    if (truncatedOutputs) {
      warnings.push(`${truncatedOutputs} long output(s) truncated to ${MAX_OUTPUT_LINES} lines`);
    }
    const sourceChars = cells.reduce((n, c) => n + c.source.length, 0);
    if (sourceChars > LARGE_SOURCE_CHARS) {
      warnings.push(
        `very large notebook: ~${Math.round(sourceChars / 1000)}K chars of cell source (≈${Math.round(sourceChars / 4 / 1000)}K tokens) — may exceed smaller model contexts`
      );
    }

    // title: first markdown H1, else filename stem
    const firstH1 = cells
      .filter((c) => c.type === "markdown")
      .map((c) => c.source.match(/^#\s+(.+?)\s*$/m)?.[1])
      .find(Boolean);
    const title = firstH1 ?? filename.replace(/\.ipynb$/i, "");

    const result = {
      title,
      authors: [],
      abstract: null,
      sections,
      figures,
      tables: [],
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity,
      meta: {
        sourceFormat: "ipynb",
        parserVersion: PARSER_VERSION,
        language,
        kernel,
        cellCounts: { code: codeCount, markdown: mdCount, raw: rawCount },
      },
      notebook: {
        dependencyNote: DEPENDENCY_NOTE,
        analyzed,
        execOrderFlags,
        cells: cells.map((c) => ({
          position: c.position,
          label: c.label,
          display: c.execCount != null ? `In[${c.execCount}]` : `[${c.label}]`,
          type: c.type,
          execCount: c.execCount,
        })),
        edges,
      },
    };

    fidelity.qcScore = qcScore(result);
    return result;
  },
};

// ---------------------------------------------------------------------------
// outputs

function renderOutputs(cell, figures, fidelity, onTruncate) {
  const blocks = [];
  let figureIndex = 0;

  for (const out of cell.outputs) {
    switch (out.output_type) {
      case "stream": {
        blocks.push(textBlock(joinText(out.text), onTruncate));
        break;
      }
      case "execute_result":
      case "display_data": {
        const data = out.data ?? {};
        const imageMime = ["image/png", "image/jpeg"].find((m) => data[m]);
        if (imageMime) {
          figureIndex += 1;
          const ext = imageMime === "image/png" ? "png" : "jpg";
          const id = `cell_${cell.label}_output_${figureIndex}`;
          const b64 = joinText(data[imageMime]).replace(/\n/g, "");
          figures.push({
            id,
            caption: `Output of Cell [${cell.label}]`,
            url: `data:${imageMime};base64,${b64}`,
            alt: `Figure output of cell ${cell.label}`,
          });
          fidelity.detected.figures += 1;
          fidelity.recovered.figures += 1;
          blocks.push(`[Figure: ${id}.${ext}]`);
        } else if (data["text/plain"]) {
          if (/<table/i.test(joinText(data["text/html"] ?? ""))) {
            fidelity.detected.tables += 1;
            fidelity.recovered.tables += 1; // text/plain rendering of the table is kept
          }
          blocks.push(textBlock(joinText(data["text/plain"]), onTruncate));
        } else if (data["text/html"]) {
          if (/<table/i.test(joinText(data["text/html"]))) fidelity.detected.tables += 1;
          blocks.push("_[HTML output omitted — no plain-text fallback]_");
        }
        break;
      }
      case "error": {
        const tb = stripAnsi((out.traceback ?? []).join("\n"));
        const { text } = truncateOutput(tb);
        blocks.push(`**Error:** \`${out.ename}: ${out.evalue}\``, fence(text));
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

function textBlock(raw, onTruncate) {
  const { text, truncated } = truncateOutput(raw.replace(/\n$/, ""));
  if (truncated) onTruncate();
  return fence(text);
}

// QC per HANDOFF §16, expressed as a fraction instead of a boolean.
function qcScore(r) {
  const checks = [
    (r.title?.length ?? 0) > 0,
    (r.sections?.length ?? 0) >= 3,
    (r.figures ?? []).every((f) => f.url && f.caption),
    (r.tables ?? []).every((t) => t.markdown),
    !r.sections?.some((s) => /\?\?|□□/.test(s.content)),
  ];
  return checks.filter(Boolean).length / checks.length;
}
