import type { Submittal } from "../types/database";
import {
  emptySubmittalLogRow,
  newLogRowId,
  type SubmittalLogRow,
} from "../types/submittalLog";

export function parseSpecSectionForLog(specSection: string): {
  spec: string;
  section: string;
  scope: string;
} {
  const text = specSection.trim();
  if (!text) return { spec: "", section: "", scope: "Finishes" };

  let scope = "Finishes";
  const lower = text.toLowerCase();
  if (lower.includes("09 72") || lower.includes("0972") || lower.includes("wallcover")) {
    scope = "Wallcovering";
  } else if (
    lower.includes("09 91") ||
    lower.includes("09 96") ||
    lower.includes("09 97") ||
    lower.includes("paint")
  ) {
    scope = "Paint";
  } else if (lower.includes("09 51") || lower.includes("09 62") || lower.includes("09 84") || lower.includes("ceiling")) {
    scope = "Ceiling";
  } else if (lower.includes("09 65") || lower.includes("09 67") || lower.includes("floor")) {
    scope = "Flooring";
  } else if (lower.includes("07 92") || lower.includes("sealant")) {
    scope = "Sealants";
  } else if (lower.includes("07 84") || lower.includes("firestop") || lower.includes("fireproof")) {
    scope = "Fireproofing";
  } else if (lower.includes("frp") || lower.includes("06 60")) {
    scope = "FRP";
  } else if (lower.includes("track") || lower.includes("fabric")) {
    scope = "Track";
  }

  let spec = "";
  let section = text;
  const m = text.match(/(\d{2}\s+\d{2}\s+\d{2})/);
  if (m) {
    section = m[1]!;
    spec = m[1]!.replace(/\s/g, "");
  } else if (/^\d{6}$/.test(text.replace(/\s/g, ""))) {
    spec = text.replace(/\s/g, "");
    section = "";
  }

  return { spec, section, scope };
}

export function parseLineNumber(value: string): number | null {
  const s = value.trim().replace(/^#/, "");
  if (!s) return null;
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatLineNumber(n: number): string {
  return n < 100 ? String(n).padStart(2, "0") : String(n);
}

export function formatLineNumberDisplay(value: string): string {
  const s = value.trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n < 100) return formatLineNumber(n);
  }
  return s;
}

export function suggestNextLineNumber(existing: string[]): string {
  const nums = existing.map(parseLineNumber).filter((n): n is number => n !== null);
  if (!nums.length) return "01";
  const max = Math.max(...nums);
  const used = new Set(nums);
  for (let i = 1; i <= max; i++) {
    if (!used.has(i)) return formatLineNumber(i);
  }
  return formatLineNumber(max + 1);
}

