import { logSubmittalTypeForPacket } from "./sdsPacketPresets";
import { parseSpecSectionForLog, sdsSubmittalDescription } from "./submittalLogHelpers";
import { loadSubmittalLogRows, recordPdfLogRow } from "./submittalLogService";
import { loadTransmittalContentAutoOn } from "./transmittalCategories";
import { queuePendingItem } from "./transmittalHelpers";
import {
  sdsPacketFilenameSpecSection,
  sdsPacketSpecSectionsLabel,
} from "./sdsSectionModel";
import type { ProjectTradeData, SdsPacketData } from "../types/tradeDocuments";
import { defaultTransmittal } from "../types/tradeDocuments";

function packetSpecForIntegrations(packet: SdsPacketData): string {
  return sdsPacketSpecSectionsLabel(packet.sections);
}

function packetSpecForLogParse(packet: SdsPacketData): string {
  // Single CSI parses cleanly; multiple → blank codes, full label in notes/section text.
  return sdsPacketFilenameSpecSection(packet.sections);
}

const SDS_LOG_SCOPE = "Product Data";

export async function appendSdsPacketSubmittalRow(
  projectId: string,
  packet: SdsPacketData,
): Promise<{ line_number: string; id: string; created: boolean } | null> {
  const label = packetSpecForIntegrations(packet);
  const parseSource = packetSpecForLogParse(packet);
  const { spec, section } = parseSpecSectionForLog(parseSource);
  const tradeNumber = String(packet.submittal_number);
  const existing = await loadSubmittalLogRows(projectId);
  const already = existing.some(
    (row) =>
      row.trade_submittal_number.trim() === tradeNumber && row.scope === SDS_LOG_SCOPE && !row.revises_line,
  );
  const row = await recordPdfLogRow(projectId, {
    submittal_type: logSubmittalTypeForPacket(packet.packet_type),
    scope: SDS_LOG_SCOPE,
    spec,
    section: section || label,
    notes: sdsSubmittalDescription(label, packet.packet_type),
    trade_submittal_number: tradeNumber,
    status: "Ready",
  });
  return { line_number: row.line_number, id: row.id, created: !already };
}

export async function queueSdsForTransmittal(
  tradeData: ProjectTradeData,
  packet: SdsPacketData,
  outputFilename: string,
  logRowId?: string,
  userId?: string | null,
): Promise<ProjectTradeData> {
  const label = packetSpecForIntegrations(packet);
  const parseSource = packetSpecForLogParse(packet);
  const { spec, section } = parseSpecSectionForLog(parseSource);
  const transmittal = tradeData.transmittal ?? defaultTransmittal();
  const autoOn = await loadTransmittalContentAutoOn(userId);
  const nextTransmittal = queuePendingItem(
    transmittal,
    {
      submittal_type: logSubmittalTypeForPacket(packet.packet_type),
      scope: "",
      spec,
      section: section || label,
      spec_section: label,
      packet_type: packet.packet_type,
      linked_files: outputFilename ? [outputFilename] : [],
      notes: sdsSubmittalDescription(label, packet.packet_type),
      source: "sds_packet",
      trade_submittal_number: String(packet.submittal_number),
      log_row_id: logRowId ?? "",
    },
    autoOn,
  );
  return {
    ...tradeData,
    transmittal: { ...nextTransmittal, contract: packet.contract ?? "paint" },
  };
}

/** @deprecated Use queueSdsForTransmittal — kept for callers that add directly to enclosures */
export async function mergeSdsIntoTransmittal(
  tradeData: ProjectTradeData,
  packet: SdsPacketData,
  outputFilename: string,
  userId?: string | null,
): Promise<ProjectTradeData> {
  return queueSdsForTransmittal(tradeData, packet, outputFilename, undefined, userId);
}
