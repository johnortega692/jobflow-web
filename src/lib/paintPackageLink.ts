import { formatRevisionTag, formatSubmittalNumberDisplay } from "./printCore";
import { sectionHasAnyAttachment } from "./sdsSectionModel";
import type { PaintItem, SdsSection } from "../types/tradeDocuments";

type ScheduleMark = {
  label: string;
  color: string;
  location: string;
};

export type PaintPackageGroup = {
  key: string;
  manufacturer: string;
  product: string;
  sheen: string;
  specSection: string;
  marks: ScheduleMark[];
};

export type PaintPackageMerge = {
  sections: SdsSection[];
  added: number;
  updated: number;
};

export type PaintPackageGaps = {
  /** Products on the color schedule with no matching package section. */
  scheduleOnly: string[];
  /** Paint package sections that are not on the color schedule. */
  packageOnly: string[];
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

const MANUFACTURER_ALIASES: Record<string, string> = {
  de: "de",
  "dunn edwards": "de",
  "dunn-edwards": "de",
  sw: "sw",
  "sherwin williams": "sw",
  "sherwin-williams": "sw",
  ppg: "ppg",
  bm: "bm",
  "benjamin moore": "bm",
  behr: "behr",
  vista: "vista",
};

function manufacturerKey(value: string): string {
  const key = norm(value);
  return MANUFACTURER_ALIASES[key] ?? key;
}

/** Same product and sheen. Dunn Edwards and DE count as one manufacturer. Spec does not. */
export function samePaintPackageProduct(
  left: { manufacturer: string; product: string; sheen: string },
  right: { manufacturer: string; product: string; sheen: string },
): boolean {
  if (norm(left.product) !== norm(right.product) || norm(left.sheen) !== norm(right.sheen)) return false;
  const a = manufacturerKey(left.manufacturer);
  const b = manufacturerKey(right.manufacturer);
  if (!a || !b) return true;
  return a === b;
}

export function paintProductKey(manufacturer: string, product: string, sheen: string): string {
  return [manufacturerKey(manufacturer), norm(product), norm(sheen)].join("|");
}

function productLabel(product: string, manufacturer: string, sheen: string): string {
  const name = product.trim() || manufacturer.trim() || "Product";
  const finish = sheen.trim();
  return finish ? `${name} · ${finish}` : name;
}

function scheduleLine(mark: ScheduleMark): string {
  const head = [mark.label.trim(), mark.color.trim()].filter(Boolean).join(" ");
  const location = mark.location.trim();
  if (head && location) return `${head} — ${location}`;
  return head || location;
}

/** Color column: each mark and color. Notes stay the sheet list. */
export function paintPackageUseField(group: PaintPackageGroup): string {
  return group.marks.map(scheduleLine).filter(Boolean).join("; ");
}

export function groupPaintItemsForPackage(
  items: PaintItem[],
  specForItem: (item: PaintItem) => string,
): PaintPackageGroup[] {
  const groups: PaintPackageGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    if (!item.product.trim() && !item.manufacturer.trim()) continue;
    const specSection = specForItem(item).trim();
    const key = `${paintProductKey(item.manufacturer, item.product, item.sheen)}|${norm(specSection)}`;
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByKey.set(key, index);
      groups.push({
        key,
        manufacturer: item.manufacturer.trim(),
        product: item.product.trim(),
        sheen: item.sheen.trim(),
        specSection,
        marks: [],
      });
    }
    groups[index]!.marks.push({
      label: item.label.trim(),
      color: item.color.trim(),
      location: item.floor.trim(),
    });
  }

  return groups;
}

export function paintPackageSectionsFromGroups(groups: PaintPackageGroup[]): SdsSection[] {
  return groups.map((group) => ({
    id: crypto.randomUUID(),
    category: "Paint" as const,
    spec_section: group.specSection,
    manufacturer: group.manufacturer,
    product: group.product,
    finish_type: group.sheen,
    system_material: /exterior/i.test(group.specSection) ? "Exterior Paint" : "Interior Paint",
    color: paintPackageUseField(group),
    intended_use: "",
    attachments: {},
  }));
}

