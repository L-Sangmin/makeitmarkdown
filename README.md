# MakeItMarkdown

> **Feed your LLM better.**

A free, browser-only workbench that converts technical documents into
LLM-ready Markdown — and shows you exactly what was detected along the way.

**Not a file converter.** MakeItMarkdown is a *context workbench*: drop in a
document, get Markdown structured for LLM and agentic use, and read a
fidelity report of what the parser detected and recovered. The result screen
is a three-panel trust view: original preview | converted Markdown |
fidelity report with a weighted QC score.

**Live site:** https://makeitmarkdown.pages.dev

## Privacy

**Your files never leave your browser.** All parsing and conversion run
client-side in JavaScript — no backend, no uploads, no runtime requests to
third parties. The claim is verifiable: load the page once and the whole
tool works offline (service worker), and the network tab stays empty while
you convert. Results are gone on refresh.

## Supported formats

15 input formats, one parser each:

| Input | What you get |
|---|---|
| `.ipynb` | Cell-addressable Markdown: cell IDs, execution-order warnings, dependency hints, an SVG dependency mini-map, figures extracted from base64 |
| `.docx` | Heading styles become a real outline; tables survive as GFM |
| `.pptx` | Slides as an addressable outline, speaker notes surfaced, charts confessed rather than faked |
| `.xlsx` / `.xls` | ISO dates instead of serials, cached formula values, one section per sheet |
| `.csv` / `.tsv` | Sniffed delimiters, typed columns, ragged rows repaired and reported |
| `.pdf` | Per-page text with honest limits; scanned pages are flagged, with opt-in local OCR |
| `.html` | Reader-style article extraction — content and tables kept, chrome discarded |
| `.json` / `.jsonl` | Structure outline plus record tables |
| `.eml` / `.mbox` | Decoded headers, newest message intact, quote pyramids truncated explicitly |
| `.tex` | The structure the PDF destroys: outline, fenced math, keyed citations |
| `.srt` / `.vtt` | Timestamped transcripts with compact time markers |
| `.md` / `.txt` | Structure QC, exact token counts, retargeting to other presets |

## Output presets

One parse schema, five presets: **Standard** (plain GFM), **Chat** (trimmed
outputs + token estimate for pasting), **RAG** (chunk anchors + stable IDs),
**Obsidian** (callouts, wikilinks, frontmatter), **Archive** (full
frontmatter, faithful body). Extracted figures ship as relative
`![…](figures/…)` links that render in GitHub, Obsidian and VS Code; the
`.zip` download bundles the images to match.

## Fidelity, not marketing

Every conversion gets a report: element counts the parser *detected*, what
it recovered, explicit warnings for anything lost, and a weighted QC score
(8 structural checks, partial credit). The wording is deliberate — the
report never says "preserved". Token savings are measured with the real
o200k tokenizer, in a worker, not estimated for effect.

## Context Lab

The site ships with a content library: 27 articles on feeding documents to
LLMs (retrieval failures, token budgeting, notebook conversion, tool
comparisons), 13 per-format guides, a field manual, and before/after
examples — all static pages, same design system.

## Development

Static site, no build step, no CDN — every third-party library is vendored
under `public/assets/vendor/` (offline- and CSP-safe).

```
python3 -m http.server 8710 -d public   # or: npx serve public
npm test                                # node --test — 101 tests
```

Tests run in Node against the same parser files the browser executes, with
vendored browser libraries mirrored by npm builds of identical versions.

## Architecture

One schema, many parsers, five presets. Every parser implements
`canHandle(...)` and `parse(input)` returning a shared result schema that
includes a `fidelity` block (detected/recovered element counts, warnings,
QC score). The formatters, presets, and trust-view UI all consume that one
schema, so a new format only ever means one new parser file in
`public/assets/js/parsers/`.

Deployed on Cloudflare Pages: output directory `public`, no build command.
Service worker versions the offline cache (`sw.js` — bump `VERSION` per
deploy).

## Licenses

Third-party libraries are MIT / BSD / Apache-2.0 only — full notices in
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). License for this
project's own code: not chosen yet (open-sourcing planned for a later phase).
