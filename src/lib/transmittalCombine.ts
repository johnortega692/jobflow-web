import {
  latestHistoryEntryForPackage,
  latestHistoryEntryPerPackage,
  resolveHistoryEntryForSheet,
} from "../lib/submittalHistory";
import type { PaintItem, ProjectTradeData, TransmittalData } from "../types/tradeDocuments";
import {
  defaultPackageForScope,
  normalizeFrpSubmittal,
  normalizePackageCategory,
  normalizePaintSubmittal,
  normalizeWallcoveringSubmittal,
  paintSubjectForPackage,
  wcSubjectForPackage,
  frpSubjectForPackage,
  type FrpItem,
  type FrpSubmittalData,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type WallcoveringItem,
} from "../types/tradeDocuments";
import { projectPrintInfoForContract } from "./jobInfo";
import { buildFrpSubmittalSections } from "./frpSubmittalPrint";
import { mergePdfBytes } from "./pdfMerge";
import { buildPaintSubmittalSections } from "./paintSubmittalPrint";
import type { PrintBranding } from "./printCore";
import { buildTransmittalPdfBytes } from "./transmittalPdf";
import { buildTradeSubmittalPdfBytes } from "./tradeSubmittalPdf";
import { buildWallcoveringSubmittalSections } from "./wallcoveringSubmittalPrint";
import type { ProjectForm } from "../types/database";

type ProjectInfo = { job_number: string; job_name: string };

export type TransmittalDownloadContext = {
  transmittalProject: ProjectInfo;
  project: Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2" | "jobInfo">;
  data: TransmittalData;
  branding: PrintBranding;
  tradeData: ProjectTradeData;
};

export type TransmittalDownloadResult = {
  bytes: Uint8Array;
  combined: boolean;
  appendedSheets: number;
  missing: string[];
};

function paintItemHasContent(item: PaintItem): boolean {
  return Boolean(item.label.trim() || item.color.trim() || item.product.trim() || item.manufacturer.trim());
}

function wcItemHasContent(item: WallcoveringItem): boolean {
  return Boolean(item.label.trim() || item.color.trim() || item.product.trim() || item.manufacturer.trim());
}

function frpItemHasContent(item: FrpItem): boolean {
  return Boolean(item.label.trim() || item.product.trim() || item.color.trim() || item.manufacturer.trim());
}

function missingSheetLabel(scope: "Paint" | "Wallcovering" | "FRP", submittalNumber: number): string {
  return `No ${scope.toLowerCase()} submittal data found for #${String(submittalNumber).padStart(3, "0")}. Save the ${scope} tab or issue the submittal first.`;
}

function defaultSubmittalNumber(
  tradeData: ProjectTradeData,
  scope: "paint" | "wallcovering" | "frp",
): number | undefined {
  const live =
    scope === "paint"
      ? tradeData.paint_submittal?.submittal_number
      : scope === "wallcovering"
        ? tradeData.wallcovering_submittal?.submittal_number
        : tradeData.frp_submittal?.submittal_number;
  if (live) return live;
  const history =
    scope === "paint"
      ? tradeData.paint_submittal_history
      : scope === "wallcovering"
        ? tradeData.wallcovering_submittal_history
        : tradeData.frp_submittal_history;
  const latest = latestHistoryEntryPerPackage(history ?? []);
  return latest[0]?.submittal_number;
}

function effectiveSubmittalNums(
  include: boolean,
  selected: number[],
  tradeData: ProjectTradeData,
  scope: "paint" | "wallcovering" | "frp",
): number[] {
  if (!include) return [];
  if (selected.length) return selected;
  const fallback = defaultSubmittalNumber(tradeData, scope);
  return fallback ? [fallback] : [];
}

function paintDataFromHistory(entry: SubmittalHistoryEntry): PaintSubmittalData {
  const packageType = normalizePackageCategory(
    entry.package_type,
    defaultPackageForScope("paint"),
    "paint",
  );
  const submittalType = entry.submittal_type ?? "new";
  return normalizePaintSubmittal({
    submittal_number: entry.submittal_number,
    revision_number: entry.revision_number,
    issue_status: entry.issue_status ?? "issued",
    package_type: packageType,
    submittal_type: submittalType,
    subject: paintSubjectForPackage(packageType, submittalType),
    spec_section: entry.spec_section,
    date: entry.date,
    items: entry.items as PaintItem[],
    revision_note: entry.revision_note,
  });
}