function sectionProduct(section: SdsSection): { manufacturer: string; product: string; sheen: string } {
  return {
    manufacturer: section.manufacturer,
    product: section.product,
    sheen: section.finish_type,
  };
}

/**
 * Refresh marks, colors, and locations on the existing product row.
 * A row that already has sheets wins over an empty duplicate. A new product is appended.
 */
export function mergePaintPackageSections(existing: SdsSection[], imported: SdsSection[]): PaintPackageMerge {
  const sections = existing.map((section) => ({ ...section, attachments: { ...section.attachments } }));
  const used = new Set<string>();
  const drop = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const row of imported) {
    const incoming = sectionProduct(row);
    const matches = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => !used.has(section.id) && samePaintPackageProduct(sectionProduct(section), incoming));
    matches.sort((a, b) => Number(sectionHasAnyAttachment(b.section)) - Number(sectionHasAnyAttachment(a.section)));
    const chosen = matches[0];
    if (!chosen) {
      sections.push(row);
      used.add(row.id);
      added += 1;
      continue;
    }
    const current = chosen.section;
    used.add(current.id);
    sections[chosen.index] = {
      ...current,
      color: row.color,
      intended_use: "",
      spec_section: current.spec_section.trim() || row.spec_section,
      system_material: current.system_material.trim() || row.system_material,
    };
    updated += 1;
    for (const extra of matches.slice(1)) {
      if (!sectionHasAnyAttachment(extra.section)) drop.add(extra.section.id);
      used.add(extra.section.id);
    }
  }

  return {
    sections: sections.filter((section) => !drop.has(section.id)),
    added,
    updated,
  };
}

export function suggestPaintPackageTargets(
  groups: PaintPackageGroup[],
  sections: SdsSection[],
): Record<string, string | null> {
  const taken = new Set<string>();
  const targets: Record<string, string | null> = {};
  for (const group of groups) {
    const matches = sections.filter(
      (section) => !taken.has(section.id) && sectionMatchesGroup(section, group),
    );
    matches.sort(
      (a, b) => Number(sectionHasAnyAttachment(b)) - Number(sectionHasAnyAttachment(a)),
    );
    const id = matches[0]?.id ?? null;
    targets[group.key] = id;
    if (id) taken.add(id);
  }
  return targets;
}

/**
 * Put each schedule product on the section the user picked.
 * Sheets on that section stay. A blank target adds a new section.
 */
export function applyPaintPackageChoices(
  existing: SdsSection[],
  groups: PaintPackageGroup[],
  targets: Record<string, string | null>,
): PaintPackageMerge {
  const sections = existing.map((section) => ({ ...section, attachments: { ...section.attachments } }));
  const used = new Set<string>();
  let added = 0;
  let updated = 0;
  const built = new Map(paintPackageSectionsFromGroups(groups).map((section, index) => [groups[index]!.key, section]));

  for (const group of groups) {
    const row = built.get(group.key);
    if (!row) continue;
    const targetId = targets[group.key] ?? null;
    const index = targetId ? sections.findIndex((section) => section.id === targetId) : -1;
    if (index === -1 || (targetId && used.has(targetId))) {
      sections.push(row);
      added += 1;
      continue;
    }
    used.add(targetId!);
    const current = sections[index]!;
    sections[index] = {
      ...current,
      product: row.product || current.product,
      manufacturer: current.manufacturer.trim() || row.manufacturer,
      finish_type: row.finish_type || current.finish_type,
      color: row.color,
      intended_use: row.intended_use,
      spec_section: current.spec_section.trim() || row.spec_section,
      system_material: current.system_material.trim() || row.system_material,
    };
    updated += 1;
  }

  return { sections, added, updated };
}

