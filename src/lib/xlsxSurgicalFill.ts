import JSZip from "jszip";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type SheetInfo = { name: string; path: string };

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid Excel XML in workbook.");
  }
  return doc;
}

async function resolveFirstSheet(zip: JSZip): Promise<SheetInfo> {
  const wbFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!wbFile || !relsFile) throw new Error("Invalid Excel file: missing workbook.");

  const wbDoc = parseXml(await wbFile.async("string"));
  const relsDoc = parseXml(await relsFile.async("string"));

  const sheet = wbDoc.getElementsByTagNameNS(NS_MAIN, "sheet")[0];
  if (!sheet) throw new Error("Workbook has no worksheets.");

  const name = sheet.getAttribute("name") ?? "Sheet1";
  const rId = sheet.getAttributeNS(NS_OFFICE_REL, "id") ?? sheet.getAttribute("r:id");
  if (!rId) throw new Error("Sheet relationship id missing.");

  const rels = relsDoc.getElementsByTagName("Relationship");
  let target: string | null = null;
  for (let i = 0; i < rels.length; i++) {
    const rel = rels.item(i);
    if (rel?.getAttribute("Id") === rId) {
      target = rel.getAttribute("Target");
      break;
    }
  }
  if (!target) throw new Error(`Sheet path not found for "${name}".`);

  const path = target.startsWith("/")
    ? target.slice(1)
    : target.startsWith("xl/")
      ? target
      : `xl/${target}`;
  return { name, path };
}

function cellRefToRowNum(cellRef: string): string {
  const match = cellRef.toUpperCase().match(/[A-Z]+([0-9]+)/);
  return match?.[1] ?? "1";
}

function findOrCreateRow(sheetData: Element, rowNum: string, doc: Document): Element {
  for (const child of Array.from(sheetData.children)) {
    if (child.localName === "row" && child.getAttribute("r") === rowNum) {
      return child;
    }
  }
  const row = doc.createElementNS(NS_MAIN, "row");
  row.setAttribute("r", rowNum);
  sheetData.appendChild(row);
  return row;
}

function findOrCreateCell(row: Element, cellRef: string, doc: Document): Element {
  const upper = cellRef.toUpperCase();
  for (const child of Array.from(row.children)) {
    if (child.localName === "c" && child.getAttribute("r")?.toUpperCase() === upper) {
      return child;
    }
  }
  const cell = doc.createElementNS(NS_MAIN, "c");
  cell.setAttribute("r", upper);
  row.appendChild(cell);
  return cell;
}

/** Serialize worksheet root — never double the xml declaration Excel rejects. */
function serializeWorksheetXml(originalXml: string, doc: Document): string {
  const declMatch = originalXml.match(/^<\?xml[^?]*\?>/);
  const declaration =
    declMatch?.[0] ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const body = new XMLSerializer().serializeToString(doc.documentElement);
  return `${declaration}\n${body}`;
}

/** Write string value only — keep existing `s` style index and all other workbook parts. */
function setCellStringValue(cell: Element, doc: Document, value: string): void {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.setAttribute("t", "inlineStr");
  const is = doc.createElementNS(NS_MAIN, "is");
  const t = doc.createElementNS(NS_MAIN, "t");
  if (/^\s|\s$/.test(value)) t.setAttribute("xml:space", "preserve");
  t.textContent = value;
  is.appendChild(t);
  cell.appendChild(is);
}

/**
 * Patch cell values in-place inside the xlsx zip. Only the target worksheet XML is
 * rewritten — tables, filters, styles, merges, and themes stay untouched.
 */
export async function patchXlsxCellValues(
  templateBytes: ArrayBuffer,
  cellValues: Record<string, string>,
): Promise<{ bytes: Uint8Array; sheetName: string }> {
  const zip = await JSZip.loadAsync(templateBytes);
  const sheetInfo = await resolveFirstSheet(zip);

  const sheetFile = zip.file(sheetInfo.path);
  if (!sheetFile) throw new Error(`Worksheet file missing: ${sheetInfo.path}`);

  const sheetXml = await sheetFile.async("string");
  const doc = parseXml(sheetXml);
  const sheetData = doc.getElementsByTagNameNS(NS_MAIN, "sheetData")[0];
  if (!sheetData) throw new Error("Worksheet has no sheetData.");

  for (const [cellRef, value] of Object.entries(cellValues)) {
    if (!value.trim()) continue;
    const addr = cellRef.toUpperCase();
    const row = findOrCreateRow(sheetData, cellRefToRowNum(addr), doc);
    setCellStringValue(findOrCreateCell(row, addr, doc), doc, value);
  }

  zip.file(sheetInfo.path, serializeWorksheetXml(sheetXml, doc));

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: out, sheetName: sheetInfo.name };
}
