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
const BLUE = "0070C0";
const GRAY = "D9D9D9";
const ATTENDEE_WIDTHS = [2070, 1170, 2070, 1530, 3330, 1350];
const AGENDA_WIDTHS = [1350, 7380, 2340];

type Align = "left" | "center" | "right";

type Run = {
  text: string;
  size: number;
  bold?: boolean;
  color?: string;
};

type Block = {
  text: string;
  /** Bold prefix on the same line. The rest of `text` stays regular. */
  boldLead?: string;
  /** Mixed runs on one line, used for the right-aligned next-meeting line. */
  runs?: Run[];
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
const blue = rgb(0, 112 / 255, 192 / 255);
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
  return Boolean(line.company.trim() || line.job.trim() || line.notes.trim() || line.action.trim());
}

function jobsOf(group: MeetingGroup): MeetingJobLine[] {
  const rows = sortMeetingLines(group.lines, group.sort).filter(filledJob);
  return rows.length ? rows : [{ id: "", company: "", job: "", notes: "", action: "" }];
}

function nextMeetingRuns(value: string): Run[] {
  const match = /^(.*?)(\s*@\s*\S[\s\S]*)$/.exec(value.trim());
  if (!match) return [{ text: value.trim(), size: 20 }];
  return [
    { text: `${match[1]}`, size: 24 },
    { text: match[2] ?? "", size: 20, bold: true, color: BLUE },
  ];
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
    block("", 20, { line: 360 }),
    block(when, 20, { boldLead: "Meeting Date: ", line: 360 }),
  ];
  if (content.purpose.trim()) preface.push(block(content.purpose.trim(), 20, { boldLead: "Meeting Purpose: ", line: 360 }));
  preface.push(block("", 20, { line: 240 }));
  if (content.nextMeeting.trim()) {
    preface.push(block("", 20, {
      align: "right",
      line: 360,
      boldLead: "Next Meeting Scheduled: ",
      runs: nextMeetingRuns(content.nextMeeting),
    }));
  }
  preface.push(block("", 20, { line: 240 }));
  preface.push(block("", 20, { line: 240 }));
  preface.push(block("Attendees", 20, { bold: true, line: 240 }));

  const people = sortAttendees(content.attendees, content.attendeeSort).filter(
    (person) => person.name.trim() || person.company.trim() || person.email.trim(),
  );
  const attendees: Row[] = [
    {
      minTwips: 300,
      cells: ["Name", "Company", "Position", "Phone", "Email", "Present"].map((label, index) =>
        headerCell(ATTENDEE_WIDTHS[index] ?? 1000, label),
      ),
    },
    ...people.map((person) => ({
      minTwips: 498,
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
  const sections: { title: string; rows: { company: string; title: string; notes: string; action: string }[] }[] = [
    ...content.groups.map((group) => ({
      title: group.title,
      rows: jobsOf(group).map((job) => ({
        company: job.company.trim(),
        title: job.job.trim(),
        notes: job.notes.trim(),
        action: job.action.trim(),
      })),
    })),
    ...content.topics.map((topic) => ({
      title: topic.title,
      rows: (topic.items.length ? topic.items : [{ title: "", notes: "", action: "" }]).map((item) => ({
        company: "",
        title: item.title.trim(),
        notes: item.notes.trim(),
        action: item.action.trim(),
      })),
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
      if (row.title) middle.push(block(row.title, 22, { bold: true, color: NAVY, underline: true, before: 20, after: 40 }));
      if (row.notes) middle.push(block(row.notes, 18, { after: 20 }));
      agenda.push({
        cells: [
          cell(AGENDA_WIDTHS[0], [
            block(`${section}.${index + 1}`, 20, { align: "center", before: 40 }),
            block(row.company, 18, { align: "center", after: 40 }),
          ]),
          cell(AGENDA_WIDTHS[1], middle),
          cell(AGENDA_WIDTHS[2], [block(row.action, 18)]),
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
  const align = item.align === "center" ? `<w:jc w:val="center"/>` : item.align === "right" ? `<w:jc w:val="right"/>` : "";
  const lead = item.boldLead ? runXml(item.boldLead, item, true) : "";
  const body = item.runs
    ? item.runs.map((run) => runXml(run.text, { ...item, size: run.size, color: run.color, underline: false }, Boolean(run.bold))).join("")
    : runXml(item.text, item);
  return `<w:p><w:pPr>${spacing}${align}</w:pPr>${lead}${body}</w:p>`;
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

function emptyFooterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${WORD_NS}><w:p/></w:ftr>`;
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
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    tableXml(doc.agenda, 11070, -545),
  ].join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${WORD_NS}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:headerReference w:type="first" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:footerReference w:type="first" r:id="rId6"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1080" w:bottom="864" w:left="1080" w:header="288" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
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
  <Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
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
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
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
  zip.file("word/footer2.xml", emptyFooterXml());
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`,
  );
  zip.file("word/media/image1.jpeg", logo);
  return zip.generateAsync({ type: "uint8array" });
}

type Face = { font: PDFFont; size: number };

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const BODY_LEFT = 54;
const BODY_RIGHT = 558;
const ATTENDEE_LEFT = 22.25;
const AGENDA_LEFT = 26.75;
const FOOTER_TOP = 46;

function wrap(text: string, face: Face, maxWidth: number): string[] {
  const source = text.split(/\n/);
  const lines: string[] = [];
  for (const paragraph of source) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
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
  }
  return lines.length ? lines : [""];
}

function ink(color?: string): RGB {
  if (color === NAVY) return navy;
  if (color === BLUE) return blue;
  return black;
}

function leading(size: number): number {
  if (size >= 13) return 16;
  if (size >= 11) return 15.5;
  return 10.4;
}

type LaidLine = { text: string; size: number; bold: boolean; color: RGB; underline: boolean; align: Align; gapBefore: number };
type LaidCell = { width: number; fill?: RGB; valign?: "center"; lines: LaidLine[]; contentHeight: number };
type LaidRow = { cells: LaidCell[]; height: number };

function layoutRow(row: Row, regular: PDFFont, boldFont: PDFFont): LaidRow {
  const cells: LaidCell[] = row.cells.map((item) => {
    const width = item.twips / 20;
    const inner = Math.max(12, width - 8);
    const lines: LaidLine[] = [];
    let after = 0;
    for (const part of item.blocks) {
      const size = part.size / 2;
      const face = { font: part.bold || part.boldLead ? boldFont : regular, size };
      const wrapped = part.text.trim() ? wrap(part.text, face, inner) : [];
      wrapped.forEach((text, index) => {
        lines.push({
          text,
          size,
          bold: Boolean(part.bold),
          color: ink(part.color),
          underline: Boolean(part.underline),
          align: part.align ?? "left",
          gapBefore: index === 0 ? (part.before ?? 0) / 20 : 0,
        });
      });
      after += (part.after ?? 0) / 20;
    }
    const contentHeight = lines.reduce((sum, line) => sum + line.gapBefore + leading(line.size), 0) + after;
    return { width, fill: item.fill ? gray : undefined, valign: item.valign, lines, contentHeight };
  });
  const min = (row.minTwips ?? 0) / 20;
  const height = Math.max(min, 16, ...cells.map((item) => item.contentHeight + 2));
  return { cells, height };
}

function drawRow(page: PDFPage, row: LaidRow, x: number, top: number, regular: PDFFont, boldFont: PDFFont, drawTop: boolean) {
  let cursor = x;
  for (const cellItem of row.cells) {
    if (cellItem.fill) {
      page.drawRectangle({ x: cursor, y: top - row.height, width: cellItem.width, height: row.height, color: cellItem.fill });
    }
    const spare = row.height - cellItem.contentHeight;
    let textTop = top - (cellItem.valign === "center" && spare > 0 ? spare / 2 : 3.2);
    for (const line of cellItem.lines) {
      textTop -= line.gapBefore;
      const font = line.bold ? boldFont : regular;
      const baseline = textTop - line.size * 0.78;
      if (line.text) {
        const textWidth = font.widthOfTextAtSize(line.text, line.size);
        const textX = line.align === "center" ? cursor + (cellItem.width - textWidth) / 2 : cursor + 4;
        page.drawText(line.text, { x: textX, y: baseline, size: line.size, font, color: line.color });
        if (line.underline) {
          page.drawLine({
            start: { x: textX, y: baseline - 1.4 },
            end: { x: textX + textWidth, y: baseline - 1.4 },
            thickness: 0.6,
            color: line.color,
          });
        }
      }
      textTop -= leading(line.size);
    }
    cursor += cellItem.width;
  }
  const width = row.cells.reduce((sum, item) => sum + item.width, 0);
  const stroke = { thickness: 0.5, color: black };
  if (drawTop) page.drawLine({ start: { x, y: top }, end: { x: x + width, y: top }, ...stroke });
  page.drawLine({ start: { x, y: top - row.height }, end: { x: x + width, y: top - row.height }, ...stroke });
  let edge = x;
  for (const cellItem of row.cells) {
    page.drawLine({ start: { x: edge, y: top }, end: { x: edge, y: top - row.height }, ...stroke });
    edge += cellItem.width;
  }
  page.drawLine({ start: { x: edge, y: top }, end: { x: edge, y: top - row.height }, ...stroke });
}

function drawBaseline(page: PDFPage, text: string, x: number, top: number, size: number, font: PDFFont, color: RGB): number {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x, y: PAGE_HEIGHT - top - size * 0.78, size, font, color });
  return width;
}

function drawPreface(page: PDFPage, lines: Block[], regular: PDFFont, boldFont: PDFFont): number {
  let top = 115.7;
  for (const line of lines) {
    if (!line.text && !line.boldLead && !line.runs) {
      top += line.line === 360 ? 17.3 : 11.5;
      continue;
    }
    const size = line.size / 2;
    if (line.runs || line.align === "right") {
      const runs: { text: string; size: number; font: PDFFont; color: RGB }[] = [];
      if (line.boldLead) runs.push({ text: line.boldLead, size, font: boldFont, color: black });
      for (const run of line.runs ?? []) {
        runs.push({ text: run.text, size: run.size / 2, font: run.bold ? boldFont : regular, color: ink(run.color) });
      }
      const width = runs.reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, run.size), 0);
      let x = BODY_RIGHT - width;
      for (const run of runs) {
        drawBaseline(page, run.text, x, top, run.size, run.font, run.color);
        x += run.font.widthOfTextAtSize(run.text, run.size);
      }
      top += 17.3;
      continue;
    }
    const font = line.bold ? boldFont : regular;
    let x = BODY_LEFT;
    if (line.boldLead) {
      const lead = `${line.boldLead} `;
      x += drawBaseline(page, lead, x, top, size, boldFont, black);
    }
    drawBaseline(page, line.text, x, top, size, font, black);
    top += line.bold ? 16.5 : 17.3;
  }
  return PAGE_HEIGHT - top;
}

export async function meetingPdfBytes(content: PaintMeetingContent): Promise<Uint8Array> {
  const logoBytes = await loadLogo();
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedJpg(logoBytes);
  const model = buildAgenda(content);
  const pages: PDFPage[] = [];

  function addPage(first: boolean): { page: PDFPage; y: number } {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    if (first) {
      const logoW = 154.8;
      const logoH = 87.1;
      page.drawImage(logo, { x: (PAGE_WIDTH - logoW) / 2, y: PAGE_HEIGHT - 14.4 - logoH, width: logoW, height: logoH });
      return { page, y: PAGE_HEIGHT - 115.7 };
    }
    const header = layoutRow(
      {
        minTwips: 488,
        cells: ["Item", "Discussion", "Updates / Action Item"].map((label, index) =>
          cell(AGENDA_WIDTHS[index] ?? 1000, [block(label, 20, { bold: true, align: "center" })], { valign: "center" }),
        ),
      },
      regular,
      boldFont,
    );
    drawRow(page, header, AGENDA_LEFT, PAGE_HEIGHT - 14.4, regular, boldFont, true);
    return { page, y: PAGE_HEIGHT - 54.1 };
  }

  let current = addPage(true);
  current.y = drawPreface(current.page, model.preface, regular, boldFont) + 8;

  function paintTable(rows: Row[], x: number) {
    let drawTop = true;
    for (const row of rows) {
      const laid = layoutRow(row, regular, boldFont);
      if (current.y - laid.height < FOOTER_TOP) {
        current = addPage(false);
        drawTop = true;
      }
      drawRow(current.page, laid, x, current.y, regular, boldFont, drawTop);
      drawTop = false;
      current.y -= laid.height;
    }
  }

  paintTable(model.attendees, ATTENDEE_LEFT);
  current = addPage(false);
  paintTable(model.agenda, AGENDA_LEFT);

  pages.forEach((page, index) => {
    if (index === 0) return;
    const label = `Page ${index + 1} of ${pages.length}`;
    const width = regular.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: 561 - width, y: 41, size: 10, font: regular, color: black });
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
