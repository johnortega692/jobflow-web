import {
  effectivePaintPrimer,
  findCatalogPaintProduct,
  type PaintProduct,
} from "./paintCatalog";
import { paintItemIsPlaceholder } from "./paintItemLabels";
import { samePaintPackageProduct } from "./paintPackageLink";
import { sectionHasAttachment, sortSdsSectionsBySpec } from "./sdsSectionModel";
import {
  leadSpecSection,
  paintItemSpecScope,
  type PaintItem,
  type PaintPackageScheduleSnapshot,
  type PaintSubmittalData,
  type SdsSection,
} from "../types/tradeDocuments";

export type PaintSystemRow = {
  finishName: string;
  /** Second line under the finish: "over {primer}", "self-priming", or "No primer". */
  primerLine: string;
  sheen: string;
  items: string;
  labels: string[];
  manufacturer: string;
  primerName: string;
  primerId: string | null;
  selfPriming: boolean;
  specSection: string;
};

export type PaintScheduleProductRow = {
  product: string;
  /** "Primer for {finish}" or "Finish". */
  use: string;
  tds: boolean;
  sds: boolean;
  /** VOC in g/L, or blank when the catalog product has none. */
  voc: string;
  manufacturer: string;
};

export type PaintSystemSchedule = {
  specSection: string;
  systems: PaintSystemRow[];
  products: PaintScheduleProductRow[];
  /** Package sections in primer-then-finish order. Copies may carry the finish spec so a divider does not split the pair. */
  orderedSections: SdsSection[];
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function productVoc(products: PaintProduct[], name: string, manufacturer: string): string {
  return findCatalogPaintProduct(products, name, manufacturer)?.voc?.trim() ?? "";
}

function sectionMatchesProduct(section: SdsSection, name: string): boolean {
  return norm(section.product) === norm(name);
}

function hasKind(sections: SdsSection[], name: string, kind: "product_data" | "sds"): boolean {
  return sections.some((section) => sectionMatchesProduct(section, name) && sectionHasAttachment(section, kind));
}

type SystemDraft = {
  key: string;
  finishName: string;
  manufacturer: string;
  sheen: string;
  primerName: string;
  primerLine: string;
  specSection: string;
  labels: string[];
  primerId: string | null;
  selfPriming: boolean;
};

function matchFinishSection(sections: SdsSection[], system: SystemDraft, used: Set<string>): SdsSection | undefined {
  const target = {
    manufacturer: system.manufacturer,
    product: system.finishName,
    sheen: system.sheen,
  };
  return sections.find(
    (section) =>
      !used.has(section.id) &&
      samePaintPackageProduct(
        { manufacturer: section.manufacturer, product: section.product, sheen: section.finish_type },
        target,
      ),
  );
}

function matchPrimerSection(sections: SdsSection[], primerName: string, used: Set<string>): SdsSection | undefined {
  if (!primerName.trim()) return undefined;
  const matches = sections.filter((section) => !used.has(section.id) && sectionMatchesProduct(section, primerName));
  if (!matches.length) return undefined;
  return (
    matches.find((section) => !section.finish_type.trim() || /primer/i.test(section.finish_type)) ?? matches[0]
  );
}

/** Group finish items by product, effective primer, and sheen. An override is its own row. */
export function buildPaintSystemSchedule(
  items: PaintItem[],
  products: PaintProduct[],
  sections: SdsSection[],
  specSection: string,
): PaintSystemSchedule | null {
  const groups: SystemDraft[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    if (paintItemIsPlaceholder(item) || !item.product.trim()) continue;
    const effect = effectivePaintPrimer(item, products);
    if (effect.isPrimerProduct) continue;
    const primerKey = effect.overridden
      ? `override:${effect.selfPriming ? "none" : effect.primerId}`
      : effect.primerId
        ? `paired:${effect.primerId}`
        : effect.selfPriming
          ? "self"
          : "missing";
    const key = [norm(item.manufacturer), norm(item.product), primerKey, norm(item.sheen)].join("|");
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByKey.set(key, index);
      const primerLine = effect.primerName
        ? `over ${effect.primerName}`
        : effect.selfPriming
          ? "self-priming"
          : "No primer";
      groups.push({
        key,
        finishName: item.product.trim(),
        manufacturer: item.manufacturer.trim(),
        sheen: item.sheen.trim(),
        primerName: effect.primerName,
        primerLine,
        specSection: specSection.trim(),
        labels: [],
        primerId: effect.primerId,
        selfPriming: effect.selfPriming,
      });
    }
    const label = item.label.trim();
    if (label) groups[index]!.labels.push(label);
  }

  if (!groups.length) return null;

  const used = new Set<string>();
  const orderedSections: SdsSection[] = [];
  const take = (section: SdsSection | undefined, specOverride?: string) => {
    if (!section || used.has(section.id)) return;
    used.add(section.id);
    orderedSections.push(
      specOverride && specOverride !== section.spec_section ? { ...section, spec_section: specOverride } : section,
    );
  };

  type ListedProduct = {
    product: string;
    manufacturer: string;
    role: "primer" | "finish";
    finishes: string[];
  };
  const listed: ListedProduct[] = [];
  const listedIndex = new Map<string, number>();
  const listProduct = (name: string, manufacturer: string, role: "primer" | "finish", finishName: string) => {
    const key = norm(name);
    if (!key) return;
    const existing = listedIndex.get(key);
    if (existing === undefined) {
      listedIndex.set(key, listed.length);
      listed.push({
        product: name.trim(),
        manufacturer,
        role,
        finishes: role === "primer" && finishName ? [finishName] : [],
      });
      return;
    }
    const row = listed[existing]!;
    if (role === "primer" && finishName && !row.finishes.some((finish) => norm(finish) === norm(finishName))) {
      row.finishes.push(finishName);
    }
  };

  for (const system of groups) {
    const finishSection = matchFinishSection(sections, system, used);
    const spec = finishSection?.spec_section.trim() || system.specSection;
    if (system.primerName) {
      take(matchPrimerSection(sections, system.primerName, used), spec);
      listProduct(system.primerName, "", "primer", system.finishName);
    }
    take(finishSection, spec);
    listProduct(system.finishName, system.manufacturer, "finish", system.finishName);
  }
  for (const section of sortSdsSectionsBySpec(sections.filter((section) => !used.has(section.id)))) take(section);

  return {
    specSection: specSection.trim(),
    systems: groups.map((system) => ({
      finishName: system.finishName,
      primerLine: system.primerLine,
      sheen: system.sheen,
      items: system.labels.join(", "),
      labels: system.labels,
      manufacturer: system.manufacturer,
      primerName: system.primerName,
      primerId: system.primerId,
      selfPriming: system.selfPriming,
      specSection: system.specSection,
    })),
    products: listed.map((row) => ({
      product: row.product,
      use: row.role === "primer" ? `Primer for ${row.finishes.join(", ") || "finish"}` : "Finish",
      tds: hasKind(sections, row.product, "product_data"),
      sds: hasKind(sections, row.product, "sds"),
      voc: productVoc(products, row.product, row.manufacturer),
      manufacturer: row.manufacturer,
    })),
    orderedSections,
  };
}

