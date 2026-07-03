// .eml parser — a saved email becomes headers + a readable body, with
// long quoted reply chains truncated *explicitly* (the classic token sink)
// and attachments listed rather than silently dropped.
//
// MIME essentials handled: multipart/* recursion, base64 and
// quoted-printable transfer encodings, RFC 2047 encoded-word subjects.

import { qcScore, filenameStem, decodeText, extractMdTables, makeTurndown } from "../md-utils.js";

const PARSER_VERSION = "eml-1.0.0";

const MAX_QUOTED_LINES = 8; // per contiguous quoted block

function splitHeadersBody(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const idx = text.indexOf("\n\n");
  if (idx === -1) return { header: text, body: "" };
  return { header: text.slice(0, idx), body: text.slice(idx + 2) };
}

function parseHeaders(block) {
  const headers = {};
  let last = null;
  for (const line of block.split("\n")) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] += " " + line.trim();
    } else {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        last = m[1].toLowerCase();
        headers[last] = m[2];
      }
    }
  }
  return headers;
}

// RFC 2047: =?charset?B|Q?data?=
export function decodeEncodedWords(value) {
  return (value ?? "").replace(
    /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
    (all, charset, enc, data) => {
      try {
        if (enc.toUpperCase() === "B") {
          const bin = atob(data);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          return new TextDecoder(charset).decode(bytes);
        }
        const qp = data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (m, h) =>
          String.fromCharCode(parseInt(h, 16))
        );
        return new TextDecoder(charset).decode(Uint8Array.from(qp, (c) => c.charCodeAt(0)));
      } catch {
        return all;
      }
    }
  );
}

function decodeBody(body, headers) {
  const enc = (headers["content-transfer-encoding"] ?? "").trim().toLowerCase();
  const charset = headers["content-type"]?.match(/charset="?([\w-]+)"?/i)?.[1] ?? "utf-8";
  if (enc === "base64") {
    try {
      const bin = atob(body.replace(/\s+/g, ""));
      return new TextDecoder(charset).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    const joined = body.replace(/=\n/g, "");
    const bytes = [];
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
        bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        // charCodeAt is fine: QP source is 7-bit by construction
        bytes.push(joined.charCodeAt(i));
      }
    }
    return new TextDecoder(charset).decode(Uint8Array.from(bytes));
  }
  return body;
}

// Walk a MIME tree collecting the best body parts and attachment names.
function walkPart(headers, body, found) {
  const ct = (headers["content-type"] ?? "text/plain").toLowerCase();
  const disp = headers["content-disposition"] ?? "";

  if (/attachment/i.test(disp)) {
    const name =
      disp.match(/filename="?([^";]+)"?/i)?.[1] ??
      headers["content-type"]?.match(/name="?([^";]+)"?/i)?.[1] ??
      "unnamed";
    found.attachments.push({ name: decodeEncodedWords(name), bytes: Math.round((body.length * 3) / 4) });
    return;
  }

  if (ct.startsWith("multipart/")) {
    const boundary = headers["content-type"]?.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!boundary) return;
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*\\n?`));
    for (const part of parts) {
      if (!part.trim()) continue;
      const { header, body: sub } = splitHeadersBody(part.replace(/^\n+/, ""));
      walkPart(parseHeaders(header), sub, found);
    }
    return;
  }

  const decoded = decodeBody(body, headers).trim();
  if (!decoded) return;
  if (ct.startsWith("text/plain") && !found.plain) found.plain = decoded;
  else if (ct.startsWith("text/html") && !found.html) found.html = decoded;
}

// Collapse long quoted reply chains, keeping the shape and the confession.
export function truncateQuotedChains(text) {
  const lines = text.split("\n");
  const out = [];
  let truncated = 0;
  let i = 0;
  while (i < lines.length) {
    if (/^\s*>/.test(lines[i])) {
      let j = i;
      while (j < lines.length && /^\s*>|^\s*$/.test(lines[j])) j++;
      const block = lines.slice(i, j);
      const quoted = block.filter((l) => /^\s*>/.test(l));
      if (quoted.length > MAX_QUOTED_LINES) {
        out.push(...block.slice(0, MAX_QUOTED_LINES));
        const dropped = quoted.length - MAX_QUOTED_LINES;
        out.push(`> … (${dropped} more quoted lines truncated)`);
        truncated += dropped;
      } else {
        out.push(...block);
      }
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return { text: out.join("\n"), truncated };
}

export const eml = {
  name: "eml",
  canHandle: (url, doc, filename) => /\.eml$/i.test(filename ?? ""),

  async parse(input) {
    const raw = decodeText(input);
    const { header, body } = splitHeadersBody(raw);
    const headers = parseHeaders(header);
    const warnings = [];

    const found = { plain: null, html: null, attachments: [] };
    walkPart(headers, body, found);

    let bodyMd = found.plain;
    if (!bodyMd && found.html) {
      if (globalThis.TurndownService) {
        bodyMd = makeTurndown().turndown(found.html);
      } else {
        bodyMd = found.html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
        warnings.push("HTML-only message converted without a Markdown pass — formatting flattened");
      }
    }
    if (!bodyMd) {
      bodyMd = "";
      warnings.push("no readable text part found in this message");
    }

    const { text: cleanBody, truncated } = truncateQuotedChains(bodyMd);
    if (truncated) {
      warnings.push(`long quoted reply chain truncated (${truncated} quoted lines) — token sink; the newest message is intact`);
    }

    const subject = decodeEncodedWords(headers.subject ?? "").trim();
    const meta = [
      ["From", headers.from],
      ["To", headers.to],
      ["Cc", headers.cc],
      ["Date", headers.date],
      ["Subject", subject],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `- **${k}:** ${decodeEncodedWords(String(v))}`)
      .join("\n");

    const sections = [
      { heading: "Message", level: 2, content: meta },
      { heading: "Body", level: 2, content: cleanBody },
    ];

    if (found.attachments.length) {
      warnings.push(
        `${found.attachments.length} attachment${found.attachments.length === 1 ? "" : "s"} listed but not extracted — save them from your mail client if needed`
      );
      sections.push({
        heading: "Attachments",
        level: 2,
        content: found.attachments
          .map((a) => `- \`${a.name}\` (~${a.bytes >= 1024 ? `${Math.round(a.bytes / 1024)} KB` : `${a.bytes} B`}, not extracted)`)
          .join("\n"),
      });
    }

    const tables = extractMdTables(cleanBody);

    const result = {
      title: subject || filenameStem(input.filename, "Email message"),
      authors: headers.from ? [decodeEncodedWords(headers.from)] : [],
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
      meta: { sourceFormat: "eml", parserVersion: PARSER_VERSION, filename: input.filename },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
