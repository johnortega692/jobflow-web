import { icbiPmEmail, icbiProjectManager } from "./jobInfo";
import { procurementLogRowFromLine } from "./procurementLog";
import { wcFieldStatus, wcStatusLabel, type WcFieldStatus } from "./fieldTrackerStatus";
import { isApsTrackItem } from "./wcComponents";
import { normalizeWcTrackerLines, trackerLineTrade, type WcTrackerLineState } from "../types/fieldTracker";
import type { ProjectForm, Json } from "../types/database";
import { normalizeFrpSubmittal, parseProjectTradeData, type FrpItem } from "../types/tradeDocuments";

export type PmMaterialsTone = "idle" | "progress" | "warn" | "ok";
export type PmMaterialKind = "paint" | "wallcovering" | "frp";

export type PmMaterialsRow = {
  id: string;
  projectId: string;
  jobNumber: string;
  jobName: string;
  kind: PmMaterialKind;
  kindLabel: string;
  finish: string;
  product: string;
  leadTime: string;
  approvalReceived: string;
  dateOrdered: string;
  shipDate: string;
  dateReceivedTracking: string;
  notes: string;
  status: string;
  tone: PmMaterialsTone;
  /** YYYY-MM-DD, or empty. */
  followUp: string;
  needsAction: boolean;
  href: string;
};

export type PmMaterialsFilter = "all" | "needs-action" | "this-week";
export type PmMaterialsSort = "follow-up" | "job" | "needs-action";
export type PmMaterialsSortDir = "asc" | "desc";

