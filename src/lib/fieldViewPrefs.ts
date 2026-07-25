const MOBILE_KEY = "jobflow-field-mobile-view";
const DARK_KEY = "jobflow-field-dark-mode";

export function readFieldMobileView(): boolean {
  try {
    const stored = localStorage.getItem(MOBILE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(max-width: 1024px)").matches;
}

export function writeFieldMobileView(value: boolean): void {
  try {
    localStorage.setItem(MOBILE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export function readFieldDarkMode(): boolean {
  try {
    const stored = localStorage.getItem(DARK_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeFieldDarkMode(value: boolean): void {
  try {
    localStorage.setItem(DARK_KEY, String(value));
  } catch {
    /* ignore */
  }
}

const WORKLOAD_DARK_KEY = "jobflow-workload-dark-mode";

/** Workload-only theme; falls back to Field dark mode so it matches by default. */
export function readWorkloadDarkMode(): boolean {
  try {
    const stored = localStorage.getItem(WORKLOAD_DARK_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return readFieldDarkMode();
}

export function writeWorkloadDarkMode(value: boolean): void {
  try {
    localStorage.setItem(WORKLOAD_DARK_KEY, String(value));
  } catch {
    /* ignore */
  }
}
