import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import JSZip from "jszip";
import logoUrl from "../assets/ironwood-logo.jpeg";
import { downloadPdfBytes } from "./pdfDownload.js";
import {
  formatMeetingDate,
  meetingFileStem,
  sortAttendees,
  sortMeetingLines,
  type MeetingGroup,
  type MeetingJobLine,
  type PaintMeetingContent,
} from "./paintMeeting.js";

const NAVY = "002060";
const GRAY = "D9D9D9";
const ATTENDEE_WIDTHS = [2070, 1170, 2070, 1530, 3330, 1350];
const AGENDA_WIDTHS = [1350, 7380, 2340];

type Align = "left" | "center";

type Block = {
  text: string;
  /** Bold prefix on the same line. The rest of `text` stays regular. */
  boldLead?: string;
  /** Half-points, matching Word. */
  size: number;
  bold?: boolean;
  color?: string;
  underline?: boolean;
  align?: Align;
  before?: number;
  after?: number;
  /** Word line spacing in twips. 240 is single, 360 is 1.5. */
  line?: number;
};

type Cell = {
  twips: number;
  fill?: string;
  valign?: "center";
  blocks: Block[];
};

type Row = {
  cells: Cell[];
  minTwips?: number;
};

const black = rgb(0, 0, 0);
const navy = rgb(0, 32 / 255, 96 / 255);
const gray = rgb(217 / 255, 217 / 255, 217 / 255);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withColon(title: string): string {
  const text = title.trim();
  if (!text) return "";
  return text.endsWith(":") ? text : `${text}:`;
}

function whenLine(content: PaintMeetingContent): string {
  const date = formatMeetingDate(content.meetingDate);
  const time = content.meetingTime.trim();
  return [date, time].filter(Boolean).join(" @ ");
}

function filledJob(line: MeetingJobLine): boolean {
  return Boolean(line.company.trim() || line.job.trim() || line.notes.trim());
}

function jobsOf(group: MeetingGroup): MeetingJobLine[] {
  const rows = sortMeetingLines(group.lines, group.sort).filter(filledJob);
  return rows.length ? rows : [{ id: "", company: "", job: "", notes: "" }];
}

function topicBlocks(body: string): { title: string; notes: string }[] {
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return [{ title: "", notes: "" }];
  return blocks.map((block) => {
    const [first, ...rest] = block.split(/\n/);
    const title = (first ?? "").trim();
    const notes = rest.join("\n").trim();
    if (title.length <= 60 && (notes || title.length <= 40)) return { title, notes };
    return { title: "", notes: block };
  });
}

function block(text: string, size: number, extra: Partial<Block> = {}): Block {
  return { text, size, ...extra };
}

function cell(twips: number, blocks: Block[], extra: Partial<Cell> = {}): Cell {
  return { twips, blocks: blocks.length ? blocks : [block("", 18)], ...extra };
}

function headerCell(twips: number, text: string): Cell {
  return cell(twips, [block(text, 20, { bold: true, align: "center" })], { fill: GRAY, valign: "center" });
}

