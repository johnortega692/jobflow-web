import { parseSpecSectionForLog } from "./submittalLogHelpers";
import type { SdsPacketData, SdsSectionCategory } from "../types/tradeDocuments";

const CATEGORY_TO_LOG_SCOPE: Partial<Record<SdsSectionCategory, string>> = {
  Paint: "Paint",
  Wallcovering: "Wallcovering",
  FRP: "FRP",
  "Acoustical Panels": "Ceiling",
  "Fabric Wrapped Panels": "Panels",
  Fireproofing: "Fireproofing",
  Sealants: "Sealants",
  Flooring: "Flooring",
  Ceiling: "Ceiling",
  "Misc Finish": "Finishes",
};

/** Derive submittal log scope from section categories, then spec section. */
export function sdsPacketLogScope(packet: SdsPacketData): string {
  const categories = [
    ...new Set(packet.sections.map((s) => s.category).filter(Boolean)),
  ] as SdsSectionCategory[];

  if (categories.length === 1) {
    return CATEGORY_TO_LOG_SCOPE[categories[0]!] ?? categories[0]!;
  }
  if (categories.length > 1) return "Finishes";

  return parseSpecSectionForLog(packet.spec_section).scope;
}
