import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { downloadPdfBytes } from "./pdfDownload.js";
import { meetingExportLines, meetingFileStem, type MeetingExportLine, type PaintMeetingContent } from "./paintMeeting.js";

function wrapText(text: string, font: { widthOfTextAtSize: (text: string, size: number) => number }, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export async function downloadMeetingPdf(content: PaintMeetingContent): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function ensure(height: number) {
    if (y - height >= margin) return;
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  function draw(line: MeetingExportLine) {
    const size = line.kind === "title" ? 16 : line.kind === "heading" ? 13 : 11;
    const face = line.kind === "body" ? font : bold;
    const gap = line.kind === "heading" || line.kind === "title" ? 16 : 4;
    const wrapped = wrapText(line.text, face, size, maxWidth);
    ensure(gap + wrapped.length * (size + 3));
    y -= gap;
    for (const text of wrapped) {
      page.drawText(text, { x: margin, y: y - size, size, font: face, color: rgb(0.1, 0.12, 0.16) });
      y -= size + 3;
    }
  }

  for (const line of meetingExportLines(content)) draw(line);
  downloadPdfBytes(await doc.save(), `${meetingFileStem(content)}.pdf`);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(line: MeetingExportLine): string {
  const size = line.kind === "title" ? 32 : line.kind === "heading" ? 26 : 22;
  const bold = line.kind === "body" ? "" : "<w:b/>";
  const before = line.kind === "heading" || line.kind === "title" ? 240 : 40;
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="40"/></w:pPr><w:r><w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line.text)}</w:t></w:r></w:p>`;
}

export async function downloadMeetingDocx(content: PaintMeetingContent): Promise<void> {
  const body = meetingExportLines(content).map(paragraph).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008"/></w:sectPr></w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${meetingFileStem(content)}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
