// Builds the .pptx fixture/sample: 3 slides — title, bullets+notes,
// table+image+chart. Minimal but structurally faithful OOXML.
// Run: node scripts/make-pptx-fixture.mjs
import JSZip from "jszip";
import { writeFile } from "node:fs/promises";

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const sp = (ph, lines) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name=""/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${lines
  .map(([lvl, t]) => `<a:p><a:pPr lvl="${lvl}"/><a:r><a:t>${t}</a:t></a:r></a:p>`)
  .join("")}</p:txBody></p:sp>`;

const slide = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${A} ${P} ${R}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld></p:sld>`;

const slide1 = slide(
  sp("ctrTitle", [[0, "Quarterly Kickoff"]]) +
  sp("subTitle", [[0, "Operations review and priorities"]])
);

const slide2 = slide(
  sp("title", [[0, "Priorities"]]) +
  sp("body", [
    [0, "Ship the vendor consolidation"],
    [1, "Finish contract review"],
    [1, "Cut duplicate tooling"],
    [0, "Improve onboarding time"],
  ])
);

const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${[
  ["region", "units", "revenue"],
  ["North", "1204", "96432.10"],
  ["South", "980", "71210.55"],
]
  .map(
    (row) =>
      `<a:tr>${row
        .map((c) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${c}</a:t></a:r></a:p></a:txBody></a:tc>`)
        .join("")}</a:tr>`
  )
  .join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const pic = `<p:pic><p:nvPicPr><p:cNvPr id="8" name="chart.png"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr/></p:pic>`;

const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>`;

const slide3 = slide(sp("title", [[0, "Pipeline"]]) + tbl + pic + chart);

const notes2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${A} ${P} ${R}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${sp("body", [
  [0, "Emphasize the onboarding metric — it moved 40% last quarter."],
])}${sp("sldNum", [[0, "2"]])}</p:spTree></p:cSld></p:notes>`;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const zip = new JSZip();
zip.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`
);
zip.file(
  "ppt/presentation.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${A} ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>`
);
zip.file("ppt/slides/slide1.xml", slide1);
zip.file("ppt/slides/slide2.xml", slide2);
zip.file("ppt/slides/slide3.xml", slide3);
zip.file(
  "ppt/slides/_rels/slide3.xml.rels",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`
);
zip.file("ppt/media/image1.png", TINY_PNG);
zip.file("ppt/notesSlides/notesSlide2.xml", notes2);

const buf = await zip.generateAsync({ type: "nodebuffer" });
await writeFile("test/fixtures/quarterly-kickoff.pptx", buf);
await writeFile("public/assets/samples/quarterly-kickoff.pptx", buf);
console.log("wrote quarterly-kickoff.pptx —", buf.length, "bytes");
