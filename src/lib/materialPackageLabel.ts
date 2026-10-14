import type { LetterheadSettings } from "../types/letterheadSettings";
import type { WcTrackerLineState } from "../types/fieldTracker";
import { resolveSampleLabelLogo } from "./sampleLabelLogo";
import type { SampleLabelInput, SampleLabelOrientation } from "./sampleLabelContent";

export function ensurePackageShareToken(line: WcTrackerLineState): WcTrackerLineState {
  if (line.shareToken.trim()) return line;
  return { ...line, shareToken: crypto.randomUUID() };
}

export function materialPackageUrl(token: string, origin = window.location.origin): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/pkg/${encodeURIComponent(token.trim())}`;
}

/** "1 of 4" for the package at this position in the order. */
export function packageLabelMark(index: number, total: number): string {
  const count = Math.min(99, Math.max(1, Math.floor(total)));
  const place = Math.min(count, Math.max(1, Math.floor(index)));
  return `${place} of ${count}`;
}

/** Leading number in "4" or "4 rolls" is how many packages, and how many labels. Otherwise one. */
export function packageLabelCopies(packageQty: string): number {
  const match = packageQty.trim().match(/^(\d+)/);
  const count = match ? Number(match[1]) : 1;
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(99, Math.floor(count));
}

export function packageLabelInput(args: {
  letterhead: LetterheadSettings;
  line: WcTrackerLineState;
  jobNumber: string;
  jobName: string;
  qrUrl: string;
  orientation?: SampleLabelOrientation;
  /** Sheet labels use the color logo. Thermal labels use the black-and-white mark. */
  colorLogo?: boolean;
  /** "1 of 4" printed on the right of the black band. */
  packageMark?: string;
}): SampleLabelInput {
  const material = args.line.wallcoveringName.trim();
  const product = args.line.product.trim() || material;
  const project = [args.jobNumber.trim(), args.jobName.trim()].filter(Boolean).join(" ");
  return {
    logoUrl: args.colorLogo ? args.letterhead.logo_url.trim() : resolveSampleLabelLogo(args.letterhead).url,
    qrKind: "product",
    qrUrl: args.qrUrl,
    companyName: args.letterhead.company_name,
    itemLabel: args.line.label.trim(),
    manufacturer: args.line.manufacturer.trim(),
    product,
    color: args.line.color.trim(),
    project,
    submittal: "",
    date: "",
    spec: "",
    address: "",
    officeLine: "",
    orientation: args.orientation ?? "portrait",
    bandText: "MATERIAL",
    packageMark: args.packageMark?.trim() ?? "",
    blocks: {
      submittal: false,
      date: false,
      spec: false,
    },
  };
}
