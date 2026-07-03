# MakeItMarkdown

> **Feed your LLM better.**

A free, browser-only workbench that converts technical documents into
LLM-friendly Markdown — and shows you exactly what was preserved.

**Not a file converter.** MakeItMarkdown is a *context workbench*: drop in a
document, get Markdown structured for LLM and agentic use, and see a fidelity
report of what was detected and recovered. The result screen is a three-panel
trust view: original preview | converted Markdown | fidelity report.

## Privacy

**Your files never leave your browser.** All parsing and conversion run
client-side in JavaScript. No backend, no upload, no storage. Results are
gone on refresh.

## Supported formats (Phase 1)

| Format | Approach |
|---|---|
| `.ipynb` | Cell-addressable Markdown: cell IDs, execution-order warnings, variable-dependency hints, SVG dependency minimap |
| `.docx` | mammoth.js → HTML → Turndown, heading semantics preserved |
| `.csv` | Header + column-type annotations, row summary, GFM table |
| `.html` | Readability.js main-content extraction → Turndown |
| `.pdf` | pdf.js text extraction (best-effort fallback) |

## Output

One parse schema → two formatters:

- **Standard Markdown** (GFM)
- **Obsidian** (callouts, wikilinks, frontmatter)

Target presets (chat paste / RAG pipeline / Obsidian vault / archive) tune
formatter options without forking the pipeline.

## Development

Static site, no build step. All third-party libraries load via CDN.

```
npx serve public
```

Deployed on Cloudflare Pages (output directory: `public`, no build command).

## Architecture

One schema, two formatters, presets on top. Every parser implements a common
interface — `canHandle(url, doc, filename)` and `parse(input)` returning a
shared result schema that includes a `fidelity` block (detected/recovered
element counts, warnings, QC score). The Standard and Obsidian formatters,
the target presets, and the trust-view UI all consume that one schema, so a
new format only ever means one new parser file in
`public/assets/js/parsers/`.

Tests run in Node against the same parser files the browser executes
(`npm test`), with the vendored browser libraries mirrored by npm builds of
identical versions.

## Licenses

Third-party libraries are MIT / BSD / Apache-2.0 only — full notices in
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). License for this
project's own code: not chosen yet (open-sourcing planned for a later phase).