export function formatLogDate(d = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export function sdsSubmittalDescription(specSection: string, packetType: string): string {
  const spec = specSection.trim();
  const pt = packetType.trim();
  if (spec && pt) return `${spec} · ${pt}`;
  return spec || pt || "Product Data";
}

export function sdsTransmittalEnclosureDescription(specSection: string, packetType: string): string {
  return sdsSubmittalDescription(specSection, packetType);
}

type LogDataJson = {
  spec?: string;
  submit_date?: string;
  return_date?: string;
  transmittal_number?: string;
  notes?: string;
  revises_line?: string;
  trade_submittal_number?: string;
  linked_files?: string[];
  log_id?: string;
  packet_type?: string;
  source?: string;
};

export function normalizeLogRow(raw: Partial<SubmittalLogRow> | null | undefined): SubmittalLogRow {
  const base = emptySubmittalLogRow();
  if (!raw) return { ...base, id: newLogRowId() };
  return {
    id: raw.id?.trim() || newLogRowId(),
    line_number: formatLineNumberDisplay(raw.line_number ?? base.line_number),
    spec: raw.spec?.trim() ?? "",
    scope: raw.scope?.trim() || "Paint",
    section: raw.section?.trim() ?? "",
    submittal_type: raw.submittal_type?.trim() ?? "",
    submit_date: raw.submit_date?.trim() ?? "",
    return_date: raw.return_date?.trim() ?? "",
    result: raw.result?.trim() ?? "",
    status: raw.status?.trim() || "Draft",
    transmittal_number: raw.transmittal_number?.trim() ?? "",
    notes: raw.notes?.trim() ?? "",
    revises_line: raw.revises_line?.trim() ?? "",
    trade_submittal_number: raw.trade_submittal_number?.trim() ?? "",
    linked_files: [...(raw.linked_files ?? [])],
  };
}

export function dbRowToLog(row: Submittal): SubmittalLogRow {
  const data = (row.data ?? {}) as LogDataJson;
  return normalizeLogRow({
    id: row.id,
    line_number: row.line_number,
    spec: data.spec ?? "",
    scope: row.scope,
    section: row.spec_section,
    submittal_type: row.submittal_type,
    submit_date: data.submit_date ?? "",
    return_date: data.return_date ?? "",
    result: row.result_code,
    status: row.status,
    transmittal_number: data.transmittal_number ?? "",
    notes: data.notes ?? row.description ?? "",
    revises_line: data.revises_line ?? "",
    trade_submittal_number: data.trade_submittal_number ?? "",
    linked_files: data.linked_files ?? [],
  });
}

export function logRowToDbPayload(
  row: SubmittalLogRow,
  projectId: string,
  createdBy?: string | null,
): Omit<Submittal, "created_at" | "updated_at"> {
  const data: LogDataJson = {
    log_id: row.id,
    spec: row.spec,
    submit_date: row.submit_date,
    return_date: row.return_date,
    transmittal_number: row.transmittal_number,
    notes: row.notes,
    revises_line: row.revises_line,
    trade_submittal_number: row.trade_submittal_number,
    linked_files: row.linked_files,
  };
  return {
    id: row.id,
    project_id: projectId,
    line_number: formatLineNumberDisplay(row.line_number),
    description: row.notes,
    spec_section: row.section,
    submittal_type: row.submittal_type,
    scope: row.scope,
    status: row.status,
    result_code: row.result,
    data,
    created_by: createdBy ?? null,
  };
}

export function sortLogRows(rows: SubmittalLogRow[]): SubmittalLogRow[] {
  return [...rows].sort((a, b) => {
    const na = parseLineNumber(a.line_number);
    const nb = parseLineNumber(b.line_number);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.line_number.localeCompare(b.line_number);
  });
}

export function lineNumberInUse(
  rows: SubmittalLogRow[],
  lineNumber: string,
  excludeId?: string,
): boolean {
  const target = formatLineNumberDisplay(lineNumber);
  return rows.some(
    (r) => r.id !== excludeId && formatLineNumberDisplay(r.line_number) === target,
  );
}

export function buildAutoLogRow(
  existing: SubmittalLogRow[],
  params: {
    submittal_type: string;
    scope?: string;
    spec?: string;
    section?: string;
    notes?: string;
    trade_submittal_number?: string;
    revises_line?: string;
    submit_today?: boolean;
    status?: string;
    linked_files?: string[];
  },
): SubmittalLogRow {
  const line = suggestNextLineNumber(existing.map((r) => r.line_number));
  const today = formatLogDate();
  const status = params.status || (params.submit_today ? "Submitted" : "Ready");
  return normalizeLogRow({
    line_number: line,
    spec: params.spec ?? "",
    scope: params.scope ?? "Paint",
    section: params.section ?? "",
    submittal_type: params.submittal_type,
    submit_date: params.submit_today ? today : "",
    status,
    notes: params.notes ?? "",
    trade_submittal_number: params.trade_submittal_number ?? "",
    revises_line: params.revises_line ?? "",
    linked_files: params.linked_files ?? [],
  });
}

export function rowEnclosureDescription(row: SubmittalLogRow): string {
  const parts: string[] = [];
  if (row.scope.trim()) parts.push(row.scope.trim());
  if (row.submittal_type.trim()) parts.push(row.submittal_type.trim());
  if (row.spec.trim()) parts.push(`Spec ${row.spec.trim()}`);
  if (row.section.trim()) parts.push(row.section.trim());
  if (row.line_number.trim()) parts.push(`Log #${formatLineNumberDisplay(row.line_number)}`);
  return parts.length ? parts.join(" – ") : "Submittal item";
}

export function paintLogRowFromSubmittal(submittalNumber: number): SubmittalLogRow {
  return buildAutoLogRow([], {
    submittal_type: "Color Samples",
    scope: "Paint",
    spec: "099000",
    notes: `Paint submittal #${submittalNumber}`,
    trade_submittal_number: String(submittalNumber),
    status: "Ready",
  });
}

export function buildRevisionRow(source: SubmittalLogRow, existing: SubmittalLogRow[]): SubmittalLogRow {
  const line = suggestNextLineNumber(existing.map((r) => r.line_number));
  return normalizeLogRow({
    line_number: line,
    spec: source.spec,
    scope: source.scope,
    section: source.section,
    submittal_type: source.submittal_type,
    revises_line: source.line_number,
    notes: `Revises #${source.line_number}`,
    status: "Draft",
  });
}

export function wallcoveringLogRowFromSubmittal(submittalNumber: number): SubmittalLogRow {
  return buildAutoLogRow([], {
    submittal_type: "Color Samples",
    scope: "Wallcovering",
    spec: "096000",
    notes: `Wallcovering submittal #${submittalNumber}`,
    trade_submittal_number: String(submittalNumber),
    status: "Ready",
  });
}
