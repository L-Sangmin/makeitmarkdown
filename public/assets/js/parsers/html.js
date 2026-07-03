// Parser: general HTML (.html file upload) — HANDOFF §4.1.
// Readability.js (Apache-2.0) isolates the main article (nav/ads stripped),
// then Turndown (MIT) converts to Markdown. Image URLs are kept as-is;
// relative references get a fidelity warning (ZIP-based recovery is a later
// phase).

import {
  makeTurndown,
  splitMarkdownSections,
  extractMdTables,
  qcScore,
  decodeText,
  filenameStem,
} from "../md-utils.js";

const PARSER_VERSION = "0.1.0";

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.html?$/i.test(filename);
  },

  async parse(input) {
    const Readability = globalThis.Readability;
    if (!Readability) throw new Error("Readability is not loaded");

    const filename = input.filename ?? "page.html";
    const htmlText = decodeText(input);
    const dom = new DOMParser().parseFromString(htmlText, "text/html");
    const documentTitle = dom.title?.trim();

    // Readability resolves relative URLs against the *app's* origin (the
    // uploaded file has no real base URL), which would poison the output.
    // Stash the original attributes and restore them after extraction.
    for (const el of dom.querySelectorAll("img[src]")) {
      el.setAttribute("data-mim-src", el.getAttribute("src"));
    }
    for (const el of dom.querySelectorAll("a[href]")) {
      el.setAttribute("data-mim-href", el.getAttribute("href"));
    }

    const warnings = [];
    let article = null;
    try {
      article = new Readability(dom, { charThreshold: 250 }).parse();
    } catch {
      article = null;
    }
    if (!article?.content) {
      warnings.push(
        "Readability could not isolate a main article — converted the full page body instead"
      );
    }
    const contentHtml = article?.content ?? dom.body?.innerHTML ?? htmlText;

    const contentDom = new DOMParser().parseFromString(contentHtml, "text/html");
    for (const el of contentDom.querySelectorAll("[data-mim-src]")) {
      el.setAttribute("src", el.getAttribute("data-mim-src"));
      el.removeAttribute("data-mim-src");
    }
    for (const el of contentDom.querySelectorAll("[data-mim-href]")) {
      el.setAttribute("href", el.getAttribute("data-mim-href"));
      el.removeAttribute("data-mim-href");
    }
    const tablesDetected = contentDom.querySelectorAll("table").length;

    const figures = [];
    let relativeImages = 0;
    for (const img of [...contentDom.querySelectorAll("img")]) {
      const src = img.getAttribute("src") ?? "";
      if (!/^(https?:|data:)/i.test(src)) relativeImages++;
      figures.push({
        id: `html_figure_${figures.length + 1}`,
        caption:
          img.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ||
          img.getAttribute("alt") ||
          `Figure ${figures.length + 1}`,
        url: src,
        alt: img.getAttribute("alt") ?? "",
      });
    }
    if (relativeImages) {
      warnings.push(
        `${relativeImages} local image reference(s) kept as relative links — they won't resolve outside the original site (ZIP upload for full recovery is a later phase)`
      );
    }

    const md = makeTurndown().turndown(contentDom.body.innerHTML);
    const sections = splitMarkdownSections(md, "Article");
    const mdTables = extractMdTables(md);

    const result = {
      title: article?.title?.trim() || documentTitle || filenameStem(filename, "page"),
      authors: article?.byline ? [article.byline.trim()] : [],
      abstract: article?.excerpt?.trim() || null,
      sections,
      figures,
      tables: mdTables.map((markdown, i) => ({ id: `table_${i + 1}`, caption: "", markdown })),
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity: {
        detected: {
          tables: tablesDetected,
          figures: figures.length,
          equations: 0,
          codeCells: 0,
        },
        recovered: {
          tables: mdTables.length,
          figures: (md.match(/!\[/g) ?? []).length,
          equations: 0,
        },
        warnings,
        qcScore: 0,
      },
      meta: { sourceFormat: "html", parserVersion: PARSER_VERSION },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
