import { logSubmittalTypeForPacket } from "./sdsPacketPresets";
import { sdsPacketLogScope } from "./sdsPacketHelpers";
import { parseSpecSectionForLog, sdsSubmittalDescription } from "./submittalLogHelpers";
import { recordPdfLogRow } from "./submittalLogService";
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

export async function appendSdsPacketSubmittalRow(
  projectId: string,
  packet: SdsPacketData,
): Promise<{ line_number: string; id: string } | null> {
  const label = packetSpecForIntegrations(packet);
  const parseSource = packetSpecForLogParse(packet);
  const { spec, section } = parseSpecSectionForLog(parseSource);
  const scope = sdsPacketLogScope(packet);
  const row = await recordPdfLogRow(projectId, {
    submittal_type: logSubmittalTypeForPacket(packet.packet_type),
    scope,
    spec,
    section: section || label,
    notes: sdsSubmittalDescription(label, packet.packet_type),
    status: "Ready",
  });
  return { line_number: row.line_number, id: row.id };
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
  const scope = sdsPacketLogScope(packet);
  const transmittal = tradeData.transmittal ?? defaultTransmittal();
  const autoOn = await loadTransmittalContentAutoOn(userId);
  const nextTransmittal = queuePendingItem(
    transmittal,
    {
      submittal_type: logSubmittalTypeForPacket(packet.packet_type),
      scope,
      spec,
      section: section || label,
      spec_section: label,
      packet_type: packet.packet_type,
      linked_files: outputFilename ? [outputFilename] : [],
      notes: sdsSubmittalDescription(label, packet.packet_type),
      source: "sds_packet",
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
