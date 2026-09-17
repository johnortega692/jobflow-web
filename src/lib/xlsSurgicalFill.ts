import * as CFB from "cfb";
import { utils as xlsxUtils } from "xlsx";

const BOF = 0x0809;
const EOF = 0x000a;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const EXTSST = 0x00ff;
const BOUNDSHEET = 0x0085;
const INDEX = 0x020b;
const DBCELL = 0x00d7;
const ROW = 0x0208;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const BLANK = 0x0201;
const MULBLANK = 0x00be;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const BOOLERR = 0x0205;

const MAX_REC = 8224;

const CELL_TYPES = new Set([
  LABELSST,
  LABEL,
  BLANK,
  MULBLANK,
  NUMBER,
  RK,
  MULRK,
  FORMULA,
  BOOLERR,
]);

type Rec = { type: number; data: Uint8Array };

function asBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (ArrayBuffer.isView(content)) {
    const view = content as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(content)) return Uint8Array.from(content as number[]);
  throw new Error("Invalid Excel 97-2003 workbook stream.");
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}

function writeU16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
  data[offset + 2] = (value >> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function parseRecords(stream: Uint8Array): Rec[] {
  const recs: Rec[] = [];
  let i = 0;
  while (i + 4 <= stream.length) {
    const type = readU16(stream, i);
    const len = readU16(stream, i + 2);
    recs.push({ type, data: stream.subarray(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return recs;
}

function serializeRecords(recs: Rec[]): Uint8Array {
  return concatBytes(
    recs.map((rec) => {
      const out = new Uint8Array(4 + rec.data.length);
      writeU16(out, 0, rec.type);
      writeU16(out, 2, rec.data.length);
      out.set(rec.data, 4);
      return out;
    }),
  );
}

function recordPositions(recs: Rec[]): number[] {
  const pos: number[] = [];
  let offset = 0;
  for (const rec of recs) {
    pos.push(offset);
    offset += 4 + rec.data.length;
  }
  return pos;
}

function encodeBiff8String(value: string): Uint8Array {
  let wide = false;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) {
      wide = true;
      break;
    }
  }
  const out = new Uint8Array(3 + value.length * (wide ? 2 : 1));
  writeU16(out, 0, value.length);
  out[2] = wide ? 1 : 0;
  if (wide) {
    for (let i = 0; i < value.length; i++) {
      writeU16(out, 3 + i * 2, value.charCodeAt(i));
    }
  } else {
    for (let i = 0; i < value.length; i++) out[3 + i] = value.charCodeAt(i) & 0xff;
  }
  return out;
}

function labelsstData(row: number, col: number, xf: number, sst: number): Uint8Array {
  const data = new Uint8Array(10);
  writeU16(data, 0, row);
  writeU16(data, 2, col);
  writeU16(data, 4, xf);
  writeU32(data, 6, sst);
  return data;
}

function blankData(row: number, col: number, xf: number): Uint8Array {
  const data = new Uint8Array(6);
  writeU16(data, 0, row);
  writeU16(data, 2, col);
  writeU16(data, 4, xf);
  return data;
}

function mulBlankData(row: number, colFirst: number, xfs: number[], colLast: number): Uint8Array {
  const data = new Uint8Array(6 + xfs.length * 2);
  writeU16(data, 0, row);
  writeU16(data, 2, colFirst);
  for (let i = 0; i < xfs.length; i++) writeU16(data, 4 + i * 2, xfs[i]!);
  writeU16(data, 4 + xfs.length * 2, colLast);
  return data;
}

function emitBlanks(row: number, colFirst: number, xfs: number[]): Rec[] {
  if (xfs.length === 0) return [];
  if (xfs.length === 1) return [{ type: BLANK, data: blankData(row, colFirst, xfs[0]!) }];
  return [{ type: MULBLANK, data: mulBlankData(row, colFirst, xfs, colFirst + xfs.length - 1) }];
}

function splitMulBlank(
  data: Uint8Array,
  fills: Map<number, { sst: number }>,
): Rec[] {
  const row = readU16(data, 0);
  const colFirst = readU16(data, 2);
  const colLast = readU16(data, data.length - 2);
  const xfs: number[] = [];
  for (let col = colFirst; col <= colLast; col++) {
    xfs.push(readU16(data, 4 + (col - colFirst) * 2));
  }

  const out: Rec[] = [];
  let runStart = 0;
  const flushRun = (end: number) => {
    if (end > runStart) out.push(...emitBlanks(row, colFirst + runStart, xfs.slice(runStart, end)));
  };

  for (let i = 0; i < xfs.length; i++) {
    const fill = fills.get(colFirst + i);
    if (!fill) continue;
    flushRun(i);
    out.push({ type: LABELSST, data: labelsstData(row, colFirst + i, xfs[i]!, fill.sst) });
    runStart = i + 1;
  }
  flushRun(xfs.length);
  return out;
}

function boundsheetName(data: Uint8Array): string {
  const cch = data[6] ?? 0;
  const wide = (data[7] ?? 0) & 1;
  if (wide) {
    let name = "";
    for (let i = 0; i < cch; i++) name += String.fromCharCode(readU16(data, 8 + i * 2));
    return name || "Sheet1";
  }
  return String.fromCharCode(...data.subarray(8, 8 + cch)) || "Sheet1";
}

function appendSstStrings(sstBlock: Rec[], encoded: Uint8Array[]): Rec[] {
  const copies = sstBlock.map((rec) => ({ type: rec.type, data: new Uint8Array(rec.data) }));
  const header = copies[0];
  if (!header) throw new Error("Workbook has no shared string table.");
  writeU32(header.data, 0, readU32(header.data, 0) + encoded.length);
  writeU32(header.data, 4, readU32(header.data, 4) + encoded.length);

  let last = copies[copies.length - 1]!;
  for (const enc of encoded) {
    if (last.data.length + enc.length <= MAX_REC) {
      last.data = concatBytes([last.data, enc]);
      continue;
    }
    if (enc.length > MAX_REC) {
      throw new Error("Text is too long for this Excel 97-2003 cell.");
    }
    last = { type: CONTINUE, data: enc };
    copies.push(last);
  }
  return copies;
}

function rebuildDbcell(recs: Rec[], dbIdx: number, positions: number[]): Uint8Array {
  let i = dbIdx - 1;
  while (i >= 0 && CELL_TYPES.has(recs[i]!.type)) i -= 1;
  const cellEnd = i;
  while (i >= 0 && recs[i]!.type === ROW) i -= 1;
  const rowStart = i + 1;
  const rows: Rec[] = recs.slice(rowStart, cellEnd + 1);
  const cells: Rec[] = recs.slice(cellEnd + 1, dbIdx);
  if (rows.length === 0) return recs[dbIdx]!.data;

  const firstCellPos = new Array<number>(rows.length).fill(-1);
  for (let ci = 0; ci < cells.length; ci++) {
    const rowNum = readU16(cells[ci]!.data, 0);
    const rowIdx = rows.findIndex((row) => readU16(row.data, 0) === rowNum);
    if (rowIdx >= 0 && firstCellPos[rowIdx] === -1) {
      firstCellPos[rowIdx] = positions[cellEnd + 1 + ci] ?? -1;
    }
  }

  const cellEndPos = positions[dbIdx]!;
  let nextPos = cellEndPos;
  for (let r = firstCellPos.length - 1; r >= 0; r--) {
    if (firstCellPos[r] === -1) firstCellPos[r] = nextPos;
    else nextPos = firstCellPos[r]!;
  }

  const data = new Uint8Array(4 + rows.length * 2);
  writeU32(data, 0, positions[dbIdx]! - positions[rowStart]!);
  writeU16(data, 4, (firstCellPos[0] ?? cellEndPos) - positions[rowStart]! - (4 + rows[0]!.data.length));
  for (let r = 1; r < rows.length; r++) {
    writeU16(data, 4 + r * 2, (firstCellPos[r] ?? 0) - (firstCellPos[r - 1] ?? 0));
  }
  return data;
}

function patchWorkbookOffsets(recs: Rec[]): void {
  const positions = recordPositions(recs);
  const bofIdx = recs.map((rec, i) => (rec.type === BOF ? i : -1)).filter((i) => i >= 0);
  const sheetBofPos = bofIdx.slice(1).map((i) => positions[i]!);

  let sheetNo = 0;
  for (const rec of recs) {
    if (rec.type !== BOUNDSHEET) continue;
    const data = new Uint8Array(rec.data);
    writeU32(data, 0, sheetBofPos[sheetNo++] ?? 0);
    rec.data = data;
  }

  for (let s = 1; s < bofIdx.length; s++) {
    const start = bofIdx[s]!;
    const end = s + 1 < bofIdx.length ? bofIdx[s + 1]! : recs.length;
    const dbIdxs: number[] = [];
    let indexIdx = -1;
    for (let i = start; i < end; i++) {
      if (recs[i]!.type === INDEX && indexIdx < 0) indexIdx = i;
      if (recs[i]!.type === DBCELL) dbIdxs.push(i);
    }
    for (const dbIdx of dbIdxs) {
      recs[dbIdx]!.data = rebuildDbcell(recs, dbIdx, positions);
    }
    if (indexIdx >= 0 && recs[indexIdx]!.data.length >= 16 + dbIdxs.length * 4) {
      const data = new Uint8Array(recs[indexIdx]!.data);
      for (let i = 0; i < dbIdxs.length; i++) writeU32(data, 16 + i * 4, positions[dbIdxs[i]!]!);
      recs[indexIdx]!.data = data;
    }
  }
}

function decodeAddr(addr: string): { r: number; c: number } {
  const parsed = xlsxUtils.decode_cell(addr.toUpperCase());
  if (parsed.r == null || parsed.c == null || Number.isNaN(parsed.r) || Number.isNaN(parsed.c)) {
    throw new Error(`Invalid cell ${addr}.`);
  }
  return { r: parsed.r, c: parsed.c };
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Fill values in an Excel 97-2003 (.xls) file without rewriting styles.
 * Cell XF indexes (borders, fonts, fills) stay on the original records.
 */
export function fillLegacyXlsInPlace(
  templateBytes: ArrayBuffer,
  cellValues: Record<string, string>,
): { bytes: Uint8Array; sheetName: string } {
  const fills = new Map<string, { r: number; c: number; value: string; sst: number }>();
  const encoded: Uint8Array[] = [];
  for (const [addr, value] of Object.entries(cellValues)) {
    if (!value.trim()) continue;
    const { r, c } = decodeAddr(addr);
    fills.set(cellKey(r, c), { r, c, value, sst: -1 });
    encoded.push(encodeBiff8String(value));
  }
  if (fills.size === 0) {
    return { bytes: new Uint8Array(templateBytes), sheetName: "Sheet1" };
  }

  const cfb = CFB.read(new Uint8Array(templateBytes), { type: "array" });
  const wbEntry = CFB.find(cfb, "Workbook") ?? CFB.find(cfb, "Book");
  if (!wbEntry?.content) throw new Error("This .xls file has no Workbook stream.");

  const recs = parseRecords(asBytes(wbEntry.content));
  const sstIdx = recs.findIndex((rec) => rec.type === SST);
  if (sstIdx < 0) throw new Error("This .xls file has no shared string table.");

  const uniqueBefore = readU32(recs[sstIdx]!.data, 4);
  let sst = 0;
  for (const fill of fills.values()) {
    fill.sst = uniqueBefore + sst;
    sst += 1;
  }

  const sstEnd = (() => {
    let i = sstIdx + 1;
    while (i < recs.length && recs[i]!.type === CONTINUE) i += 1;
    return i;
  })();
  const sstBlock = appendSstStrings(recs.slice(sstIdx, sstEnd), encoded);
  const dropExt = recs[sstEnd]?.type === EXTSST ? 1 : 0;

  const bofs: number[] = [];
  const eofs: number[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i]!.type === BOF) bofs.push(i);
    if (recs[i]!.type === EOF) eofs.push(i);
  }
  const sheet1Start = bofs[1] ?? -1;
  const sheet1End = eofs[1] ?? -1;
  if (sheet1Start < 0 || sheet1End < 0) throw new Error("Workbook has no worksheets.");

  const firstSheet = recs.find((rec) => rec.type === BOUNDSHEET);
  const sheetName = firstSheet ? boundsheetName(firstSheet.data) : "Sheet1";

  const out: Rec[] = [];
  const remaining = new Set(fills.keys());
  for (let i = 0; i < recs.length; ) {
    if (i === sstIdx) {
      out.push(...sstBlock);
      i = sstEnd + dropExt;
      continue;
    }

    const rec = recs[i]!;
    const inSheet1 = i >= sheet1Start && i <= sheet1End;
    if (!inSheet1 || !CELL_TYPES.has(rec.type)) {
      out.push(rec);
      i += 1;
      continue;
    }

    if (rec.type === MULBLANK) {
      const row = readU16(rec.data, 0);
      const colFirst = readU16(rec.data, 2);
      const colLast = readU16(rec.data, rec.data.length - 2);
      const colFills = new Map<number, { sst: number }>();
      for (let col = colFirst; col <= colLast; col++) {
        const fill = fills.get(cellKey(row, col));
        if (!fill) continue;
        colFills.set(col, fill);
        remaining.delete(cellKey(row, col));
      }
      out.push(...(colFills.size ? splitMulBlank(rec.data, colFills) : [rec]));
      i += 1;
      continue;
    }

    const row = readU16(rec.data, 0);
    const col = readU16(rec.data, 2);
    const fill = fills.get(cellKey(row, col));
    if (!fill) {
      out.push(rec);
      i += 1;
      continue;
    }
    remaining.delete(cellKey(row, col));
    const xf = rec.type === LABELSST || rec.type === BLANK || rec.type === LABEL || rec.type === NUMBER || rec.type === RK || rec.type === BOOLERR
      ? readU16(rec.data, 4)
      : 0x0f;
    if (rec.type === LABELSST) {
      const data = new Uint8Array(rec.data);
      writeU32(data, 6, fill.sst);
      out.push({ type: LABELSST, data });
    } else {
      out.push({ type: LABELSST, data: labelsstData(row, col, xf, fill.sst) });
    }
    i += 1;
  }

  if (remaining.size) {
    const first = [...remaining][0];
    const fill = first ? fills.get(first) : undefined;
    const addr = fill ? xlsxUtils.encode_cell({ r: fill.r, c: fill.c }) : first;
    throw new Error(`Could not find formatted cell ${addr} in this .xls template.`);
  }

  patchWorkbookOffsets(out);
  const stream = serializeRecords(out);
  CFB.utils.cfb_add(cfb, wbEntry.name === "Book" ? "Book" : "Workbook", stream);
  const written = CFB.write(cfb, { type: "array" });
  const bytes = written instanceof Uint8Array ? written : Uint8Array.from(written as number[]);
  return { bytes, sheetName };
}
