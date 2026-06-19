import { readFileSync } from "fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function linesByY(items, tolerance = 3) {
  const rows = [];
  for (const item of items) {
    if (!("str" in item) || !item.str?.trim()) continue;
    rows.push({ x: item.transform[4], y: item.transform[5], str: item.str });
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let group = [];
  let y0 = null;
  for (const r of rows) {
    if (y0 === null || Math.abs(r.y - y0) <= tolerance) {
      group.push(r);
      if (y0 === null) y0 = r.y;
    } else {
      lines.push(group.sort((a, b) => a.x - b.x).map((g) => g.str).join(" ").replace(/\s+/g, " ").trim());
      group = [r];
      y0 = r.y;
    }
  }
  if (group.length) {
    lines.push(group.sort((a, b) => a.x - b.x).map((g) => g.str).join(" ").replace(/\s+/g, " ").trim());
  }
  return lines;
}

const NUM = String.raw`-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?`;
const UOM = String.raw`(?:EA|LF|SF|LY|SY|CY|HR|MO|LS|GAL)`;
const QTY_UOM = String.raw`(?<qty>${NUM})\s*(?<uom>${UOM})`;
const LINE_RE = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+${QTY_UOM}\s+(?<unit>${NUM})\s+(?<amount>${NUM})`,
);
const LINE_NO_UNIT = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+${QTY_UOM}\s+(?<amount>${NUM})\s*$`,
);
const LINE_NOQTY = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+(?<amount>${NUM})\s+(?<crew>${NUM})\s+(?<man>${NUM})`,
);

const CATEGORY = [
  [/Material\s+Acct\.?\s*Code/i, "Material"],
  [/Labor\s+Acct\.?\s*Code/i, "Labor"],
  [/Other\s+Acct\.?\s*Code/i, "Other"],
];

function matches(line, cat) {
  if (/Totals/i.test(line) || /Acct\.?\s*Code/i.test(line)) return false;
  return LINE_RE.test(line) || LINE_NO_UNIT.test(line) || (cat === "Labor" && LINE_NOQTY.test(line));
}

for (const file of ["oak row.pdf", "test1.pdf"]) {
  const path = `c:\\Users\\johno\\OneDrive\\Desktop\\${file}`;
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  let cat = "Unknown";
  let n = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const items = (await (await pdf.getPage(p)).getTextContent()).items;
    for (const line of linesByY(items)) {
      for (const [re, c] of CATEGORY) if (re.test(line)) cat = c;
      if (matches(line, cat)) n++;
    }
  }
  console.log(file, "web lines:", n, "desktop:", file === "oak row.pdf" ? 12 : 21);
}
