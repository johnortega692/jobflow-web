/** Ordered consideration keys. Editor and PDF use this sequence. */
export const AHA_CONSIDERATIONS = [
  { key: "falls_elevation", label: "Falls from elevation" },
  { key: "line_breaking", label: "Line breaking" },
  { key: "rolling_scaffolds", label: "Rolling scaffolds" },
  { key: "confined_space", label: "Confined space(s)" },
  { key: "high_voltage", label: "High voltage work" },
  { key: "fixed_scaffolds", label: "Fixed scaffolds" },
  { key: "respiratory", label: "Respiratory protection" },
  { key: "work_permits", label: "Work permits" },
  { key: "aerial_lifts", label: "Aerial lifts" },
  { key: "excavation", label: "Excavating / trenching" },
  { key: "mep_issues", label: "MEP issues" },
  { key: "asbestos_lead", label: "Asbestos and/or lead" },
  { key: "public_exposure", label: "Public exposure" },
  { key: "cranes_rigging", label: "Cranes / rigging" },
  { key: "hazmat_waste", label: "Hazardous materials / waste" },
  { key: "hot_work", label: "Hot work" },
  { key: "energized_loto", label: "Energized systems / LOTO" },
  { key: "over_water", label: "Working over water" },
  { key: "underground_utilities", label: "Underground utilities" },
  { key: "health_hazards", label: "Health hazards" },
] as const;

export type AhaConsiderationKey = (typeof AHA_CONSIDERATIONS)[number]["key"];

const CONSIDERATION_KEYS = new Set<string>(AHA_CONSIDERATIONS.map((item) => item.key));

export function isAhaConsiderationKey(value: string): value is AhaConsiderationKey {
  return CONSIDERATION_KEYS.has(value);
}

/** Keep known keys, in the standard order. */
export function orderConsiderations(keys: readonly string[]): AhaConsiderationKey[] {
  const present = new Set(keys.filter(isAhaConsiderationKey));
  return AHA_CONSIDERATIONS.map((item) => item.key).filter((key) => present.has(key));
}
