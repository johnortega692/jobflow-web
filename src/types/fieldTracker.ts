import type { PaintVendorLabel } from "../lib/googleSheetsConfig";

export type PaintTrackerState = {
  matchExisting: boolean;
  submittalOrdered: boolean;
  submittedForApproval: boolean;
  revision: boolean;
  revisionNotes: string;
  approved: boolean;
  nightsWeekends: boolean;
  noPaint: boolean;
  fsi: boolean;
  paintVendor: PaintVendorLabel;
  creativeTeam: string;
  followUp: string;
};

export type WcTrackerState = {
  submittalOrdered: boolean;
  submittedForApproval: boolean;
  revision: boolean;
  revisionNotes: string;
  approved: boolean;
  creativeTeam: string;
  followUp: string;
};

export type WcTrackerLineState = {
  id: string;
  label: string;
  wallcoveringName: string;
  panels: boolean;
  ordered: boolean;
  sentForApproval: boolean;
  revision: boolean;
  revisionNotes: string;
  approved: boolean;
  fieldMeasurement: boolean;
  shops: boolean;
  materialOrder: boolean;
  delivered: boolean;
  installDate: string;
  followUp: string;
  esdFollowUp: string;
  packageQty: string;
  leadTime: string;
  approvalReceived: string;
  dateOrdered: string;
  shipDate: string;
  tracking: string;
  notesDelivered: string;
  dropbox: string;
  imageUrl: string;
};

export const defaultWcTrackerState = (): WcTrackerState => ({
  submittalOrdered: false,
  submittedForApproval: false,
  revision: false,
  revisionNotes: "",
  approved: false,
  creativeTeam: "",
  followUp: "",
});

export const defaultWcTrackerLineFields = (): Omit<WcTrackerLineState, "id" | "label" | "wallcoveringName"> => ({
  panels: false,
  ordered: false,
  sentForApproval: false,
  revision: false,
  revisionNotes: "",
  approved: false,
  fieldMeasurement: false,
  shops: false,
  materialOrder: false,
  delivered: false,
  installDate: "",
  followUp: "",
  esdFollowUp: "",
  packageQty: "",
  leadTime: "",
  approvalReceived: "",
  dateOrdered: "",
  shipDate: "",
  tracking: "",
  notesDelivered: "",
  dropbox: "",
  imageUrl: "",
});

export const defaultPaintTrackerState = (): PaintTrackerState => ({
  matchExisting: false,
  submittalOrdered: false,
  submittedForApproval: false,
  revision: false,
  revisionNotes: "",
  approved: false,
  nightsWeekends: false,
  noPaint: false,
  fsi: false,
  paintVendor: "PPG",
  creativeTeam: "",
  followUp: "",
});

export function normalizePaintTrackerState(raw: unknown): PaintTrackerState {
  const base = defaultPaintTrackerState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Partial<PaintTrackerState>;
  return {
    ...base,
    matchExisting: Boolean(o.matchExisting),
    submittalOrdered: Boolean(o.submittalOrdered),
    submittedForApproval: Boolean(o.submittedForApproval),
    revision: Boolean(o.revision),
    revisionNotes: String(o.revisionNotes ?? ""),
    approved: Boolean(o.approved),
    nightsWeekends: Boolean(o.nightsWeekends),
    noPaint: Boolean(o.noPaint),
    fsi: Boolean(o.fsi),
    paintVendor: (String(o.paintVendor ?? base.paintVendor) as PaintVendorLabel) || "PPG",
    creativeTeam: String(o.creativeTeam ?? ""),
    followUp: String(o.followUp ?? ""),
  };
}

export function normalizeWcTrackerLine(raw: unknown, fallbackId: string): WcTrackerLineState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<WcTrackerLineState>;
  const label = String(o.label ?? "").trim();
  const wallcoveringName = String(o.wallcoveringName ?? "").trim();
  if (!label && !wallcoveringName) return null;
  const defaults = defaultWcTrackerLineFields();
  return {
    id: String(o.id ?? fallbackId),
    label,
    wallcoveringName,
    panels: Boolean(o.panels),
    ordered: Boolean(o.ordered),
    sentForApproval: Boolean(o.sentForApproval),
    revision: Boolean(o.revision),
    revisionNotes: String(o.revisionNotes ?? defaults.revisionNotes),
    approved: Boolean(o.approved),
    fieldMeasurement: Boolean(o.fieldMeasurement),
    shops: Boolean(o.shops),
    materialOrder: Boolean(o.materialOrder),
    delivered: Boolean(o.delivered),
    installDate: String(o.installDate ?? defaults.installDate),
    followUp: String(o.followUp ?? defaults.followUp),
    esdFollowUp: String(o.esdFollowUp ?? defaults.esdFollowUp),
    packageQty: String(o.packageQty ?? defaults.packageQty),
    leadTime: String(o.leadTime ?? defaults.leadTime),
    approvalReceived: String(o.approvalReceived ?? defaults.approvalReceived),
    dateOrdered: String(o.dateOrdered ?? defaults.dateOrdered),
    shipDate: String(o.shipDate ?? defaults.shipDate),
    tracking: String(o.tracking ?? defaults.tracking),
    notesDelivered: String(o.notesDelivered ?? defaults.notesDelivered),
    dropbox: String(o.dropbox ?? defaults.dropbox),
    imageUrl: String(o.imageUrl ?? defaults.imageUrl),
  };
}

export function normalizeWcTrackerState(raw: unknown): WcTrackerState {
  const base = defaultWcTrackerState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Partial<WcTrackerState>;
  return {
    ...base,
    submittalOrdered: Boolean(o.submittalOrdered),
    submittedForApproval: Boolean(o.submittedForApproval),
    revision: Boolean(o.revision),
    revisionNotes: String(o.revisionNotes ?? ""),
    approved: Boolean(o.approved),
    creativeTeam: String(o.creativeTeam ?? ""),
    followUp: String(o.followUp ?? ""),
  };
}

export function normalizeWcTrackerLines(raw: unknown): WcTrackerLineState[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line, i) => normalizeWcTrackerLine(line, `line-${i}`))
    .filter((l): l is WcTrackerLineState => l !== null);
}

export function createEmptyWcTrackerLine(): WcTrackerLineState {
  return {
    id: `line-${Date.now()}`,
    label: "",
    wallcoveringName: "",
    ...defaultWcTrackerLineFields(),
  };
}
