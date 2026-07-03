// Parser: subtitles (.srt / .vtt) — pure JS, no libraries.
// Transcripts are prime LLM input trapped in a hostile format: block
// numbers, timestamps and markup tags triple the tokens. Emit a clean
// transcript with one compact [mm:ss] marker per cue; skip malformed
// blocks with a count instead of failing.

import { qcScore, decodeText, filenameStem } from "../md-utils.js";

const PARSER_VERSION = "0.1.0";

// "00:00:01,000" / "00:01.000" / "01:02:03.500" → seconds
function toSeconds(stamp) {
  const parts = stamp.replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

function marker(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `[${h}:${mm}:${ss}]` : `[${mm}:${ss}]`;
}

const TIMING = /^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s+--&?>?\s*-*>?\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/;
const TIMING_LINE = /-->/;

const cleanText = (s) =>
  s
    .replace(/<[^>\n]*>/g, "") // inline markup (<i>, <b>, <c.color>…)
    .replace(/\{\\an\d\}/g, "") // ass-style positioning that leaks into srt
    .replace(/\s+/g, " ")
    .trim();

export default {
  canHandle(url, doc, filename) {
    return typeof filename === "string" && /\.(srt|vtt)$/i.test(filename);
  },

  async parse(input) {
    const filename = input.filename ?? "subtitles.srt";
    const raw = decodeText(input).replace(/^﻿/, "").replace(/\r\n?/g, "\n");

    const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const cues = [];
    let skipped = 0;

    for (const block of blocks) {
      const lines = block.split("\n");
      if (/^WEBVTT/i.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

      const timingIndex = lines.findIndex((l) => TIMING_LINE.test(l));
      if (timingIndex === -1) {
        skipped += 1;
        continue;
      }
      const m = TIMING.exec(lines[timingIndex].trim());
      const start = m ? toSeconds(m[1]) : null;
      const text = cleanText(lines.slice(timingIndex + 1).join(" "));
      if (start === null || !text) {
        skipped += 1;
        continue;
      }
      cues.push({ start, end: m ? toSeconds(m[2]) : null, text });
    }

    if (!cues.length) {
      throw new Error("no readable cues found — is this really an SRT/VTT subtitle file?");
    }

    const warnings = [];
    if (skipped) warnings.push(`${skipped} block(s) without a valid timestamp were skipped`);

    const last = cues[cues.length - 1];
    const duration = marker(last.end ?? last.start).replace(/[[\]]/g, "");
    const transcript = cues.map((c) => `${marker(c.start)} ${c.text}`).join("\n");

    const result = {
      title: filenameStem(filename, "transcript"),
      authors: [],
      abstract: null,
      sections: [
        {
          heading: "Overview",
          level: 2,
          content: [
            `- Source: \`${filename}\``,
            `- ${cues.length} cues · runs to ${duration}`,
            `- Markup tags and cue settings stripped; one \`[mm:ss]\` marker per cue`,
          ].join("\n"),
        },
        { heading: "Transcript", level: 2, content: transcript },
      ],
      figures: [],
      tables: [],
      references: [],
      doi: null,
      journal: null,
      year: null,
      fidelity: {
        detected: { tables: 0, figures: 0, equations: 0, codeCells: 0 },
        recovered: { tables: 0, figures: 0, equations: 0 },
        warnings,
        qcScore: 0,
      },
      meta: { sourceFormat: "subtitles", parserVersion: PARSER_VERSION, cues: cues.length },
    };
    result.fidelity.qcScore = qcScore(result);
    return result;
  },
};