function isoDate(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

export function formatPmFollowUp(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export function losAngelesToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

/** Sunday of the week that contains `iso`, as YYYY-MM-DD. */
export function weekEndingSunday(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = utc.getUTCDay();
  if (day !== 0) utc.setUTCDate(utc.getUTCDate() + (7 - day));
  return utc.toISOString().slice(0, 10);
}

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase().replace(/\s+/g, " ");
  const right = b.trim().toLowerCase().replace(/\s+/g, " ");
  return Boolean(left && right && left === right);
}

export function projectBelongsToPm(
  project: ProjectForm,
  owner: { name: string; email: string },
): boolean {
  const info = project.jobInfo;
  if (namesMatch(icbiPmEmail(info), owner.email)) return true;
  return namesMatch(icbiProjectManager(info), owner.name);
}

function buyTone(status: WcFieldStatus): PmMaterialsTone {
  if (status === "Needs Revision") return "warn";
  if (status === "Material Ordered" || status === "Delivered") return "ok";
  if (status === "Not Started") return "idle";
  return "progress";
}

function buyNeedsAction(status: WcFieldStatus): boolean {
  return status !== "Material Ordered" && status !== "Delivered";
}

function lineFollowUp(line: WcTrackerLineState): string {
  return [line.followUp, line.esdFollowUp].map(isoDate).filter(Boolean).sort()[0] ?? "";
}

function trackedLineRow(project: ProjectForm, line: WcTrackerLineState): PmMaterialsRow {
  const paint = trackerLineTrade(line) === "paint";
  const status = wcFieldStatus(line);
  const log = procurementLogRowFromLine(line);
  return {
    id: `${project.id}:${line.id}`,
    projectId: project.id,
    jobNumber: project.job_number.trim(),
    jobName: project.job_name.trim(),
    kind: paint ? "paint" : "wallcovering",
    kindLabel: paint ? "Paint" : "Wallcovering",
    finish: log.finish || (paint ? "Paint" : "Wallcovering"),
    product: log.product,
    leadTime: log.leadTime,
    approvalReceived: log.approvalReceived,
    dateOrdered: log.dateOrdered,
    shipDate: log.shipDate,
    dateReceivedTracking: log.dateReceivedTracking,
    notes: log.notes,
    status: wcStatusLabel(status),
    tone: buyTone(status),
    followUp: lineFollowUp(line),
    needsAction: buyNeedsAction(status),
    href: `/projects/${project.id}/material-tracker?tab=log`,
  };
}

function frpHasContent(item: FrpItem): boolean {
  return Boolean(item.label.trim() || item.product.trim() || item.manufacturer.trim());
}

function frpRow(project: ProjectForm, item: FrpItem, index: number): PmMaterialsRow {
  const finish = item.label.trim() || "FRP";
  const product = [item.manufacturer, item.product, item.color].filter((part) => part.trim()).join(" ").trim();
  return {
    id: `${project.id}:frp:${index}`,
    projectId: project.id,
    jobNumber: project.job_number.trim(),
    jobName: project.job_name.trim(),
    kind: "frp",
    kindLabel: "FRP",
    finish,
    product: product === finish ? item.product.trim() : product,
    leadTime: "",
    approvalReceived: "",
    dateOrdered: "",
    shipDate: "",
    dateReceivedTracking: "",
    notes: item.notes.trim(),
    status: "To order",
    tone: "progress",
    followUp: "",
    needsAction: true,
    href: `/projects/${project.id}/orders`,
  };
}

export function buildPmMaterialsRows(
  projects: ProjectForm[],
  owner: { name: string; email: string },
): PmMaterialsRow[] {
  const rows: PmMaterialsRow[] = [];
  for (const project of projects) {
    if (!projectBelongsToPm(project, owner)) continue;
    const trade = parseProjectTradeData(project.data as Json);
    const lines = normalizeWcTrackerLines(trade.wc_tracker_lines).filter(
      (line) => !isApsTrackItem({ manufacturer: line.manufacturer, product: line.wallcoveringName || line.product }),
    );
    for (const line of lines) rows.push(trackedLineRow(project, line));
    normalizeFrpSubmittal(trade.frp_submittal).items.forEach((item, index) => {
      if (!item.order || !frpHasContent(item)) return;
      rows.push(frpRow(project, item, index));
    });
  }
  return rows;
}

export function pmMaterialsFollowUpIsThisWeek(iso: string, today: string): boolean {
  if (!iso || !today) return false;
  return iso <= weekEndingSunday(today);
}

export function filterPmMaterialsRows(
  rows: PmMaterialsRow[],
  filter: PmMaterialsFilter,
  today: string,
): PmMaterialsRow[] {
  if (filter === "needs-action") return rows.filter((row) => row.needsAction);
  if (filter === "this-week") return rows.filter((row) => pmMaterialsFollowUpIsThisWeek(row.followUp, today));
  return rows;
}

function compareFollowUp(a: PmMaterialsRow, b: PmMaterialsRow): number {
  if (a.followUp && b.followUp) return a.followUp < b.followUp ? -1 : a.followUp > b.followUp ? 1 : 0;
  if (a.followUp) return -1;
  if (b.followUp) return 1;
  return 0;
}

function compareJob(a: PmMaterialsRow, b: PmMaterialsRow): number {
  const num = a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true });
  if (num !== 0) return num;
  return a.jobName.localeCompare(b.jobName) || a.finish.localeCompare(b.finish);
}

export function sortPmMaterialsRows(
  rows: PmMaterialsRow[],
  sort: PmMaterialsSort,
  dir: PmMaterialsSortDir,
): PmMaterialsRow[] {
  const copy = [...rows];
  const sign = dir === "asc" ? 1 : -1;
  copy.sort((a, b) => {
    if (sort === "job") return compareJob(a, b) * sign;
    if (sort === "needs-action") {
      const action = Number(b.needsAction) - Number(a.needsAction);
      if (dir === "desc") return -action || compareFollowUp(a, b);
      return action || compareFollowUp(a, b);
    }
    const follow = compareFollowUp(a, b);
    if (follow !== 0) {
      if (!a.followUp || !b.followUp) return follow;
      return follow * sign;
    }
    return compareJob(a, b);
  });
  return copy;
}