function wallcoveringDataFromHistory(entry: SubmittalHistoryEntry): ReturnType<typeof normalizeWallcoveringSubmittal> {
  const packageType = normalizePackageCategory(
    entry.package_type,
    defaultPackageForScope("wallcovering"),
    "wallcovering",
  );
  const submittalType = entry.submittal_type ?? "new";
  return normalizeWallcoveringSubmittal({
    submittal_number: entry.submittal_number,
    revision_number: entry.revision_number,
    issue_status: entry.issue_status ?? "issued",
    package_type: packageType,
    submittal_type: submittalType,
    subject: wcSubjectForPackage(packageType, submittalType),
    spec_section: entry.spec_section,
    date: entry.date,
    items: entry.items as WallcoveringItem[],
    revision_note: entry.revision_note,
  });
}

function frpDataFromHistory(entry: SubmittalHistoryEntry): FrpSubmittalData {
  const packageType = normalizePackageCategory(entry.package_type, defaultPackageForScope("frp"), "frp");
  return normalizeFrpSubmittal({
    submittal_number: entry.submittal_number,
    revision_number: entry.revision_number,
    issue_status: entry.issue_status ?? "issued",
    package_type: packageType,
    subject: frpSubjectForPackage(packageType),
    spec_section: entry.spec_section,
    date: entry.date,
    items: entry.items as FrpItem[],
    revision_note: entry.revision_note,
  });
}

function resolvePaintData(
  tradeData: ProjectTradeData,
  submittalNumber: number,
): PaintSubmittalData | undefined {
  const history = tradeData.paint_submittal_history ?? [];
  const entry = resolveHistoryEntryForSheet(history, submittalNumber);
  if (entry && entry.items.some((i) => paintItemHasContent(i as PaintItem))) {
    return paintDataFromHistory(entry);
  }
  const live = normalizePaintSubmittal(tradeData.paint_submittal);
  if (live.submittal_number === submittalNumber && live.items.some(paintItemHasContent)) {
    return live;
  }
  const anyEntry = latestHistoryEntryForPackage(history, submittalNumber);
  if (anyEntry && anyEntry.items.some((i) => paintItemHasContent(i as PaintItem))) {
    return paintDataFromHistory(anyEntry);
  }
  return undefined;
}

function resolveWallcoveringData(
  tradeData: ProjectTradeData,
  submittalNumber: number,
): ReturnType<typeof normalizeWallcoveringSubmittal> | undefined {
  const history = tradeData.wallcovering_submittal_history ?? [];
  const entry = resolveHistoryEntryForSheet(history, submittalNumber);
  if (entry && entry.items.some((i) => wcItemHasContent(i as WallcoveringItem))) {
    return wallcoveringDataFromHistory(entry);
  }
  const live = normalizeWallcoveringSubmittal(tradeData.wallcovering_submittal);
  if (live.submittal_number === submittalNumber && live.items.some(wcItemHasContent)) {
    return live;
  }
  const anyEntry = latestHistoryEntryForPackage(history, submittalNumber);
  if (anyEntry && anyEntry.items.some((i) => wcItemHasContent(i as WallcoveringItem))) {
    return wallcoveringDataFromHistory(anyEntry);
  }
  return undefined;
}

function resolveFrpData(tradeData: ProjectTradeData, submittalNumber: number): FrpSubmittalData | undefined {
  const history = tradeData.frp_submittal_history ?? [];
  const entry = resolveHistoryEntryForSheet(history, submittalNumber);
  if (entry && entry.items.some((i) => frpItemHasContent(i as FrpItem))) {
    return frpDataFromHistory(entry);
  }
  const live = normalizeFrpSubmittal(tradeData.frp_submittal);
  if (live.submittal_number === submittalNumber && live.items.some(frpItemHasContent)) {
    return live;
  }
  const anyEntry = latestHistoryEntryForPackage(history, submittalNumber);
  if (anyEntry && anyEntry.items.some((i) => frpItemHasContent(i as FrpItem))) {
    return frpDataFromHistory(anyEntry);
  }
  return undefined;
}

