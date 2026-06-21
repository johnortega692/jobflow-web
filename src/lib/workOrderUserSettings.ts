import { loadRawUserSettings, patchOrgSettings, patchUserSettings } from "./budgetLibrary";
import {
  DEFAULT_WORK_ORDER_LABOR_RATES,
  DEFAULT_WORK_ORDER_MATERIALS,
  WORK_ORDER_DISPLAY_KEY,
  WORK_ORDER_FONTS_KEY,
  WORK_ORDER_LABOR_RATES_KEY,
  WORK_ORDER_MATERIALS_KEY,
  WORK_ORDER_SCAN_BOXES_KEY,
  WORK_ORDER_TEXT_SPACING_KEY,
  WORK_ORDER_TOTAL_POSITIONS_KEY,
  defaultWorkOrderFontSettings,
  normalizeFontSettings,
  normalizeLaborRates,
  normalizeMaterialCatalog,
  type WorkOrderFontSettings,
  type WorkOrderLaborRateItem,
  type WorkOrderMaterialCatalogItem,
} from "../types/workOrderSettings";
import {
  DEFAULT_DISPLAY_PREFS,
  defaultWorkOrderScanBoxes,
  normalizeDisplayPrefs,
  normalizeScanBoxes,
  type WorkOrderDisplayPrefs,
  type WorkOrderScanBoxes,
} from "../types/workOrderScan";
import {
  defaultTotalPositions,
  normalizeTotalPositions,
  type WorkOrderTotalPositions,
} from "./workOrderTotalPositions";
import {
  normalizeTextSpacing,
  type WorkOrderTextSpacing,
} from "./workOrderOverlayLayout";

export type WorkOrderUserSettings = {
  materials: WorkOrderMaterialCatalogItem[];
  laborRates: WorkOrderLaborRateItem[];
  fonts: WorkOrderFontSettings;
  display: WorkOrderDisplayPrefs;
  scanBoxes: WorkOrderScanBoxes;
  totalPositions: WorkOrderTotalPositions;
  textSpacing: WorkOrderTextSpacing;
  usingCustomMaterials: boolean;
  usingCustomLaborRates: boolean;
  usingCustomTotalPositions: boolean;
};

export async function loadWorkOrderUserSettings(userId: string): Promise<WorkOrderUserSettings> {
  const raw = await loadRawUserSettings(userId);
  const usingCustomMaterials = Array.isArray(raw[WORK_ORDER_MATERIALS_KEY]);
  const usingCustomLaborRates = Array.isArray(raw[WORK_ORDER_LABOR_RATES_KEY]);
  const usingCustomTotalPositions = raw[WORK_ORDER_TOTAL_POSITIONS_KEY] != null;
  return {
    materials: normalizeMaterialCatalog(raw[WORK_ORDER_MATERIALS_KEY]),
    laborRates: normalizeLaborRates(raw[WORK_ORDER_LABOR_RATES_KEY]),
    fonts: normalizeFontSettings(raw[WORK_ORDER_FONTS_KEY]),
    display: normalizeDisplayPrefs(raw[WORK_ORDER_DISPLAY_KEY] ?? DEFAULT_DISPLAY_PREFS),
    scanBoxes: normalizeScanBoxes(raw[WORK_ORDER_SCAN_BOXES_KEY]),
    totalPositions: normalizeTotalPositions(raw[WORK_ORDER_TOTAL_POSITIONS_KEY]),
    textSpacing: normalizeTextSpacing(raw[WORK_ORDER_TEXT_SPACING_KEY]),
    usingCustomMaterials,
    usingCustomLaborRates,
    usingCustomTotalPositions,
  };
}

export async function saveWorkOrderMaterials(
  userId: string,
  materials: WorkOrderMaterialCatalogItem[],
): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_MATERIALS_KEY]: materials });
}

export async function saveWorkOrderLaborRates(
  userId: string,
  laborRates: WorkOrderLaborRateItem[],
): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_LABOR_RATES_KEY]: laborRates });
}

export async function saveWorkOrderFonts(
  userId: string,
  fonts: WorkOrderFontSettings,
): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_FONTS_KEY]: fonts });
}

export async function saveWorkOrderDisplayPrefs(
  userId: string,
  display: WorkOrderDisplayPrefs,
): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_DISPLAY_KEY]: display });
}

export async function saveWorkOrderScanBoxes(
  userId: string,
  scanBoxes: WorkOrderScanBoxes,
): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_SCAN_BOXES_KEY]: scanBoxes });
}

export async function saveWorkOrderTotalPositions(
  userId: string,
  totalPositions: WorkOrderTotalPositions,
): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_TOTAL_POSITIONS_KEY]: totalPositions });
}

export async function saveWorkOrderTextSpacing(
  userId: string,
  textSpacing: WorkOrderTextSpacing,
): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_TEXT_SPACING_KEY]: textSpacing });
}

export async function resetWorkOrderMaterials(userId: string): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_MATERIALS_KEY]: DEFAULT_WORK_ORDER_MATERIALS });
}

export async function resetWorkOrderLaborRates(userId: string): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_LABOR_RATES_KEY]: DEFAULT_WORK_ORDER_LABOR_RATES });
}

export async function resetWorkOrderFonts(userId: string): Promise<string | null> {
  return patchOrgSettings(userId, { [WORK_ORDER_FONTS_KEY]: defaultWorkOrderFontSettings() });
}

export async function resetWorkOrderDisplayPrefs(userId: string): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_DISPLAY_KEY]: DEFAULT_DISPLAY_PREFS });
}

export async function resetWorkOrderScanBoxes(userId: string): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_SCAN_BOXES_KEY]: defaultWorkOrderScanBoxes() });
}

export async function resetWorkOrderTotalPositions(userId: string): Promise<string | null> {
  return patchUserSettings(userId, { [WORK_ORDER_TOTAL_POSITIONS_KEY]: defaultTotalPositions() });
}
