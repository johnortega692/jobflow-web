export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Letterhead line under logo: address | Office: phone | License #… */
export function buildCompanyContactLine(
  address: string,
  phone: string,
  license: string,
): string {
  const parts: string[] = [];
  const addr = address.trim();
  const ph = phone.trim();
  const lic = license.trim();
  if (addr) parts.push(addr);
  if (ph) parts.push(/^office\s*:/i.test(ph) ? ph : `Office: ${ph}`);
  if (lic) {
    if (/^license\s*#/i.test(lic)) parts.push(lic);
    else if (/^license/i.test(lic)) parts.push(lic);
    else parts.push(`License #${lic.replace(/^#/, "")}`);
  }
  return parts.join(" | ");
}

/** Settings → letterhead line (single row: address | phone | license). */
export function companyLetterheadLine(branding: PrintBranding): string {
  return (branding.companyContactLine || branding.companyInfo).trim();
}

export function cb(checked: boolean): string {
  return `<span class="cb${checked ? " checked" : ""}"></span>`;
}

export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px;top:0;";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    frame.remove();
    throw new Error("Could not open print view. Try Chrome or Edge.");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const runPrint = () => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 1500);
  };
  if (doc.readyState === "complete") window.setTimeout(runPrint, 150);
  else frame.onload = () => window.setTimeout(runPrint, 150);
}

export const FLOOR_ORDER = ["1st Floor", "2nd Floor", "3rd Floor", "All Floors", ""] as const;

export function groupByFloor<T extends { floor?: string }>(
  items: T[],
  floorOrder: readonly string[] = FLOOR_ORDER,
): [string, T[]][] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const floor = (item.floor ?? "").trim();
    if (!buckets.has(floor)) buckets.set(floor, []);
    buckets.get(floor)!.push(item);
  }
  const ordered: [string, T[]][] = [];
  for (const floor of floorOrder) {
    const list = buckets.get(floor);
    if (list?.length) ordered.push([floor, list]);
    buckets.delete(floor);
  }
  for (const [floor, list] of buckets) {
    if (list.length) ordered.push([floor, list]);
  }
  return ordered;
}

export function formatLongDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatShortDate(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

export type PrintBranding = {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyLicense: string;
  companyInfo: string;
  companyContactLine: string;
  logoUrl: string;
  logoAlt: string;
  footerName: string;
  footerPhone: string;
  footerEmail: string;
  fromBlock: string;
  fromPhone: string;
  signerName: string;
  signerTitle: string;
  signerPhone: string;
  signerEmail: string;
};

/** @deprecated Use resolvePrintBranding() from letterheadSettings.ts */
export function getPrintBranding(): PrintBranding {
  const name = import.meta.env.VITE_COMPANY_NAME?.trim() || "Plan B Apps";
  const addr = import.meta.env.VITE_COMPANY_ADDRESS?.trim() || "";
  const phone = import.meta.env.VITE_COMPANY_PHONE?.trim() || "";
  const license = import.meta.env.VITE_COMPANY_LICENSE?.trim() || "";
  const email = import.meta.env.VITE_SIGNER_EMAIL?.trim() || "";
  const signer = import.meta.env.VITE_SIGNER_NAME?.trim() || name;
  const logoUrl = import.meta.env.VITE_LOGO_URL?.trim() || "";
  const companyContactLine = buildCompanyContactLine(addr, phone, license);
  const fromBlock = [name, addr].filter(Boolean).join("\n");
  return {
    companyName: name,
    companyAddress: addr,
    companyPhone: phone,
    companyLicense: license,
    companyInfo: companyContactLine,
    companyContactLine,
    logoUrl,
    logoAlt: name,
    footerName: signer,
    footerPhone: phone,
    footerEmail: email,
    fromBlock,
    fromPhone: phone,
    signerName: signer,
    signerTitle: "",
    signerPhone: phone,
    signerEmail: email,
  };
}

export function logoBlock(branding: PrintBranding, fallbackText?: string): string {
  if (branding.logoUrl) {
    return `<img src="${esc(branding.logoUrl)}" alt="${esc(branding.logoAlt)}">`;
  }
  const text = esc(fallbackText || branding.logoAlt).replace(/\n/g, "<br>");
  return `<div class="logo-text">${text}</div>`;
}