function buildAgenda(content: PaintMeetingContent): { preface: Block[]; attendees: Row[]; agenda: Row[] } {
  const when = whenLine(content);
  const preface: Block[] = [
    block(content.title.trim() || "Meeting Agenda – ICBI Paint Division", 28, { bold: true, after: 200, line: 240 }),
    block(when, 20, { boldLead: "Meeting Date: ", line: 360 }),
  ];
  if (content.purpose.trim()) preface.push(block(content.purpose.trim(), 20, { boldLead: "Meeting Purpose: ", line: 360 }));
  if (content.nextMeeting.trim()) preface.push(block(content.nextMeeting.trim(), 20, { boldLead: "Next Meeting Scheduled: ", line: 360 }));
  preface.push(block("Attendees", 20, { bold: true, before: 80, line: 240 }));

  const people = sortAttendees(content.attendees, content.attendeeSort).filter(
    (person) => person.name.trim() || person.company.trim() || person.email.trim(),
  );
  const attendees: Row[] = [
    {
      minTwips: 289,
      cells: ["Name", "Company", "Position", "Phone", "Email", "Present"].map((label, index) =>
        headerCell(ATTENDEE_WIDTHS[index] ?? 1000, label),
      ),
    },
    ...people.map((person) => ({
      cells: [person.name, person.company, person.position, person.phone, person.email, person.present ? "Present" : "Absent"].map(
        (value, index) =>
          cell(ATTENDEE_WIDTHS[index] ?? 1000, [block(value.trim(), 18, { align: index === 0 ? "left" : "center" })], {
            valign: "center",
          }),
      ),
    })),
  ];

  const agenda: Row[] = [];
  let section = 0;
  const sections: { title: string; rows: { company: string; title: string; notes: string }[] }[] = [
    ...content.groups.map((group) => ({
      title: group.title,
      rows: jobsOf(group).map((job) => ({ company: job.company.trim(), title: job.job.trim(), notes: job.notes.trim() })),
    })),
    ...content.topics.map((topic) => ({
      title: topic.title,
      rows: topicBlocks(topic.body).map((item) => ({ company: "", title: item.title, notes: item.notes })),
    })),
  ];

  for (const part of sections) {
    section += 1;
    agenda.push({
      minTwips: 400,
      cells: [
        cell(AGENDA_WIDTHS[0], [block(`${section}.0`, 28, { bold: true, align: "center" })], { fill: GRAY, valign: "center" }),
        cell(AGENDA_WIDTHS[1], [block(withColon(part.title), 28, { bold: true })], { fill: GRAY, valign: "center" }),
        cell(AGENDA_WIDTHS[2], [block("", 18)], { fill: GRAY }),
      ],
    });
    part.rows.forEach((row, index) => {
      const middle: Block[] = [];
      if (row.title) middle.push(block(row.title, 22, { bold: true, color: NAVY, underline: true, before: 40, after: 60 }));
      if (row.notes) middle.push(block(row.notes, 18, { after: 40 }));
      agenda.push({
        cells: [
          cell(AGENDA_WIDTHS[0], [
            block(`${section}.${index + 1}`, 20, { align: "center", before: 40 }),
            block(row.company, 18, { align: "center", after: 40 }),
          ]),
          cell(AGENDA_WIDTHS[1], middle),
          cell(AGENDA_WIDTHS[2], [block("", 18)]),
        ],
      });
    });
  }

  return { preface, attendees, agenda };
}

