import * as XLSX from "xlsx";
import { loadRawUserSettings, patchUserSettings } from "./budgetLibrary";
import {
  defaultContactDirectory,
  emptyArchitectEntry,
  emptyMaterialVendor,
  type ArchitectEntry,
  type ContactDirectorySettings,
  type MaterialVendor,
} from "../types/contactDirectory";

const VENDORS_KEY = "material_vendors";
const ARCHITECTS_KEY = "architects";

function normalizeCol(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function mapColumns(
  rows: Record<string, unknown>[],
  aliases: Record<string, string[]>,
): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]!);
  const byNorm = Object.fromEntries(headers.map((h) => [normalizeCol(h), h]));
  const rename: Record<string, string> = {};
  for (const [target, names] of Object.entries(aliases)) {
    for (const name of names) {
      const src = byNorm[normalizeCol(name)];
      if (src) {
        rename[src] = target;
        break;
      }
    }
  }
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [src, target] of Object.entries(rename)) {
      const v = row[src];
      out[target] = v == null || String(v).trim() === "" ? "" : String(v).trim();
    }
    for (const col of Object.values(rename)) {
      if (!(col in out)) out[col] = "";
    }
    return out;
  });
}

const VENDOR_ALIASES = {
  name: ["Name", "Contact", "Vendor", "Vendor Name"],
  email: ["Email", "E-mail", "Email Address", "Vendor Email"],
  phone: ["Phone", "Telephone", "Cell", "Mobile"],
  products: ["Products", "Product", "Company", "Manufacturer", "Product Lines"],
};

const ARCHITECT_ALIASES = {
  company: ["Company", "Name", "Architect", "Firm", "Company Name"],
  address: ["Address", "Addr", "Mailing Address", "Street Address"],
};

export async function parseSpreadsheetFile(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName]!;
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
}

function normalizeVendor(row: Record<string, string>): MaterialVendor | null {
  const name = row.name?.trim() ?? "";
  const email = row.email?.trim() ?? "";
  const products = row.products?.trim() ?? "";
  if (!name && !email && !products) return null;
  return {
    name,
    email,
    phone: row.phone?.trim() ?? "",
    products,
  };
}

function normalizeArchitect(row: Record<string, string>): ArchitectEntry | null {
  const company = row.company?.trim() ?? "";
  const address = row.address?.trim() ?? "";
  if (!company && !address) return null;
  return { company, address };
}

function vendorKey(v: MaterialVendor): string {
  return `${v.name.toLowerCase()}|${v.email.toLowerCase()}`;
}

function architectKey(a: ArchitectEntry): string {
  return a.company.toLowerCase();
}

export function parseMaterialVendorsFromRows(
  rows: Record<string, unknown>[],
): MaterialVendor[] {
  return mapColumns(rows, VENDOR_ALIASES)
    .map(normalizeVendor)
    .filter((v): v is MaterialVendor => v !== null);
}

export function parseArchitectsFromRows(rows: Record<string, unknown>[]): ArchitectEntry[] {
  return mapColumns(rows, ARCHITECT_ALIASES)
    .map(normalizeArchitect)
    .filter((a): a is ArchitectEntry => a !== null);
}

export function mergeMaterialVendors(
  existing: MaterialVendor[],
  imported: MaterialVendor[],
  mode: "merge" | "replace",
): MaterialVendor[] {
  if (mode === "replace") return dedupeMaterialVendors(imported);
  const seen = new Set(existing.map(vendorKey));
  const next = [...existing];
  for (const v of imported) {
    const key = vendorKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(v);
  }
  return next;
}

export function mergeArchitects(
  existing: ArchitectEntry[],
  imported: ArchitectEntry[],
  mode: "merge" | "replace",
): ArchitectEntry[] {
  if (mode === "replace") return dedupeArchitects(imported);
  const seen = new Set(existing.map(architectKey));
  const next = [...existing];
  for (const a of imported) {
    const key = architectKey(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(a);
  }
  return next;
}

function dedupeMaterialVendors(vendors: MaterialVendor[]): MaterialVendor[] {
  const seen = new Set<string>();
  const out: MaterialVendor[] = [];
  for (const v of vendors) {
    const key = vendorKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function dedupeArchitects(architects: ArchitectEntry[]): ArchitectEntry[] {
  const seen = new Set<string>();
  const out: ArchitectEntry[] = [];
  for (const a of architects) {
    const key = architectKey(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function searchMaterialVendors(
  vendors: MaterialVendor[],
  query: string,
): MaterialVendor[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return vendors.filter(
    (v) => v.name.toLowerCase().includes(q) || v.products.toLowerCase().includes(q),
  );
}

export function lookupArchitectAddress(
  architects: ArchitectEntry[],
  company: string,
): string | null {
  const q = company.trim().toLowerCase();
  if (!q) return null;
  const hit = architects.find((a) => a.company.trim().toLowerCase() === q);
  return hit?.address.trim() || null;
}

function coerceMaterialVendor(raw: unknown): MaterialVendor | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  const email = String(o.email ?? o.vendor_email ?? "").trim();
  const phone = String(o.phone ?? "").trim();
  const products = String(o.products ?? "").trim();
  if (!name && !email && !products) return null;
  return { name, email, phone, products };
}

function coerceArchitect(raw: unknown): ArchitectEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const company = String(o.company ?? o.name ?? "").trim();
  const address = String(o.address ?? "").trim();
  if (!company && !address) return null;
  return { company, address };
}

export function normalizeContactDirectory(raw: unknown): ContactDirectorySettings {
  const base = defaultContactDirectory();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const material_vendors = Array.isArray(o[VENDORS_KEY])
    ? dedupeMaterialVendors(
        (o[VENDORS_KEY] as unknown[])
          .map(coerceMaterialVendor)
          .filter((v): v is MaterialVendor => v !== null),
      )
    : [];
  const architects = Array.isArray(o[ARCHITECTS_KEY])
    ? dedupeArchitects(
        (o[ARCHITECTS_KEY] as unknown[])
          .map(coerceArchitect)
          .filter((a): a is ArchitectEntry => a !== null),
      )
    : [];
  return { material_vendors, architects };
}

export async function loadContactDirectory(userId: string): Promise<ContactDirectorySettings> {
  const raw = await loadRawUserSettings(userId);
  return normalizeContactDirectory({
    [VENDORS_KEY]: raw[VENDORS_KEY],
    [ARCHITECTS_KEY]: raw[ARCHITECTS_KEY],
  });
}

export async function saveContactDirectory(
  userId: string,
  data: ContactDirectorySettings,
): Promise<string | null> {
  return patchUserSettings(userId, {
    [VENDORS_KEY]: dedupeMaterialVendors(
      data.material_vendors.filter((v) => v.name.trim() || v.email.trim() || v.products.trim()),
    ),
    [ARCHITECTS_KEY]: dedupeArchitects(
      data.architects.filter((a) => a.company.trim() || a.address.trim()),
    ),
  });
}

export { emptyMaterialVendor, emptyArchitectEntry };