export function countPaintItemsMissingPrimer(items: PaintItem[], products: PaintProduct[]): number {
  return items.filter((item) => effectivePaintPrimer(item, products).missing).length;
}

/** Spec sections actually used by the paint schedule, lead first. */
export function paintScheduleSpecLabel(paint: PaintSubmittalData): string {
  const lead = leadSpecSection(paint).trim();
  const secondary = paint.spec_sections?.[1]?.trim() ?? "";
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    labels.push(trimmed);
  };
  for (const item of paint.items) {
    if (paintItemIsPlaceholder(item) || !item.product.trim()) continue;
    push(paintItemSpecScope(item) === "secondary" && secondary ? secondary : lead);
  }
  if (!labels.length) push(lead);
  return labels.join("; ");
}

function orderSectionsById(sections: SdsSection[], ids: string[]): SdsSection[] {
  if (!ids.length) return sections;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ordered: SdsSection[] = [];
  const used = new Set<string>();
  for (const id of ids) {
    const section = byId.get(id);
    if (!section || used.has(id)) continue;
    used.add(id);
    ordered.push(section);
  }
  for (const section of sections) {
    if (!used.has(section.id)) ordered.push(section);
  }
  return ordered;
}

export function snapshotFromPaintSchedule(
  schedule: PaintSystemSchedule | null,
  sections: SdsSection[],
  specSection: string,
): PaintPackageScheduleSnapshot {
  return {
    spec_section: schedule?.specSection || specSection.trim(),
    rows: (schedule?.systems ?? []).map((system) => ({
      labels: system.labels,
      finish: system.finishName,
      manufacturer: system.manufacturer,
      sheen: system.sheen,
      primer_id: system.primerId,
      primer_name: system.primerName,
      self_priming: system.selfPriming,
    })),
    section_order: (schedule?.orderedSections ?? sections).map((section) => section.id),
    products: (schedule?.products ?? []).map((product) => ({
      product: product.product,
      use: product.use,
      tds: product.tds,
      sds: product.sds,
      voc: product.voc,
      manufacturer: product.manufacturer,
    })),
  };
}

/** Rebuild a schedule page from rows saved on a history snapshot. */
export function paintScheduleFromSnapshot(
  snapshot: PaintPackageScheduleSnapshot,
  sections: SdsSection[],
): PaintSystemSchedule {
  const orderedSections = orderSectionsById(sections, snapshot.section_order);
  return {
    specSection: snapshot.spec_section,
    systems: snapshot.rows.map((row) => ({
      finishName: row.finish,
      primerLine: row.primer_name
        ? `over ${row.primer_name}`
        : row.self_priming
          ? "self-priming"
          : "No primer",
      sheen: row.sheen,
      items: row.labels.join(", "),
      labels: row.labels,
      manufacturer: row.manufacturer,
      primerName: row.primer_name,
      primerId: row.primer_id,
      selfPriming: row.self_priming,
      specSection: snapshot.spec_section,
    })),
    products: snapshot.products.map((product) => ({ ...product })),
    orderedSections,
  };
}