function runProps(item: Block, bold: boolean): string {
  return [
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>`,
    bold ? "<w:b/>" : "",
    item.color ? `<w:color w:val="${item.color}"/>` : "",
    item.underline ? `<w:u w:val="single"/>` : "",
    `<w:sz w:val="${item.size}"/>`,
    `<w:szCs w:val="${item.size}"/>`,
  ].join("");
}

function runXml(text: string, item: Block, bold = Boolean(item.bold)): string {
  const props = runProps(item, bold);
  const lines = text.split(/\n/);
  return lines
    .map((line, index) => {
      const br = index > 0 ? `<w:r><w:rPr>${props}</w:rPr><w:br/></w:r>` : "";
      return `${br}<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`;
    })
    .join("");
}

function paragraphXml(item: Block): string {
  const spacing = `<w:spacing w:before="${item.before ?? 0}" w:after="${item.after ?? 0}" w:line="${item.line ?? 240}" w:lineRule="auto"/>`;
  const align = item.align === "center" ? `<w:jc w:val="center"/>` : "";
  const lead = item.boldLead ? runXml(item.boldLead, item, true) : "";
  return `<w:p><w:pPr>${spacing}${align}</w:pPr>${lead}${runXml(item.text, item)}</w:p>`;
}

function cellXml(item: Cell): string {
  const fill = item.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${item.fill}"/>` : "";
  const valign = item.valign ? `<w:vAlign w:val="${item.valign}"/>` : "";
  const body = item.blocks.map(paragraphXml).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${item.twips}" w:type="dxa"/>${fill}${valign}</w:tcPr>${body}</w:tc>`;
}

function tableXml(rows: Row[], width: number, indent: number): string {
  const grid = rows[0]?.cells.map((item) => `<w:gridCol w:w="${item.twips}"/>`).join("") ?? "";
  const body = rows
    .map((row) => {
      const height = row.minTwips ? `<w:trHeight w:val="${row.minTwips}"/>` : "";
      return `<w:tr><w:trPr><w:cantSplit/>${height}</w:trPr>${row.cells.map(cellXml).join("")}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblInd w:w="${indent}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function headerTableXml(): string {
  const labels = ["Item", "Discussion", "Updates / Action Item"];
  const cells = labels
    .map((label, index) => {
      const bottom = `<w:tcBorders><w:bottom w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders>`;
      return `<w:tc><w:tcPr><w:tcW w:w="${AGENDA_WIDTHS[index]}" w:type="dxa"/>${bottom}<w:vAlign w:val="center"/></w:tcPr>${paragraphXml(block(label, 20, { bold: true, align: "center" }))}</w:tc>`;
    })
    .join("");
  const grid = AGENDA_WIDTHS.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="11070" w:type="dxa"/><w:tblInd w:w="-545" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="478"/></w:trPr>${cells}</w:tr></w:tbl>`;
}

const WORD_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

function logoHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${WORD_NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1965960" cy="1106424"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Ironwood logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Ironwood logo"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1965960" cy="1106424"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
}

function columnHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${WORD_NS}>${headerTableXml()}<w:p/></w:hdr>`;
}

function footerXml(): string {
  const run = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
  const field = (instruction: string, cached: string) =>
    `<w:r>${run}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${run}<w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r>${run}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${run}<w:t>${cached}</w:t></w:r><w:r>${run}<w:fldChar w:fldCharType="end"/></w:r>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${WORD_NS}><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r>${run}<w:t xml:space="preserve">Page </w:t></w:r>${field("PAGE", "1")}<w:r>${run}<w:t xml:space="preserve"> of </w:t></w:r>${field("NUMPAGES", "1")}</w:p></w:ftr>`;
}

async function loadLogo(): Promise<Uint8Array> {
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error("Could not load the meeting logo.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function meetingDocxBytes(content: PaintMeetingContent): Promise<Uint8Array> {
  const logo = await loadLogo();
  const doc = buildAgenda(content);
  const body = [
    ...doc.preface.map(paragraphXml),
    tableXml(doc.attendees, 11520, -635),
    tableXml(doc.agenda, 11070, -545),
  ].join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${WORD_NS}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:headerReference w:type="first" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1080" w:bottom="864" w:left="1080" w:header="288" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/header2.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>
</Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  zip.file("word/header1.xml", columnHeaderXml());
  zip.file("word/header2.xml", logoHeaderXml());
  zip.file("word/footer1.xml", footerXml());
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`,
  );
  zip.file("word/media/image1.jpeg", logo);
  return zip.generateAsync({ type: "uint8array" });
}

type Face = { font: PDFFont; size: number };

function wrap(text: string, face: Face, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (face.font.widthOfTextAtSize(next, face.size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function ink(color?: string): RGB {
  return color === NAVY ? navy : black;
}

type LaidLine = { text: string; size: number; bold: boolean; color: RGB; underline: boolean; align: Align };
type LaidCell = { width: number; fill?: RGB; valign?: "center"; lines: LaidLine[]; contentHeight: number };
type LaidRow = { cells: LaidCell[]; height: number };

function layoutRow(row: Row, regular: PDFFont, boldFont: PDFFont): LaidRow {
  const cells: LaidCell[] = row.cells.map((item) => {
    const width = item.twips / 20;
    const inner = Math.max(12, width - 8);
    const lines: LaidLine[] = [];
    for (const part of item.blocks) {
      const size = part.size / 2;
      const face = { font: part.bold ? boldFont : regular, size };
      const wrapped = wrap(part.text, face, inner);
      if (part.before) lines.push({ text: "", size: part.before / 20, bold: false, color: black, underline: false, align: "left" });
      wrapped.forEach((text, index) => {
        lines.push({
          text,
          size,
          bold: Boolean(part.bold),
          color: ink(part.color),
          underline: Boolean(part.underline && index === 0),
          align: part.align ?? "left",
        });
      });
      if (part.underline && wrapped.length > 1) {
        for (let index = 1; index < wrapped.length; index += 1) lines[lines.length - wrapped.length + index]!.underline = true;
      }
      if (part.after) lines.push({ text: "", size: part.after / 20, bold: false, color: black, underline: false, align: "left" });
    }
    const contentHeight = lines.reduce((sum, line) => sum + line.size + 2, 0);
    return { width, fill: item.fill ? gray : undefined, valign: item.valign, lines, contentHeight };
  });
  const min = (row.minTwips ?? 0) / 20;
  const height = Math.max(min, ...cells.map((item) => item.contentHeight + 6));
  return { cells, height };
}

function drawRow(page: PDFPage, row: LaidRow, x: number, top: number, regular: PDFFont, boldFont: PDFFont) {
  let cursor = x;
  for (const cellItem of row.cells) {
    if (cellItem.fill) {
      page.drawRectangle({ x: cursor, y: top - row.height, width: cellItem.width, height: row.height, color: cellItem.fill });
    }
    const spare = row.height - 6 - cellItem.contentHeight;
    let y = top - 4 - (cellItem.valign === "center" && spare > 0 ? spare / 2 : 0);
    for (const line of cellItem.lines) {
      y -= line.size;
      if (line.text) {
        const font = line.bold ? boldFont : regular;
        const textWidth = font.widthOfTextAtSize(line.text, line.size);
        const textX = line.align === "center" ? cursor + (cellItem.width - textWidth) / 2 : cursor + 4;
        page.drawText(line.text, { x: textX, y, size: line.size, font, color: line.color });
        if (line.underline) {
          page.drawLine({
            start: { x: textX, y: y - 1.2 },
            end: { x: textX + textWidth, y: y - 1.2 },
            thickness: 0.6,
            color: line.color,
          });
        }
      }
      y -= 2;
    }
    cursor += cellItem.width;
  }
  const width = row.cells.reduce((sum, item) => sum + item.width, 0);
  const stroke = { thickness: 0.6, color: black };
  page.drawLine({ start: { x, y: top }, end: { x: x + width, y: top }, ...stroke });
  page.drawLine({ start: { x, y: top - row.height }, end: { x: x + width, y: top - row.height }, ...stroke });
  let edge = x;
  for (const cellItem of row.cells) {
    page.drawLine({ start: { x: edge, y: top }, end: { x: edge, y: top - row.height }, ...stroke });
    edge += cellItem.width;
  }
  page.drawLine({ start: { x: edge, y: top }, end: { x: edge, y: top - row.height }, ...stroke });
}

function drawPreface(page: PDFPage, lines: Block[], x: number, y: number, maxWidth: number, regular: PDFFont, boldFont: PDFFont): number {
  let cursor = y;
  for (const line of lines) {
    const size = line.size / 2;
    const font = line.bold ? boldFont : regular;
    cursor -= (line.before ?? 0) / 20 + size;
    if (line.boldLead) {
      const leadWidth = boldFont.widthOfTextAtSize(line.boldLead, size);
      page.drawText(line.boldLead, { x, y: cursor, size, font: boldFont, color: black });
      const rest = wrap(line.text, { font: regular, size }, Math.max(40, maxWidth - leadWidth));
      if (rest[0]) page.drawText(rest[0], { x: x + leadWidth, y: cursor, size, font: regular, color: black });
      for (const text of rest.slice(1)) {
        cursor -= size + 4;
        page.drawText(text, { x, y: cursor, size, font: regular, color: black });
      }
    } else {
      const wrapped = wrap(line.text, { font, size }, maxWidth);
      page.drawText(wrapped[0] ?? "", { x, y: cursor, size, font, color: black });
      for (const text of wrapped.slice(1)) {
        cursor -= size + 3;
        page.drawText(text, { x, y: cursor, size, font, color: black });
      }
    }
    cursor -= (line.after ?? 40) / 20 + 2;
  }
  return cursor - 4;
}

export async function meetingPdfBytes(content: PaintMeetingContent): Promise<Uint8Array> {
  const logoBytes = await loadLogo();
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedJpg(logoBytes);
  const model = buildAgenda(content);
  const pageWidth = 612;
  const pageHeight = 792;
  const bottom = 52;
  const pages: PDFPage[] = [];

  function addPage(first: boolean): { page: PDFPage; y: number } {
    const page = doc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    if (first) {
      const logoW = 154.8;
      const logoH = 87.1;
      page.drawImage(logo, { x: (pageWidth - logoW) / 2, y: pageHeight - 16 - logoH, width: logoW, height: logoH });
      return { page, y: pageHeight - 16 - logoH - 10 };
    }
    const header = layoutRow(
      {
        minTwips: 478,
        cells: ["Item", "Discussion", "Updates / Action Item"].map((label, index) => headerCell(AGENDA_WIDTHS[index] ?? 1000, label)),
      },
      regular,
      boldFont,
    );
    drawRow(page, header, 54 - 545 / 20, pageHeight - 18, regular, boldFont);
    return { page, y: pageHeight - 50.4 };
  }

  let current = addPage(true);
  current.y = drawPreface(current.page, model.preface, 54, current.y, pageWidth - 108, regular, boldFont);

  function splitToFit(row: Row, room: number): Row[] {
    const laid = layoutRow(row, regular, boldFont);
    if (laid.height <= room) return [row];
    const middle = row.cells[1];
    const note = middle?.blocks.find((item) => item.size === 18 && item.text.trim().length > 40);
    if (!middle || !note) return [row];
    const words = note.text.split(/\s+/).filter(Boolean);
    if (words.length < 8) return [row];
    const mid = Math.ceil(words.length / 2);
    const firstText = words.slice(0, mid).join(" ");
    const restText = words.slice(mid).join(" ");
    const first: Row = {
      ...row,
      cells: row.cells.map((item, index) =>
        index === 1 ? { ...item, blocks: item.blocks.map((part) => (part === note ? { ...part, text: firstText } : part)) } : item,
      ),
    };
    const rest: Row = {
      cells: row.cells.map((item, index) =>
        index === 1 ? { ...item, blocks: [{ ...note, text: restText, before: 0 }] } : { ...item, blocks: [block("", 18)] },
      ),
    };
    return [...splitToFit(first, room), ...splitToFit(rest, room)];
  }

  function paintTable(rows: Row[], indentTwips: number) {
    const x = 54 + indentTwips / 20;
    for (const source of rows) {
      const room = Math.max(180, current.y - bottom);
      for (const row of splitToFit(source, room)) {
        const laid = layoutRow(row, regular, boldFont);
        if (current.y - laid.height < bottom) current = addPage(false);
        drawRow(current.page, laid, x, current.y, regular, boldFont);
        current.y -= laid.height;
      }
    }
  }

  paintTable(model.attendees, -635);
  current.y -= 8;
  paintTable(model.agenda, -545);

  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    const width = regular.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: pageWidth - 54 - width, y: 28, size: 10, font: regular, color: black });
  });
  return doc.save();
}

export async function downloadMeetingPdf(content: PaintMeetingContent): Promise<void> {
  downloadPdfBytes(await meetingPdfBytes(content), `${meetingFileStem(content)}.pdf`);
}

export async function downloadMeetingDocx(content: PaintMeetingContent): Promise<void> {
  const bytes = await meetingDocxBytes(content);
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
