// .pptx parser — slides become sections, tables become GFM, embedded
// images become extracted figures, charts are counted honestly.
//
// A .pptx is a ZIP of XML parts (like .docx). We read the slide parts
// directly with DOMParser rather than pulling in a presentation library:
// text lives in <a:t> runs, tables in <a:tbl>, pictures in <p:pic>.
// Namespace prefixes vary by producer, so all matching is by localName.

import { qcScore, filenameStem, toArrayBuffer } from "../md-utils.js";

const PARSER_VERSION = "pptx-1.0.0";

function byLocal(root, name) {
  const out = [];
  for (const el of root.getElementsByTagName("*")) {
    if (el.localName === name) out.push(el);
  }
  return out;
}

const textOf = (el) => byLocal(el, "t").map((t) => t.textContent).join("");

const escapePipes = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function phType(sp) {
  const ph = byLocal(sp, "ph")[0];
  return ph?.getAttribute("type") ?? null;
}

// Paragraphs of a shape → markdown lines (bullet level from a:pPr@lvl).
function shapeLines(sp) {
  const lines = [];
  for (const p of byLocal(sp, "p")) {
    const text = byLocal(p, "t").map((t) => t.textContent).join("").trim();
    if (!text) continue;
    const lvl = Number(byLocal(p, "pPr")[0]?.getAttribute("lvl") ?? 0);
    lines.push(`${"  ".repeat(lvl)}- ${text}`);
  }
  return lines;
}

function tableToMarkdown(tbl) {
  const rows = byLocal(tbl, "tr").map((tr) =>
    byLocal(tr, "tc").map((tc) => escapePipes(textOf(tc).trim()))
  );
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const line = (r) => `| ${pad(r).join(" | ")} |`;
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

async function relTargets(zip, slidePath) {
  // ppt/slides/slide3.xml → ppt/slides/_rels/slide3.xml.rels
  const relPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
  const entry = zip.file(relPath);
  if (!entry) return new Map();
  const xml = new DOMParser().parseFromString(await entry.async("text"), "text/xml");
  const map = new Map();
  for (const rel of byLocal(xml, "Relationship")) {
    map.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
  }
  return map;
}

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp" };

export const pptx = {
  name: "pptx",
  canHandle: (url, doc, filename) => /\.pptx$/i.test(filename ?? ""),

  async parse(input) {
    const zip = await globalThis.JSZip.loadAsync(toArrayBuffer(input.fileBuffer));

    const slideEntries = zip
      .file(/^ppt\/slides\/slide\d+\.xml$/)
      .sort((a, b) => Number(a.name.match(/(\d+)/)[1]) - Number(b.name.match(/(\d+)/)[1]));
    if (!slideEntries.length) throw new Error("no slides found — is this a .pptx presentation?");

    const sections = [];
    const tables = [];
    const figures = [];
    const warnings = [];
    let docTitle = "";
    let chartCount = 0;
    let notesCount = 0;

    for (const entry of slideEntries) {
      const n = Number(entry.name.match(/slide(\d+)\.xml$/)[1]);
      const xml = new DOMParser().parseFromString(await entry.async("text"), "text/xml");
      const rels = await relTargets(zip, entry.name);
      const body = [];
      let slideTitle = "";
      let imgIndex = 0;

      const tree = byLocal(xml, "spTree")[0] ?? xml;
      for (const el of tree.children) {
        if (el.localName === "sp") {
          const type = phType(el);
          if (type === "title" || type === "ctrTitle") {
            slideTitle = textOf(el).trim();
          } else if (type === "sldNum" || type === "ftr" || type === "dt") {
            // slide furniture — skip
          } else {
            body.push(...shapeLines(el));
          }
        } else if (el.localName === "graphicFrame") {
          const data = byLocal(el, "graphicData")[0];
          const uri = data?.getAttribute("uri") ?? "";
          if (uri.endsWith("/table")) {
            const md = tableToMarkdown(byLocal(el, "tbl")[0]);
            if (md) {
              const id = `slide_${n}_table_${tables.length + 1}`;
              tables.push({ id, caption: `Slide ${n} table`, markdown: md });
              body.push("", md, "");
            }
          } else if (uri.endsWith("/chart")) {
            chartCount += 1;
            body.push(`*[Chart on slide ${n} — data not extracted]*`);
          }
        } else if (el.localName === "pic") {
          imgIndex += 1;
          const embed = byLocal(el, "blip")[0]?.getAttribute("r:embed")
            ?? byLocal(el, "blip")[0]?.getAttributeNS?.("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
          const target = embed ? rels.get(embed) : null;
          const ext = (target?.match(/\.(\w+)$/)?.[1] ?? "png").toLowerCase();
          const id = `slide_${n}_image_${imgIndex}.${ext}`;
          let url = "";
          if (target) {
            const mediaPath = target.replace(/^(\.\.\/)+/, "ppt/");
            const media = zip.file(mediaPath);
            if (media) {
              url = `data:${MIME_BY_EXT[ext] ?? "application/octet-stream"};base64,${await media.async("base64")}`;
            }
          }
          figures.push({ id, caption: `Slide ${n} image ${imgIndex}`, url, alt: "" });
          body.push(`[Figure: ${id}]`);
        }
      }

      // Speaker notes: notesSlideN.xml conventionally pairs with slideN.
      const notesEntry = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
      if (notesEntry) {
        const nx = new DOMParser().parseFromString(await notesEntry.async("text"), "text/xml");
        const noteLines = [];
        for (const sp of byLocal(nx, "sp")) {
          const type = phType(sp);
          if (type === "sldNum" || type === "sldImg") continue;
          const t = textOf(sp).trim();
          if (t) noteLines.push(t);
        }
        if (noteLines.length) {
          notesCount += 1;
          body.push("", `**Speaker notes:** ${noteLines.join(" ")}`);
        }
      }

      if (!docTitle && slideTitle) docTitle = slideTitle;
      sections.push({
        heading: slideTitle ? `Slide ${n} · ${slideTitle}` : `Slide ${n}`,
        level: 2,
        content: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      });
    }

    if (chartCount) {
      warnings.push(
        `${chartCount} chart${chartCount === 1 ? "" : "s"} detected — chart data lives in embedded worksheets and was not extracted`
      );
    }
    warnings.push("slide layout is visual — reading order within a slide is approximate");

    const result = {
      title: docTitle || filenameStem(input.filename, "Presentation"),
      authors: [],
      abstract: "",
      sections,
      figures,
      tables,
      references: [],
      doi: "",
      journal: "",
      year: null,
      fidelity: {
        detected: { tables: tables.length, figures: figures.length, equations: 0, codeCells: 0 },
        recovered: { tables: tables.length, figures: figures.length, equations: 0, codeCells: 0 },
        warnings,
        qcScore: 0,
      },
      meta: {
        sourceFormat: "pptx",
        parserVersion: PARSER_VERSION,
        filename: input.filename,
        notesSlides: notesCount,
      },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
