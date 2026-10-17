/** Company name without a trailing office tag, e.g. "BCCI Construction (Mountain View)" → "BCCI Construction". */
export function gcCompanyName(name: string): string {
  return name.trim().replace(/\s+\([^)]*\)\s*$/, "");
}
