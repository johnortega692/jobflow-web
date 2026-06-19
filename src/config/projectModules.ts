export type ProjectModule = {
  id: string;
  label: string;
  path: string;
  ready: boolean;
};

export const PROJECT_MODULES: ProjectModule[] = [
  { id: "overview", label: "Job Info", path: "", ready: true },
  { id: "rfis", label: "RFIs", path: "rfis", ready: true },
  { id: "submittals", label: "Submittal Log", path: "submittals", ready: true },
  { id: "transmittal", label: "Transmittal", path: "transmittal", ready: true },
  { id: "google-sheets", label: "Google Sheets", path: "google-sheets", ready: true },
  { id: "paint", label: "Paint", path: "paint", ready: true },
  { id: "wallcovering", label: "Wallcovering", path: "wallcovering", ready: true },
  { id: "frp", label: "FRP", path: "frp", ready: false },
  { id: "track", label: "Track", path: "track", ready: false },
  { id: "sds", label: "Submittal Package", path: "sds", ready: true },
  { id: "budget", label: "Budget", path: "budget", ready: true },
];
