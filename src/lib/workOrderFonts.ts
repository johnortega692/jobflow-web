import type { OverlaySection, WorkOrderOverlay } from "../types/workOrder";
import type { WorkOrderFontSettings } from "../types/workOrderSettings";

export function fontSizeForOverlay(
  section: OverlaySection,
  label: string,
  fonts: WorkOrderFontSettings,
): number {
  if (section === "material") return fonts.material;
  if (section === "labor") return fonts.labor;
  if (section === "total") {
    if (label === "Material Total 1") return fonts.material_total1;
    if (label === "Material Total 2") return fonts.material_total2;
    if (label === "Labor Total 2") return fonts.labor_total2;
    if (label === "Labor Total") return fonts.labor_total;
    if (label === "Grand Total") return fonts.grand_total;
    return fonts.grand_total;
  }
  return fonts.material;
}

export function applyFontSettingsToOverlays(
  overlays: WorkOrderOverlay[],
  fonts: WorkOrderFontSettings,
  color?: string,
): WorkOrderOverlay[] {
  return overlays.map((o) => ({
    ...o,
    font_size: fontSizeForOverlay(o.section, o.label, fonts),
    color: color ?? fonts.overlay_color,
  }));
}

export const FONT_SETTING_FIELDS: {
  key: keyof WorkOrderFontSettings;
  label: string;
  shortLabel: string;
}[] = [
  { key: "material", label: "Material lines", shortLabel: "Mat" },
  { key: "labor", label: "Labor lines", shortLabel: "Labor" },
  { key: "material_total1", label: "Material Total 1", shortLabel: "Mat T1" },
  { key: "material_total2", label: "Material Total 2", shortLabel: "Mat T2" },
  { key: "labor_total", label: "Labor Total", shortLabel: "Lab T1" },
  { key: "labor_total2", label: "Labor Total 2", shortLabel: "Lab T2" },
  { key: "grand_total", label: "Grand Total", shortLabel: "Grand" },
];
