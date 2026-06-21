/** Parse EWO / job numbers from OCR text — aligned with desktop work_order_app.py patterns. */

import { formatDateDisplay, parseFlexibleDate } from "./dateInputUtils";

function tryParseDateToken(token: string): string | null {
  const normalized = token.trim().replace(/\s+/g, " ").replace(/[.\-]/g, "/");

  const named = parseFlexibleDate(normalized);
  if (named) {
    const year = named.getFullYear();
    const now = new Date();
    if (year >= 1990 && year <= now.getFullYear() + 1) return formatDateDisplay(named);
  }

  const numeric = normalized
    .replace(/[|Il]/g, "1")
    .replace(/[oO]/g, "0");
  const d = parseFlexibleDate(numeric);
  if (!d) return null;

  const year = d.getFullYear();
  const now = new Date();
  if (year < 1990 || year > now.getFullYear() + 1) return null;
  return formatDateDisplay(d);
}

/** Extract the form header date (not labor-row dates lower on the page). */
export function parseEwoDateFromOcr(rawText: string): string | null {
  if (!rawText?.trim()) return null;
  const text = rawText.replace(/\r\n/g, "\n");

  const labeledPatterns = [
    /Date\s*[:#]?\s*(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4})/i,
    /Date\s*[:#]?\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4})/i,
    /EWO\s*Date\s*[:#]?\s*(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4})/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = tryParseDateToken(match[1]);
      if (parsed) return parsed;
    }
  }

  const header = text.slice(0, 1400);
  const inlinePattern = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g;
  for (const match of header.matchAll(inlinePattern)) {
    const parsed = tryParseDateToken(match[1]!);
    if (parsed) return parsed;
  }

  return null;
}

export function parseEwoDigitsFromOcr(rawText: string): string | null {
  if (!rawText?.trim()) return null;
  const s = rawText.trim();

  for (const pattern of [
    /(?:EXTRA\s*WORK\s*ORDER|EXTRAWORK\s*ORDER)\s*#?\s*(\d{4,6})/i,
    /ORDER\s*#\s*(\d{4,6})/i,
  ]) {
    const m = s.match(pattern);
    if (m) {
      const cand = m[1];
      if (cand.length >= 4 && !(cand.length === 4 && cand.startsWith("20"))) return cand;
    }
  }

  let stripped = s.replace(/\b\d{2}\s*-\s*[PDC]\s*\d{4}\b/gi, " ");
  stripped = stripped.replace(/\b[PDC]\s*\d{4}\b/gi, " ");

  const candidates = stripped.match(/\d{4,6}/g) ?? [];
  let best: string | null = null;
  for (const cand of candidates) {
    if (cand.length < 4) continue;
    if (cand.length === 4 && cand.startsWith("20")) continue;
    if (cand.length >= 5) return cand;
    if (!best || cand.length > best.length) best = cand;
  }
  return best;
}

export function normalizeJobOcrText(text: string): string {
  let s = text.replace(/§/g, "5").replace(/2§/g, "25");
  s = s.replace(/(\d+)-F(\d+)/gi, "$1-P$2");
  return s;
}

export function parseJobNumberFromOcr(rawText: string): string | null {
  if (!rawText?.trim()) return null;
  const text = normalizeJobOcrText(rawText);

  for (const pattern of [
    /C\s*&\s*D\s*Job\s*#\s*(\d{2}-[PDC]\d{4})/i,
    /CC\s*&\s*D\s*Job\s*#\s*(\d{2}-[PDC]\d{4})/i,
    /Job\s*#\s*(\d{2}-[PDC]\d{4})/i,
    /Job\s*Address.*?(\d{2}-[PDC]\d{4})/is,
    /C\s*&\s*D.*?(\d{2}-[PDC]\d{4})/i,
    /JobAddress.*?(\d{2}-[PDC]\d{4})/i,
    /(\d{2}-[PDC]\d{4})/i,
    /(\d{2}[-\s][PDC]\d{4})/i,
  ]) {
    const m = text.match(pattern);
    if (m) return m[1].replace(/\s+/g, "").toUpperCase();
  }

  const fallback = text.match(/(\d{2}-P\d{4})/i);
  return fallback ? fallback[1].toUpperCase() : null;
}

export function parseFormDataFromFullPageOcr(rawText: string): {
  ewo: string | null;
  job: string | null;
  date: string | null;
} {
  const normalized = normalizeJobOcrText(rawText);
  let ewo: string | null = null;

  for (const pattern of [
    /EXTRA\s*WORK\s*ORDER\s*#\s*(\d{4,6})/i,
    /EXTRAWORK\s*ORDER\s*#\s*(\d{4,6})/i,
    /EXTRA\s*WORK\s*ORDER\s*#?\s*(\d{4,6})/i,
    /EXTRAWORK\s*ORDER.*?(\d{4,6})/i,
    /EXTRA.*?WORK.*?ORDER.*?(\d{4,6})/i,
    /ORDER\s*#\s*(\d{4,6})/i,
    /(\d{4,6})/,
  ]) {
    const m = normalized.match(pattern);
    if (m) {
      const cand = m[1];
      if (cand.length >= 4 && !cand.startsWith("20")) {
        ewo = cand;
        break;
      }
    }
  }

  return {
    ewo,
    job: parseJobNumberFromOcr(normalized),
    date: parseEwoDateFromOcr(rawText),
  };
}
