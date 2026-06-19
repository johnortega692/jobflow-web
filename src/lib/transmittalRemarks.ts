export type TransmittalRemarkTemplate = {
  id: string;
  label: string;
  text: string;
  group: string;
};

/** Default for new transmittals — paint-focused wording. */
export const DEFAULT_TRANSMITTAL_REMARK =
  "Paint product data, technical data sheets, and safety data sheets are submitted for review and approval in accordance with project requirements.";

export const TRANSMITTAL_REMARK_TEMPLATES: TransmittalRemarkTemplate[] = [
  {
    id: "general-submittal",
    group: "General",
    label: "General Submittal",
    text: "Submitted for review and approval in accordance with the contract documents.",
  },
  {
    id: "product-data",
    group: "General",
    label: "Product Data",
    text: "Product data submitted for review and record purposes.",
  },
  {
    id: "sds-tds-package",
    group: "General",
    label: "SDS/TDS Package",
    text: "Safety Data Sheets and Technical Data Sheets submitted for review and project records.",
  },
  {
    id: "paint-submittal",
    group: "General",
    label: "Paint Submittal",
    text: "Paint product information submitted for review and approval prior to procurement and installation.",
  },
  {
    id: "wallcovering-submittal",
    group: "General",
    label: "Wallcovering Submittal",
    text: "Wallcovering product data, technical information, and samples submitted for review and approval.",
  },
  {
    id: "shop-drawings",
    group: "General",
    label: "Shop Drawings",
    text: "Shop drawings submitted for review and coordination with project requirements.",
  },
  {
    id: "resubmittal",
    group: "General",
    label: "Resubmittal",
    text: "Revised submittal submitted in response to previous review comments.",
  },
  {
    id: "closeout",
    group: "General",
    label: "Closeout Documents",
    text: "Closeout documentation submitted in accordance with project closeout requirements.",
  },
  {
    id: "material-samples",
    group: "General",
    label: "Material Samples",
    text: "Material samples submitted for review and color/finish selection.",
  },
  {
    id: "leed",
    group: "General",
    label: "LEED / Sustainability",
    text: "Sustainability documentation submitted for review and project compliance requirements.",
  },
  {
    id: "fireproofing",
    group: "General",
    label: "Fireproofing",
    text: "Fireproofing product data and supporting documentation submitted for review and approval.",
  },
  {
    id: "for-info",
    group: "General",
    label: "For Information Only",
    text: "Submitted for information and record purposes. No action required.",
  },
  {
    id: "for-approval",
    group: "General",
    label: "For Approval",
    text: "Submitted for review and approval. Procurement will proceed upon approval.",
  },
  {
    id: "deferred-approval",
    group: "General",
    label: "Deferred Approval",
    text: "Materials are subject to lead times. Prompt review is requested to avoid impacts to the project schedule.",
  },
  {
    id: "simple-professional",
    group: "General",
    label: "Simple Professional Version",
    text: "Please review the attached documents and advise if additional information is required.",
  },
  {
    id: "paint-default",
    group: "Paint division",
    label: "Paint — SDS/TDS & product data (recommended default)",
    text: DEFAULT_TRANSMITTAL_REMARK,
  },
  {
    id: "paint-sds-packet",
    group: "Paint division",
    label: "SDS/TDS Packet",
    text: "Attached are the SDS and TDS documents for the proposed paint products specified for this project.",
  },
  {
    id: "paint-wc-package",
    group: "Paint division",
    label: "Paint & Wallcovering Package",
    text: "Product data, technical data, and safety information for paint and wallcovering materials are submitted for review and approval.",
  },
  {
    id: "color-selection",
    group: "Paint division",
    label: "Color Selection",
    text: "Color and finish information submitted for review and confirmation prior to material ordering.",
  },
  {
    id: "substitution",
    group: "Paint division",
    label: "Substitution Request",
    text: "Proposed equivalent product submitted for review and consideration. Supporting documentation attached.",
  },
];

export function remarkTemplateGroups(): { group: string; templates: TransmittalRemarkTemplate[] }[] {
  const order = ["General", "Paint division"];
  const byGroup = new Map<string, TransmittalRemarkTemplate[]>();
  for (const t of TRANSMITTAL_REMARK_TEMPLATES) {
    const list = byGroup.get(t.group) ?? [];
    list.push(t);
    byGroup.set(t.group, list);
  }
  return order
    .filter((g) => byGroup.has(g))
    .map((group) => ({ group, templates: byGroup.get(group)! }));
}

export function remarkTextById(id: string): string | undefined {
  return TRANSMITTAL_REMARK_TEMPLATES.find((t) => t.id === id)?.text;
}