export function paintPackageImportSummary(added: number, updated: number): string {
  const addedLabel = `${added} product${added === 1 ? "" : "s"}`;
  const updatedLabel = `${updated} product${updated === 1 ? "" : "s"}`;
  if (added && updated) {
    return `Added ${addedLabel} and refreshed ${updatedLabel} from the color schedule. Attachments were left in place.`;
  }
  if (added) return `Added ${addedLabel} from the color schedule.`;
  if (updated) return `Refreshed marks and colors on ${updatedLabel}. Attachments were left in place.`;
  return "Color schedule already matches this package.";
}

function sectionMatchesGroup(section: SdsSection, group: PaintPackageGroup): boolean {
  return samePaintPackageProduct(sectionProduct(section), {
    manufacturer: group.manufacturer,
    product: group.product,
    sheen: group.sheen,
  });
}

export function paintPackageGaps(groups: PaintPackageGroup[], sections: SdsSection[]): PaintPackageGaps {
  const used = new Set<string>();
  const scheduleOnly: string[] = [];

  for (const group of groups) {
    const match = sections.find((section) => !used.has(section.id) && sectionMatchesGroup(section, group));
    if (!match) {
      scheduleOnly.push(productLabel(group.product, group.manufacturer, group.sheen));
      continue;
    }
    used.add(match.id);
  }

  const packageOnly = sections
    .filter((section) => section.category === "Paint")
    .filter((section) => section.product.trim() || section.manufacturer.trim())
    .filter((section) => !groups.some((group) => sectionMatchesGroup(section, group)))
    .map((section) => productLabel(section.product, section.manufacturer, section.finish_type));

  return { scheduleOnly, packageOnly };
}

function bulletList(title: string, items: string[]): string {
  if (!items.length) return "";
  return `${title}\n${items.map((item) => `• ${item}`).join("\n")}`;
}

export function paintSchedulePackageWarning(
  gaps: PaintPackageGaps,
  packageNumber: number,
  packageHasSections: boolean,
): string {
  if (!gaps.scheduleOnly.length && !gaps.packageOnly.length) return "";
  const where = packageHasSections
    ? `package #${formatSubmittalNumberDisplay(packageNumber)}`
    : "the product package";
  return [
    bulletList(`These products are on the color schedule and not in ${where}:`, gaps.scheduleOnly),
    bulletList("These package sections are not on the color schedule:", gaps.packageOnly),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function packageScheduleWarning(gaps: PaintPackageGaps, paintNumber: number): string {
  const number = formatSubmittalNumberDisplay(paintNumber);
  return [
    bulletList(`These products are on paint submittal #${number} and not in this package:`, gaps.scheduleOnly),
    bulletList("These package sections are not on the color schedule:", gaps.packageOnly),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function colorScheduleCoverValue(submittalNumber: number, revisionNumber: number): string {
  const number = `Submittal #${formatSubmittalNumberDisplay(submittalNumber)}`;
  const revision = formatRevisionTag(revisionNumber);
  return revision ? `${number} ${revision}` : number;
}

export function productPackagePdfNote(packageNumber: number): string {
  return `Product data: Package #${formatSubmittalNumberDisplay(packageNumber)}`;
}

export function paintPackageStatusLine(
  gaps: PaintPackageGaps,
  packageNumber: number,
  packageHasSections: boolean,
  scheduleHasProducts: boolean,
): { tone: "ok" | "warn"; text: string } | null {
  if (!scheduleHasProducts && !gaps.packageOnly.length) return null;
  if (!gaps.scheduleOnly.length && !gaps.packageOnly.length && packageHasSections) {
    return {
      tone: "ok",
      text: `Package #${formatSubmittalNumberDisplay(packageNumber)} includes every product on this schedule.`,
    };
  }
  const parts: string[] = [];
  if (gaps.scheduleOnly.length) {
    const where = packageHasSections
      ? `package #${formatSubmittalNumberDisplay(packageNumber)}`
      : "the product package";
    parts.push(`Not in ${where}: ${gaps.scheduleOnly.join(", ")}`);
  }
  if (gaps.packageOnly.length) {
    parts.push(`Package sections not on this schedule: ${gaps.packageOnly.join(", ")}`);
  }
  return { tone: "warn", text: parts.join(" · ") };
}
