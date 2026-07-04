// .mbox parser — a whole mailbox archive, split into messages and parsed
// with the .eml machinery (decoded headers, quote truncation, attachment
// listing per message).

import { qcScore, filenameStem, decodeText } from "../md-utils.js";
import { eml } from "./eml.js";

const PARSER_VERSION = "mbox-1.0.0";
const MAX_MESSAGES = 50;

export const mbox = {
  name: "mbox",
  canHandle: (url, doc, filename) => /\.mbox$/i.test(filename ?? ""),

  async parse(input) {
    const raw = decodeText(input).replace(/\r\n/g, "\n");
    // mbox separator: "From " at line start (the mboxrd quoting ">From"
    // stays inside message bodies untouched).
    const chunks = raw
      .split(/^From [^\n]*\n/m)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!chunks.length) throw new Error("no messages found — is this an mbox archive?");

    const shown = chunks.slice(0, MAX_MESSAGES);
    const sections = [];
    const tables = [];
    const warnings = [];
    let truncatedQuotes = 0;
    let attachments = 0;

    for (let i = 0; i < shown.length; i++) {
      const r = await eml.parse({ doc: shown[i], filename: input.filename });
      const meta = r.sections.find((s) => s.heading === "Message")?.content ?? "";
      const body = r.sections.find((s) => s.heading === "Body")?.content ?? "";
      const att = r.sections.find((s) => s.heading === "Attachments")?.content;
      tables.push(...r.tables);
      for (const w of r.fidelity.warnings) {
        if (/quoted reply chain/.test(w)) truncatedQuotes += 1;
        else if (/attachment/.test(w)) attachments += 1;
      }
      sections.push({
        heading: `Message ${i + 1} · ${r.title}`,
        level: 2,
        content: [meta, "", body, att ? `\n**Attachments:**\n${att}` : ""].join("\n").trim(),
      });
    }

    if (chunks.length > shown.length) {
      warnings.push(
        `archive holds ${chunks.length} messages — showing the first ${MAX_MESSAGES}; split the mbox for the rest`
      );
    }
    if (truncatedQuotes) {
      warnings.push(`quoted reply chains truncated in ${truncatedQuotes} message(s) — the newest text in each is intact`);
    }
    if (attachments) {
      warnings.push(`${attachments} message(s) carry attachments — listed by name, not extracted`);
    }

    const result = {
      title: `${filenameStem(input.filename, "Mailbox")} — ${chunks.length} message${chunks.length === 1 ? "" : "s"}`,
      authors: [],
      abstract: "",
      sections,
      figures: [],
      tables,
      references: [],
      doi: "",
      journal: "",
      year: null,
      fidelity: {
        detected: { tables: tables.length, figures: 0, equations: 0, codeCells: 0 },
        recovered: { tables: tables.length, figures: 0, equations: 0, codeCells: 0 },
        warnings,
        qcScore: 0,
      },
      meta: { sourceFormat: "mbox", parserVersion: PARSER_VERSION, filename: input.filename },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
