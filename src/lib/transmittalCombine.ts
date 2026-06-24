import type { ProjectForm } from "../types/database";
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
  type PaintItem,
  type ProjectTradeData,
  type SubmittalHistoryEntry,
  type TransmittalData,
  type WallcoveringItem,
} from "../types/tradeDocuments";
import { projectPrintInfoForContract } from "./jobInfo";
import { buildFrpSubmittalSections } from "./frpSubmittalPrint";
import { mergePdfBytes } from "./pdfMerge";
import { buildPaintSubmittalSections } from "./paintSubmittalPrint";
import type { PrintBranding } from "./printCore";
import { latestIssuedHistoryEntryForPackage } from "./submittalHistory";
import { buildTransmittalPdfBytes } from "./transmittalPdf";
import { buildTradeSubmittalPdfBytes } from "./tradeSubmittalPdf";
import { buildWallcoveringSubmittalSections } from "./wallcoveringSubmittalPrint";

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
  enclosureMergeSkipped: boolean;
};

function missingIssuedSheetLabel(scope: "Paint" | "Wallcovering" | "FRP", submittalNumber: number): string {
  return `No issued submittal found for ${scope} Submittal #${String(submittalNumber).padStart(3, "0")}. Issue the submittal first, then try again.`;
}

function paintDataFromHistory(entry: SubmittalHistoryEntry): ReturnType<typeof normalizePaintSubmittal> {
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
    date: entry.date,
    items: entry.items as FrpItem[],
    revision_note: entry.revision_note,
  });
}

function shouldCombineSheets(data: TransmittalData): boolean {
  return (
    data.combine_enclosures ||
    data.include_paint_sheet ||
    data.include_wc_sheet ||
    data.include_frp_sheet
  );
}

/**
 * Build transmittal PDF bytes. Trade submittal sheets are generated only from
 * issued/locked history entries — never from live draft tabs.
 */
export async function buildTransmittalDownloadPdf(
  ctx: TransmittalDownloadContext,
): Promise<TransmittalDownloadResult> {
  const { transmittalProject, project, data, branding, tradeData } = ctx;
  const coverBytes = await buildTransmittalPdfBytes(transmittalProject, data, branding);

  if (!shouldCombineSheets(data)) {
    return {
      bytes: coverBytes,
      combined: false,
      appendedSheets: 0,
      missing: [],
      enclosureMergeSkipped: false,
    };
  }

  const parts: Uint8Array[] = [coverBytes];
  const missing: string[] = [];

  if (data.include_paint_sheet) {
    const history = tradeData.paint_submittal_history ?? [];
    for (const num of data.paint_submittal_nums) {
      const entry = latestIssuedHistoryEntryForPackage(history, num);
      if (!entry) {
        missing.push(missingIssuedSheetLabel("Paint", num));
        continue;
      }
      const paintData = paintDataFromHistory(entry);
      parts.push(
        await buildTradeSubmittalPdfBytes({
          project: projectPrintInfoForContract(project, "paint"),
          branding,
          date: paintData.date,
          subject: paintData.subject,
          submittalNumber: paintData.submittal_number,
          revisionNumber: paintData.revision_number,
          revisionNote: paintData.revision_note,
          sections: buildPaintSubmittalSections(paintData),
        }),
      );
    }
  }

  if (data.include_wc_sheet) {
    const history = tradeData.wallcovering_submittal_history ?? [];
    for (const num of data.wc_submittal_nums) {
      const entry = latestIssuedHistoryEntryForPackage(history, num);
      if (!entry) {
        missing.push(missingIssuedSheetLabel("Wallcovering", num));
        continue;
      }
      const wcData = wallcoveringDataFromHistory(entry);
      parts.push(
        await buildTradeSubmittalPdfBytes({
          project: projectPrintInfoForContract(project, "wallcovering"),
          branding,
          date: wcData.date,
          subject: wcData.subject,
          submittalNumber: wcData.submittal_number,
          revisionNumber: wcData.revision_number,
          revisionNote: wcData.revision_note,
          sections: buildWallcoveringSubmittalSections(wcData),
        }),
      );
    }
  }

  if (data.include_frp_sheet) {
    const history = tradeData.frp_submittal_history ?? [];
    for (const num of data.frp_submittal_nums) {
      const entry = latestIssuedHistoryEntryForPackage(history, num);
      if (!entry) {
        missing.push(missingIssuedSheetLabel("FRP", num));
        continue;
      }
      const frpData = frpDataFromHistory(entry);
      parts.push(
        await buildTradeSubmittalPdfBytes({
          project: projectPrintInfoForContract(project, "frp"),
          branding,
          date: frpData.date,
          subject: frpData.subject,
          submittalNumber: frpData.submittal_number,
          revisionNumber: frpData.revision_number,
          revisionNote: frpData.revision_note,
          sections: buildFrpSubmittalSections(frpData),
        }),
      );
    }
  }

  const enclosureMergeSkipped = data.combine_enclosures;

  if (parts.length === 1) {
    return {
      bytes: coverBytes,
      combined: false,
      appendedSheets: 0,
      missing,
      enclosureMergeSkipped,
    };
  }

  return {
    bytes: await mergePdfBytes(parts),
    combined: true,
    appendedSheets: parts.length - 1,
    missing,
    enclosureMergeSkipped,
  };
}