function shouldMergeTradeSheets(data: TransmittalData): boolean {
  return (
    data.combine_enclosures ||
    data.include_paint_sheet ||
    data.include_wc_sheet ||
    data.include_frp_sheet
  );
}

/**
 * Build transmittal PDF bytes. Appends paint / WC / FRP sheets when included.
 * Uses issued history when available, otherwise latest history or the live trade tab draft.
 */
export async function buildTransmittalDownloadPdf(
  ctx: TransmittalDownloadContext,
): Promise<TransmittalDownloadResult> {
  const { transmittalProject, project, data, branding, tradeData } = ctx;
  const coverBytes = await buildTransmittalPdfBytes(transmittalProject, data, branding);

  if (!shouldMergeTradeSheets(data)) {
    return {
      bytes: coverBytes,
      combined: false,
      appendedSheets: 0,
      missing: [],
    };
  }

  const parts: Uint8Array[] = [coverBytes];
  const missing: string[] = [];

  const paintNums = effectiveSubmittalNums(
    data.include_paint_sheet,
    data.paint_submittal_nums,
    tradeData,
    "paint",
  );
  for (const num of paintNums) {
    const paintData = resolvePaintData(tradeData, num);
    if (!paintData) {
      missing.push(missingSheetLabel("Paint", num));
      continue;
    }
    parts.push(
      await buildTradeSubmittalPdfBytes({
        project: projectPrintInfoForContract(project, "paint"),
        branding,
        date: paintData.date,
        subject: paintData.subject,
        specSection: paintData.spec_section,
        submittalNumber: paintData.submittal_number,
        revisionNumber: paintData.revision_number,
        revisionNote: paintData.revision_note,
        submittalType: paintData.submittal_type,
        sections: buildPaintSubmittalSections(paintData),
      }),
    );
  }

  const wcNums = effectiveSubmittalNums(data.include_wc_sheet, data.wc_submittal_nums, tradeData, "wallcovering");
  for (const num of wcNums) {
    const wcData = resolveWallcoveringData(tradeData, num);
    if (!wcData) {
      missing.push(missingSheetLabel("Wallcovering", num));
      continue;
    }
    parts.push(
      await buildTradeSubmittalPdfBytes({
        project: projectPrintInfoForContract(project, "wallcovering"),
        branding,
        date: wcData.date,
        subject: wcData.subject,
        specSection: wcData.spec_section,
        submittalNumber: wcData.submittal_number,
        revisionNumber: wcData.revision_number,
        revisionNote: wcData.revision_note,
        submittalType: wcData.submittal_type,
        sections: buildWallcoveringSubmittalSections(wcData),
      }),
    );
  }

  const frpNums = effectiveSubmittalNums(data.include_frp_sheet, data.frp_submittal_nums, tradeData, "frp");
  for (const num of frpNums) {
    const frpData = resolveFrpData(tradeData, num);
    if (!frpData) {
      missing.push(missingSheetLabel("FRP", num));
      continue;
    }
    parts.push(
      await buildTradeSubmittalPdfBytes({
        project: projectPrintInfoForContract(project, "frp"),
        branding,
        date: frpData.date,
        subject: frpData.subject,
        specSection: frpData.spec_section,
        submittalNumber: frpData.submittal_number,
        revisionNumber: frpData.revision_number,
        revisionNote: frpData.revision_note,
        sections: buildFrpSubmittalSections(frpData),
      }),
    );
  }

  if (parts.length === 1) {
    return {
      bytes: coverBytes,
      combined: false,
      appendedSheets: 0,
      missing,
    };
  }

  return {
    bytes: await mergePdfBytes(parts),
    combined: true,
    appendedSheets: parts.length - 1,
    missing,
  };
}

export function defaultPaintSubmittalNum(tradeData: ProjectTradeData): number | undefined {
  return defaultSubmittalNumber(tradeData, "paint");
}

export function defaultWallcoveringSubmittalNum(tradeData: ProjectTradeData): number | undefined {
  return defaultSubmittalNumber(tradeData, "wallcovering");
}

export function defaultFrpSubmittalNum(tradeData: ProjectTradeData): number | undefined {
  return defaultSubmittalNumber(tradeData, "frp");
}
