import {
  TYPE_DEFAULT_CLASS,
  TEMPLATE_LABELS,
  type BudgetBucket,
  type BudgetLibrary,
  type BudgetMakerData,
  type BudgetScanLine,
  type CostCodeRecord,
  defaultBudgetLibrary,
} from "../types/budgetMaker";

export const AUTO_PUSH_RULES: {
  cost_code: string;
  description_contains?: string[];
  description_exact?: string[];
  category_contains?: string[];
}[] = [
  { cost_code: "990", description_contains: ["paint clean"] },
  { cost_code: "901", description_contains: ["walking paint"] },
  {
    cost_code: "970",
    description_contains: ["materials"],
    description_exact: ["materials"],
    category_contains: ["material"],
  },
];

export function fmtCell(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  return String(value);
}

export function parseMoney(value: string): number | null {
  const text = value.trim().replace(/\$/g, "").replace(/,/g, "");
  if (!text) return null;
  const n = parseFloat(text);
  return Number.isNaN(n) ? null : n;
}

export function formatPct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function sumHours(lines: BudgetScanLine[]): number {
  return lines.reduce((s, row) => s + (row["Man Hours"] ?? 0), 0);
}

export function formatCostCode(code: string, lib: BudgetLibrary): string {
  const c = fmtCell(code);
  for (const rec of lib.cost_codes) {
    if (fmtCell(rec.cost_code) === c) {
      const desc = fmtCell(rec.description);
      return desc ? `${c} - ${desc}` : c;
    }
  }
  return c;
}

export function bucketLabel(bucket: BudgetBucket, index: number, lib: BudgetLibrary): string {
  const codePart = formatCostCode(bucket.cost_code, lib);
  let base = `#${index + 1}: ${codePart} / Class ${bucket.cost_class}`;
  const template = bucket.template_type ?? "";
  if (template && TEMPLATE_LABELS[template]) {
    base += ` (${TEMPLATE_LABELS[template]})`;
  }
  return base;
}

export function codeType(rec: CostCodeRecord): string {
  return fmtCell(rec.type).toUpperCase();
}

export function resolveCostClass(codeRec: CostCodeRecord, templateType: string | null): string {
  if (templateType) {
    if (templateType === "EQUIPMENT_RENTED") return TYPE_DEFAULT_CLASS.EQUIPMENT_RENTED;
    if (templateType in TYPE_DEFAULT_CLASS) return TYPE_DEFAULT_CLASS[templateType];
  }
  const raw = fmtCell(codeRec.cost_class);
  if (/^\d+$/.test(raw)) return raw;
  const ct = codeType(codeRec);
  if (ct in TYPE_DEFAULT_CLASS) return TYPE_DEFAULT_CLASS[ct];
  const m = raw.match(/\d+/);
  return m ? m[0] : "";
}

export function costCodesForTemplate(lib: BudgetLibrary, templateType: string | null): CostCodeRecord[] {
  const codes = lib.cost_codes;
  if (!templateType) return codes.filter((c) => fmtCell(c.cost_code));
  if (templateType === "EQUIPMENT" || templateType === "EQUIPMENT_RENTED") {
    return codes.filter((c) => codeType(c) === "EQUIPMENT");
  }
  return codes.filter((c) => codeType(c) === templateType);
}

export function makeBucketFromCode(codeRec: CostCodeRecord, templateType: string | null): BudgetBucket {
  const bucket: BudgetBucket = {
    cost_code: fmtCell(codeRec.cost_code),
    cost_class: resolveCostClass(codeRec, templateType),
  };
  if (templateType) bucket.template_type = templateType;
  else if (codeType(codeRec) in TYPE_DEFAULT_CLASS) bucket.template_type = codeType(codeRec);
  return bucket;
}

export function costClassGlAcct(lib: BudgetLibrary, costClass: string): string {
  for (const rec of lib.cost_classes) {
    if (fmtCell(rec.cost_class) === fmtCell(costClass)) return fmtCell(rec.gl_acct);
  }
  return "";
}

export function workItemForBucket(bucket: BudgetBucket, lib: BudgetLibrary): string {
  const code = fmtCell(bucket.cost_code);
  for (const rec of lib.cost_codes) {
    if (fmtCell(rec.cost_code) === code) return fmtCell(rec.description);
  }
  return code;
}

