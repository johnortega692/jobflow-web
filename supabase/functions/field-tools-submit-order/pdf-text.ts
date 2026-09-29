/** Wrap text to `maxWidth`. Every character is kept; a long word breaks mid-word instead of being clipped. */
export function wrapToWidth(text: string, maxWidth: number, widthOf: (value: string) => number): string[] {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return [];
  if (!(maxWidth > 0)) return [value];

  const lines: string[] = [];
  let rest = value;
  while (rest.length > 0) {
    if (widthOf(rest) <= maxWidth) {
      lines.push(rest);
      break;
    }

    let fit = 0;
    let lo = 1;
    let hi = rest.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (widthOf(rest.slice(0, mid)) <= maxWidth) {
        fit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (fit < 1) fit = 1;

    let breakAt = fit;
    const space = rest.slice(0, fit).lastIndexOf(" ");
    if (space > 0) breakAt = space;

    const line = rest.slice(0, breakAt).trimEnd();
    rest = rest.slice(breakAt).trimStart();
    if (line) lines.push(line);
    else if (rest.length === value.length) {
      lines.push(rest.slice(0, 1));
      rest = rest.slice(1);
    }
  }
  return lines;
}
