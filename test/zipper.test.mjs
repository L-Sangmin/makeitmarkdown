import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

globalThis.JSZip = JSZip;

const { buildResultZip, buildBatchZip } = await import("../public/assets/js/zipper.js");

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("single result zip: md + figures folder", async () => {
  const { blob, name } = await buildResultZip({
    markdown: "# Hi",
    filename: "notes.ipynb",
    figures: [{ id: "cell_1_figure_1", url: PNG_URL, caption: "" }],
  });
  assert.equal(name, "notes-markdown.zip");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file("notes.md"));
  assert.ok(zip.file("figures/cell_1_figure_1.png"));
});

test("batch zip: one folder per source file, collisions suffixed", async () => {
  const payloads = [
    { markdown: "# A", filename: "report.docx", result: { figures: [] } },
    { markdown: "# B", filename: "report.csv", result: { figures: [] } },
    {
      markdown: "# C",
      filename: "nb.ipynb",
      result: { figures: [{ id: "f1", url: PNG_URL, caption: "" }] },
    },
  ];
  const { blob, name } = await buildBatchZip(payloads);
  assert.match(name, /^makeitmarkdown-batch-3-files\.zip$/);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file("report/report.md"), "first folder");
  assert.ok(zip.file("report-2/report.md"), "collision suffixed");
  assert.ok(zip.file("nb/nb.md"));
  assert.ok(zip.file("nb/figures/f1.png"));
});

test("zip: figure ids that already carry an extension are not doubled", async () => {
  const { blob } = await buildResultZip({
    markdown: "# t",
    filename: "deck.pptx",
    figures: [
      { id: "slide_3_image_1.png", url: PNG_URL },
      { id: "plain_id", url: PNG_URL.replace("image/png", "image/gif") },
    ],
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file("figures/slide_3_image_1.png"), "no double extension");
  assert.ok(zip.file("figures/plain_id.gif"), "gif mime mapped");
});
