import type { SampleLabelOrientation, SampleLabelPrintShow } from "./sampleLabelContent";

export const SAMPLE_LABEL_PRINT_KEY = "sample_label_print";

export type SampleLabelMedia = "niimbot" | "sheet";

export type SampleLabelPrintPrefs = SampleLabelPrintShow & {
  companyWebsiteUrl: string;
  orientation: SampleLabelOrientation;
  bandText: string;
  media: SampleLabelMedia;
};

export function defaultSampleLabelPrintPrefs(): SampleLabelPrintPrefs {
  return {
    logo: true,
    project: true,
    submittal: true,
    spec: true,
    date: true,
    addressPhone: true,
    license: true,
    companyWebsiteUrl: "",
    orientation: "portrait",
    bandText: "Wallcovering Sample",
    media: "niimbot",
  };
}

export function normalizeSampleLabelPrintPrefs(raw: unknown): SampleLabelPrintPrefs {
  const base = defaultSampleLabelPrintPrefs();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  const flag = (key: keyof SampleLabelPrintShow): boolean =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : base[key];
  return {
    logo: flag("logo"),
    project: flag("project"),
    submittal: flag("submittal"),
    spec: flag("spec"),
    date: flag("date"),
    addressPhone: flag("addressPhone"),
    license: flag("license"),
    companyWebsiteUrl: typeof record.companyWebsiteUrl === "string" ? record.companyWebsiteUrl.trim() : "",
    orientation: record.orientation === "landscape" ? "landscape" : "portrait",
    bandText: typeof record.bandText === "string" ? record.bandText : "Wallcovering Sample",
    media: record.media === "sheet" ? "sheet" : "niimbot",
  };
}