export function bucketIsMaterial(bucket: BudgetBucket, lib: BudgetLibrary): boolean {
  const templateType = fmtCell(bucket.template_type).toUpperCase();
  if (templateType === "MATERIALS") return true;
  const code = fmtCell(bucket.cost_code);
  for (const rec of lib.cost_codes) {
    if (fmtCell(rec.cost_code) === code) return codeType(rec) === "MATERIALS";
  }
  return fmtCell(bucket.cost_class) === TYPE_DEFAULT_CLASS.MATERIALS;
}

export function exportFooterText(
  budgetTotal: number,
  totalHours: number,
  unassignedTotal: number,
  userGrandTotal: number | null,
): string {
  const parts = [
    `Total hours: ${totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
    `Budget total: $${budgetTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Unassigned: $${unassignedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ];
  if (userGrandTotal != null) {
    const profit = userGrandTotal - budgetTotal;
    parts.push(
      `Grand total: $${userGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Profit & overhead: $${profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Profit %: ${formatPct(profit, userGrandTotal)}`,
    );
  }
  return parts.join("   |   ");
}

export type HoursExportRow = {
  costCode: string;
  workItem: string;
  hours: string;
  amount: string;
  highlight990: boolean;
};

export function buildHoursExportRows(
  data: Pick<BudgetMakerData, "buckets" | "lines" | "hide_zero_amounts">,
  lib: BudgetLibrary,
): { rows: HoursExportRow[]; totalHours: number; totalMaterial: number } {
  const rows: HoursExportRow[] = [];
  let totalHours = 0;
  let totalMaterial = 0;
  data.buckets.forEach((bucket, i) => {
    const { amount, hours } = bucketMetrics(i, data.lines);
    if (data.hide_zero_amounts && amount === 0) return;
    const costCode = formatCostCode(bucket.cost_code, lib);
    const isMaterial = bucketIsMaterial(bucket, lib);
    if (isMaterial) {
      totalMaterial += amount;
      rows.push({
        costCode,
        workItem: workItemForBucket(bucket, lib),
        hours: "",
        amount: amount ? `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "",
        highlight990: parseCostCodeNumber(costCode) === "990",
      });
    } else {
      totalHours += hours;
      rows.push({
        costCode,
        workItem: workItemForBucket(bucket, lib),
        hours: hours ? hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "",
        amount: "",
        highlight990: parseCostCodeNumber(costCode) === "990",
      });
    }
  });
  return { rows, totalHours, totalMaterial };
}

function parseCostCodeNumber(label: string): string {
  const m = label.match(/^(\d+)/);
  return m ? m[1] : label.split(" - ")[0]?.trim() ?? label;
}

export function activeLines(lines: BudgetScanLine[]): BudgetScanLine[] {
  return lines.filter((l) => !l.Hidden);
}

export function bucketMetrics(
  bucketIdx: number,
  lines: BudgetScanLine[],
): { lines: number; amount: number; hours: number } {
  const assigned = activeLines(lines).filter((l) => l.Bucket === String(bucketIdx));
  const amount = assigned.reduce((s, l) => s + (l.Amount ?? 0), 0);
  const hours = sumHours(assigned);
  return { lines: assigned.length, amount, hours };
}

export function bucketDisplay(bucketId: string, buckets: BudgetBucket[], lib: BudgetLibrary): string {
  if (!bucketId.trim()) return "";
  const idx = parseInt(bucketId, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= buckets.length) return bucketId;
  return bucketLabel(buckets[idx], idx, lib);
}

function lineMatchesRule(line: BudgetScanLine, rule: (typeof AUTO_PUSH_RULES)[0]): boolean {
  const desc = line.Description.toLowerCase();
  const cat = line.Category.toLowerCase();
  for (const exact of rule.description_exact ?? []) {
    if (desc === exact.toLowerCase()) return true;
  }
  for (const kw of rule.description_contains ?? []) {
    if (desc.includes(kw.toLowerCase())) return true;
  }
  for (const kw of rule.category_contains ?? []) {
    if (cat.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function bucketIndexForCostCode(buckets: BudgetBucket[], costCode: string): number | null {
  const idx = buckets.findIndex((b) => fmtCell(b.cost_code) === fmtCell(costCode));
  return idx >= 0 ? idx : null;
}

function autoPushBucketForLine(line: BudgetScanLine, buckets: BudgetBucket[]): number | null {
  for (const rule of AUTO_PUSH_RULES) {
    if (!lineMatchesRule(line, rule)) continue;
    const idx = bucketIndexForCostCode(buckets, rule.cost_code);
    if (idx != null) return idx;
  }
  return null;
}

export function autoPushLines(lines: BudgetScanLine[], buckets: BudgetBucket[]): {
  lines: BudgetScanLine[];
  matchedRule: number;
  matchedCode: number;
} {
  const codeToBuckets = new Map<string, number[]>();
  buckets.forEach((b, i) => {
    const code = b.cost_code.trim();
    if (!code) return;
    const list = codeToBuckets.get(code) ?? [];
    list.push(i);
    codeToBuckets.set(code, list);
  });

  let matchedRule = 0;
  let matchedCode = 0;
  const next = lines.map((line) => {
    if (line.Hidden || line.Bucket.trim()) return line;
    const ruleIdx = autoPushBucketForLine(line, buckets);
    if (ruleIdx != null) {
      matchedRule++;
      return { ...line, Bucket: String(ruleIdx) };
    }
    const pdfCode = line["PDF Code"].trim();
    const options = codeToBuckets.get(pdfCode);
    if (options?.length === 1) {
      matchedCode++;
      return { ...line, Bucket: String(options[0]) };
    }
    return line;
  });
  return { lines: next, matchedRule, matchedCode };
}

export function deleteBucketIndices(
  buckets: BudgetBucket[],
  lines: BudgetScanLine[],
  deleteIndices: number[],
): { buckets: BudgetBucket[]; lines: BudgetScanLine[] } {
  const deleteSet = new Set(deleteIndices);
  const oldToNew = new Map<string, string>();
  let newIdx = 0;
  buckets.forEach((_, oldIdx) => {
    if (deleteSet.has(oldIdx)) return;
    oldToNew.set(String(oldIdx), String(newIdx));
    newIdx++;
  });
  const nextBuckets = buckets.filter((_, i) => !deleteSet.has(i));
  const nextLines = lines.map((line) => {
    const old = line.Bucket.trim();
    if (!old) return line;
    if (oldToNew.has(old)) return { ...line, Bucket: oldToNew.get(old)! };
    if (deleteSet.has(parseInt(old, 10))) return { ...line, Bucket: "" };
    return line;
  });
  return { buckets: nextBuckets, lines: nextLines };
}

export function bucketSnapshot(bucket: BudgetBucket): BudgetBucket {
  const row: BudgetBucket = {
    cost_code: fmtCell(bucket.cost_code),
    cost_class: fmtCell(bucket.cost_class),
  };
  if (bucket.template_type) row.template_type = fmtCell(bucket.template_type);
  if (bucket.notes) row.notes = fmtCell(bucket.notes);
  return row;
}

export function savedTemplateNames(lib: BudgetLibrary): string[] {
  return lib.bucket_templates.map((t) => t.name).filter(Boolean);
}

/** Saved default name, or empty if unset / missing from library. */
export function resolveDefaultTemplateName(lib: BudgetLibrary): string {
  const name = lib.default_bucket_template.trim();
  if (!name) return "";
  return savedTemplateNames(lib).includes(name) ? name : "";
}

export function bucketsFromTemplate(lib: BudgetLibrary, name: string): BudgetBucket[] | null {
  const tpl = lib.bucket_templates.find((t) => t.name === name);
  if (!tpl?.buckets?.length) return null;
  return tpl.buckets.map(bucketSnapshot);
}

/** When a budget has no buckets yet, apply the user's default saved template. */
export function defaultTemplateDraftPatch(
  lib: BudgetLibrary,
): Pick<BudgetMakerData, "buckets" | "loaded_template_name"> | null {
  const name = resolveDefaultTemplateName(lib);
  if (!name) return null;
  const buckets = bucketsFromTemplate(lib, name);
  if (!buckets) return null;
  return { buckets, loaded_template_name: name };
}

export function normalizeLibrary(raw: unknown): BudgetLibrary {
  const base = defaultBudgetLibrary();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  return {
    cost_codes: Array.isArray(o.cost_codes) ? (o.cost_codes as CostCodeRecord[]) : [],
    cost_classes: Array.isArray(o.cost_classes) ? (o.cost_classes as BudgetLibrary["cost_classes"]) : [],
    bucket_templates: Array.isArray(o.bucket_templates) ? (o.bucket_templates as BudgetLibrary["bucket_templates"]) : [],
    default_bucket_template: String(o.default_bucket_template ?? ""),
  };
}

export type SummaryMetrics = {
  budgetTotal: number;
  totalHours: number;
  unassignedTotal: number;
  userGrandTotal: number | null;
};

export function computeSummaryMetrics(
  lines: BudgetScanLine[],
  grandTotalRaw: string,
): SummaryMetrics {
  const visible = activeLines(lines);
  const assigned = visible.filter((l) => l.Bucket.trim());
  const unassigned = visible.filter((l) => !l.Bucket.trim());
  return {
    budgetTotal: assigned.reduce((s, l) => s + (l.Amount ?? 0), 0),
    totalHours: sumHours(assigned),
    unassignedTotal: unassigned.reduce((s, l) => s + (l.Amount ?? 0), 0),
    userGrandTotal: parseMoney(grandTotalRaw),
  };
}

export type BucketSummaryRow = {
  bucketIdx: number;
  workItem: string;
  costCode: string;
  costClass: string;
  glAcct: string;
  hours: string;
  amount: number;
  pct: string;
  notes: string;
};

export function buildSummaryRows(
  buckets: BudgetBucket[],
  lines: BudgetScanLine[],
  lib: BudgetLibrary,
  hideZero: boolean,
): BucketSummaryRow[] {
  const metrics = computeSummaryMetrics(lines, "");
  const budgetTotal = metrics.budgetTotal;
  const rows: BucketSummaryRow[] = [];
  buckets.forEach((bucket, i) => {
    const { amount, hours } = bucketMetrics(i, lines);
    if (hideZero && amount === 0) return;
    rows.push({
      bucketIdx: i,
      workItem: workItemForBucket(bucket, lib),
      costCode: formatCostCode(bucket.cost_code, lib),
      costClass: bucket.cost_class,
      glAcct: costClassGlAcct(lib, bucket.cost_class),
      hours: hours ? hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "",
      amount,
      pct: formatPct(amount, budgetTotal),
      notes: fmtCell(bucket.notes),
    });
  });
  return rows;
}

export function appendBucketsUnique(
  buckets: BudgetBucket[],
  newBuckets: BudgetBucket[],
): { buckets: BudgetBucket[]; added: number } {
  const existing = new Set(buckets.map((b) => `${b.cost_code}|${b.cost_class}`));
  let added = 0;
  const next = [...buckets];
  for (const b of newBuckets) {
    const key = `${b.cost_code}|${b.cost_class}`;
    if (existing.has(key)) continue;
    next.push(b);
    existing.add(key);
    added++;
  }
  return { buckets: next, added };
}

export type LineSplitPart = {
  bucket_idx: number;
  amount: number;
  hours: number;
};

/** Replace one scanned line with multiple bucket-assigned rows (desktop ``_apply_line_split``). */
export function applyLineSplit(
  lines: BudgetScanLine[],
  lineId: string,
  splits: LineSplitPart[],
): BudgetScanLine[] {
  if (!splits.length) return lines;
  const pos = lines.findIndex((l) => l.id === lineId);
  if (pos < 0) return lines;

  const orig = lines[pos];
  const origAmount = orig.Amount ?? 0;
  const origHours = orig["Man Hours"] ?? 0;

  const newRows: BudgetScanLine[] = splits.map((split) => {
    const amt = split.amount;
    const hrs = split.hours;
    let frac: number;
    if (origAmount > 0) frac = amt / origAmount;
    else if (origHours > 0) frac = hrs / origHours;
    else frac = 1 / splits.length;

    const qty = orig.Quantity;
    return {
      ...orig,
      id: crypto.randomUUID(),
      Quantity: qty != null ? qty * frac : null,
      Amount: amt,
      "Man Hours": hrs || null,
      Bucket: String(split.bucket_idx),
    };
  });

  return [...lines.slice(0, pos), ...newRows, ...lines.slice(pos + 1)];
}
