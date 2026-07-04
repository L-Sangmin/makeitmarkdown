// .tex parser — LaTeX sources (papers, theses, notes) to Markdown.
//
// Honest scope: this is a structural conversion, not a TeX engine.
// Sectioning, emphasis, lists, tabular tables, figures, equations and
// citations map over; custom macros are NOT expanded and math bodies are
// kept verbatim inside $$ fences. The fidelity warnings say exactly that.

import { qcScore, filenameStem, decodeText } from "../md-utils.js";

const PARSER_VERSION = "tex-1.0.0";

const stripComments = (s) =>
  s.replace(/(^|[^\\])%.*$/gm, "$1").replace(/\\%/g, "%");

const grab = (s, cmd) => {
  const m = new RegExp(`\\\\${cmd}\\*?\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}`).exec(s);
  return m ? m[1].trim() : "";
};

// Inline formatting inside already-extracted text.
export function texInline(t) {
  return t
    .replace(/\\textbf\{([^{}]*)\}/g, "**$1**")
    .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, "*$1*")
    .replace(/\\texttt\{([^{}]*)\}/g, "`$1`")
    .replace(/\\(?:cite[pt]?)\{([^{}]*)\}/g, (m, keys) => `[${keys}]`)
    .replace(/\\(?:ref|eqref|autoref)\{([^{}]*)\}/g, "(ref: $1)")
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\\footnote\{([^{}]*)\}/g, " ($1)")
    .replace(/\\url\{([^{}]*)\}/g, "<$1>")
    .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, "[$2]($1)")
    .replace(/~\s*/g, " ")
    .replace(/\\&/g, "&")
    .replace(/\\_/g, "_")
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:noindent|centering|small|large|Large|itshape|bfseries)\b/g, "")
    .replace(/\\ldots\b/g, "…")
    .replace(/``|''/g, '"');
}

function tabularToGfm(body) {
  const rows = body
    .replace(/\\(?:hline|toprule|midrule|bottomrule)/g, "")
    .split(/\\\\/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split("&").map((c) => texInline(c).replace(/\|/g, "\\|").trim()));
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const line = (r) => `| ${pad(r).join(" | ")} |`;
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

export const tex = {
  name: "tex",
  canHandle: (url, doc, filename) => /\.(tex|latex)$/i.test(filename ?? ""),

  async parse(input) {
    let src = stripComments(decodeText(input).replace(/\r\n/g, "\n"));
    const warnings = [];
    const figures = [];
    const tables = [];
    let equations = 0;

    const macroCount = (src.match(/\\(?:newcommand|def|renewcommand)\b/g) ?? []).length;
    if (macroCount) {
      warnings.push(
        `${macroCount} custom macro definition(s) found — macros are not expanded; text using them converts literally`
      );
    }

    const title = texInline(grab(src, "title")) || filenameStem(input.filename, "Document");
    const authors = grab(src, "author")
      ? grab(src, "author").split(/\\and|,/).map((a) => texInline(a).trim()).filter(Boolean)
      : [];
    const abstract = texInline(
      (/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(src)?.[1] ?? "").trim()
    );

    // figures → placeholders (url keeps the source path; caption from \caption)
    src = src.replace(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g, (m, body) => {
      const path = /\\includegraphics(?:\[[^\]]*\])?\{([^{}]*)\}/.exec(body)?.[1] ?? "";
      const caption = texInline(/\\caption\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(body)?.[1] ?? "");
      const id = (path.split("/").pop() || `figure_${figures.length + 1}`);
      figures.push({ id, caption: caption || `Figure ${figures.length + 1}`, url: path, alt: "" });
      return `\n[Figure: ${id}]${caption ? `\n*${caption}*` : ""}\n`;
    });

    // tables (table wrapper optional; tabular is the payload)
    src = src.replace(/\\begin\{tabular\}\{[^{}]*\}([\s\S]*?)\\end\{tabular\}/g, (m, body) => {
      const md = tabularToGfm(body);
      if (!md) return "";
      tables.push({ id: `table_${tables.length + 1}`, caption: "", markdown: md });
      return `\n${md}\n`;
    });
    src = src.replace(/\\(?:begin|end)\{table\*?\}/g, "").replace(/\\caption\{([^{}]*)\}/g, "*$1*");

    // count pre-existing display math before we add fences of our own
    equations += (src.match(/\$\$[^$]+\$\$/g) ?? []).length;

    // display math → $$ fences, body verbatim
    src = src.replace(
      /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g,
      (m, env, body) => {
        equations += 1;
        return `\n$$\n${body.trim()}\n$$\n`;
      }
    );

    // lists
    src = src
      .replace(/\\begin\{(?:itemize|enumerate)\}/g, "")
      .replace(/\\end\{(?:itemize|enumerate)\}/g, "")
      .replace(/^\s*\\item\s*/gm, "- ");

    // references
    const bibItems = [...src.matchAll(/\\bibitem\{([^{}]*)\}([\s\S]*?)(?=\\bibitem|\\end\{thebibliography\})/g)]
      .map(([, key, text]) => `- **[${key}]** ${texInline(text).replace(/\s+/g, " ").trim()}`);
    src = src.replace(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g, "");

    // split into sections
    const parts = src.split(/\\(section|subsection|subsubsection)\*?\{([^{}]*)\}/);
    const sections = [];
    if (abstract) sections.push({ heading: "Abstract", level: 2, content: abstract });
    // parts[0] is the preamble — dropped (documentclass, packages, maketitle)
    for (let i = 1; i < parts.length; i += 3) {
      const level = { section: 2, subsection: 3, subsubsection: 4 }[parts[i]];
      const heading = texInline(parts[i + 1]);
      const body = texInline(parts[i + 2] ?? "")
        .replace(/\\(?:maketitle|tableofcontents|newpage|clearpage|bigskip|medskip)\b/g, "")
        .replace(/\\begin\{[^{}]*\}|\\end\{[^{}]*\}/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      sections.push({ heading, level, content: body });
    }
    if (bibItems.length) sections.push({ heading: "References", level: 2, content: bibItems.join("\n") });
    if (!sections.length) {
      sections.push({ heading: "Document", level: 2, content: texInline(src).trim() });
      warnings.push("no \\section commands found — the document converted as one block");
    }

    warnings.push(
      "LaTeX conversion is structural, not a TeX engine — math bodies are kept verbatim in $$ fences and figure images are referenced by path, not extracted"
    );

    const result = {
      title,
      authors,
      abstract,
      sections,
      figures,
      tables,
      references: bibItems,
      doi: "",
      journal: "",
      year: null,
      fidelity: {
        detected: { tables: tables.length, figures: figures.length, equations, codeCells: 0 },
        recovered: { tables: tables.length, figures: figures.length, equations, codeCells: 0 },
        warnings,
        qcScore: 0,
      },
      meta: { sourceFormat: "tex", parserVersion: PARSER_VERSION, filename: input.filename },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
