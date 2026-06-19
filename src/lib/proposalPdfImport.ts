import { parseCityStateZipLine } from "./jobAddressUtils";
import { extractPdfPlainText } from "./pdfTextExtract";
import type { JobInfoData } from "../types/jobInfo";

export type ProposalImportPatch = {
  job_number?: string;
  job_name?: string;
  job_address?: string;
  contractor?: string;
  architect?: string;
  jobInfo: Partial<JobInfoData>;
};

export type ProposalImportResult = {
  patch: ProposalImportPatch;
  source: "ironwood" | "markers" | "po";
  filename: string;
};

type TextMarker = { start: string; end: string };

const DEFAULT_PDF_MARKERS: Record<string, TextMarker> = {
  job_name: { start: "Project:", end: "Address:" },
  job_address: { start: "Address:", end: "Scope:" },
  drawings: { start: "Scope:", end: "Architect:" },
  architect: { start: "Architect:", end: "Subject:" },
};

type IronwoodParsed = {
  gc_pm: string;
  gc_name: string;
  gc_street: string;
  gc_city_line: string;
  job_name: string;
  job_street: string;
  job_city_line: string;
  job_date: string;
  plan_date: string;
  gc_phone: string;
};

const SKIP_LABELS = new Set([
  "phone",
  "phone:",
  "base bid total",
  "plan date:",
  "proposal to:",
  "spec section names",
  "date:",
  "project:",
  "email:",
]);

const MONTH_DATE_RE =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i;

const MONTH_YEAR_RE =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;

/** pdf.js often merges markers onto one line; split them like desktop pypdf text. */
function normalizeProposalPdfText(fullText: string): string {
  let t = fullText.replace(/\r\n/g, "\n");
  const markers = [
    "Painting Bid Proposal",
    "Proposal To:",
    "Project:",
    "Address:",
    "Scope:",
    "Architect:",
    "Subject:",
    "Plan Date:",
    "Base Bid Total",
    "Spec Section Names",
  ];
  for (const marker of markers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`(?<!\\n)${escaped}`, "gi"), `\n${marker}`);
  }
  return t.replace(/\n{3,}/g, "\n\n");
}

function ironwoodFilterLines(rawLines: string[]): string[] {
  const out: string[] = [];
  for (const ln of rawLines) {
    const s = (ln ?? "").trim();
    if (!s || SKIP_LABELS.has(s.toLowerCase())) continue;
    if (s.startsWith("$")) continue;
    if (/^\d+ of \d+$/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

function ironwoodBlockLines(fullText: string, startMarker: string, endMarker: string): string[] {
  const si = fullText.indexOf(startMarker);
  if (si === -1) return [];
  const afterStart = fullText.indexOf("\n", si);
  if (afterStart === -1) return [];
  const ei = fullText.indexOf(endMarker, afterStart + 1);
  const chunk = ei !== -1 ? fullText.slice(afterStart + 1, ei) : fullText.slice(afterStart + 1);
  return ironwoodFilterLines(chunk.split(/\r?\n/));
}

function ironwoodRegionEnd(fullText: string, startPos: number): number {
  const ends: number[] = [];
  for (const marker of ["Painting Bid Proposal", "Proposal To:", "1 of 4", "Specific Items Included"]) {
    const j = fullText.indexOf(marker, startPos);
    if (j !== -1) ends.push(j);
  }
  return ends.length ? Math.min(...ends) : startPos + 2500;
}

function ironwoodIsNoiseLine(line: string): boolean {
  const s = (line ?? "").trim();
  if (!s) return true;
  const low = s.toLowerCase();
  if (low.includes("hereby propose") || low.includes("scope depicted") || low.includes("depicted and specified")) {
    return true;
  }
  if (s.includes("@") && s.includes(".")) return true;
  const noiseRes = [
    /^CA License\b/i,
    /^Union Contractor\b/i,
    /^WBE\/DBE\b/i,
    /^Base Bid Total\b/i,
    /^Spec Section\b/i,
    /^Alternate Pricing\b/i,
    /^Base Bid Pricing\b/i,
    /^Site Work\b/i,
    /^\d{5,6}\s*[-–]/,
    /^09\s*90\s*00\b/i,
    /^09900\b/i,
    /^099100\b/i,
    /^97200\b/i,
    /^n\/a$/i,
    /^n$/i,
  ];
  return noiseRes.some((p) => p.test(s));
}

function ironwoodExtractPhone(text: string): string {
  const dashed = text.match(/(\d{3}[-.\s]\d{3}[-.\s]\d{4})/);
  if (dashed) return dashed[1]!;
  const compact = text.match(/(?<=\D)(\d{3})(\d{3})(\d{4})(?=\D|$)/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return "";
}

function ironwoodSplitDateLines(lines: string[]): { rest: string[]; jobDate: string; planDate: string } {
  let jobDate = "";
  let planDate = "";
  const kept: string[] = [];
  for (const ln of lines) {
    if (MONTH_DATE_RE.test(ln)) {
      if (!jobDate) jobDate = ln;
      continue;
    }
    if (/^IFP\s+/i.test(ln)) {
      if (!planDate) planDate = ln;
      continue;
    }
    if (/^Issue For Permit\s+/i.test(ln)) {
      if (!planDate) planDate = ln;
      continue;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\/?$/.test(ln)) {
      if (!jobDate) jobDate = ln.replace(/\/$/, "");
      continue;
    }
    kept.push(ln);
  }
  return { rest: kept, jobDate, planDate };
}

function ironwoodCombineCityLines(parts: string[]): string {
  const cleaned = parts.map((p) => (p ?? "").trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length >= 2 && /^[A-Za-z]{2}\s+\d{5}(?:-\d{4})?\s*$/.test(cleaned[cleaned.length - 1]!)) {
    return cleaned.join(", ");
  }
  return cleaned.join(" ");
}

const STREET_SUFFIX_RE =
  /\b(st|street|blvd|boulevard|dr|drive|ave|avenue|way|ct|court|rd|road|ln|lane|hwy|highway|pkwy|parkway|pl|place)\b/i;

/** pdf.js often merges ``G Swanson 560 S Winchester Blvd`` onto one line. */
function ironwoodSplitNameAndStreet(line: string): { name: string; street: string } {
  const s = (line ?? "").trim();
  if (!s) return { name: "", street: "" };
  const m = s.match(/^(.+?)\s+(\d+\s+.+\S)$/);
  if (m && (STREET_SUFFIX_RE.test(m[2]!) || /^\d+\s+[NSEW]?\s*/i.test(m[2]!))) {
    return { name: m[1]!.trim(), street: m[2]!.trim() };
  }
  return { name: s, street: "" };
}

/** ``Milpitas, CA 95035 CA 95128`` → GC city line + job state/zip suffix. */
function ironwoodSplitDualCityZip(line: string): { primary: string; secondaryStateZip: string } {
  const s = (line ?? "").trim();
  if (!s) return { primary: "", secondaryStateZip: "" };
  const m = s.match(/^(.+?\b\d{5}(?:-\d{4})?)\s+([A-Za-z]{2}\s+\d{5}(?:-\d{4})?)\s*$/i);
  if (m) return { primary: m[1]!.trim(), secondaryStateZip: m[2]!.trim() };
  return { primary: s, secondaryStateZip: "" };
}

/** ``1658 Watson Ct, 2Nd Floor San Jose`` → GC street + trailing job city name. */
function ironwoodExtractTrailingCityFromStreet(streetLine: string): { street: string; cityName: string } {
  const s = (streetLine ?? "").trim();
  if (!s) return { street: "", cityName: "" };
  const m = s.match(/^(.+?),\s*(?:(\d+(?:st|nd|rd|th)\s+Floor)\s+)?([A-Za-z][A-Za-z\s]+)$/i);
  if (m) {
    const street = `${m[1]!}${m[2] ? `, ${m[2]}` : ""}`.trim();
    return { street, cityName: m[3]!.trim() };
  }
  return { street: s, cityName: "" };
}

function ironwoodParseDescribedBelowLayout(fullText: string): IronwoodParsed | null {
  const anchorM = /described below\.?/i.exec(fullText);
  if (!anchorM) return null;

  let bodyStart = fullText.indexOf("\n", anchorM.index + anchorM[0].length);
  if (bodyStart === -1) return null;
  bodyStart += 1;
  const bodyEnd = ironwoodRegionEnd(fullText, bodyStart);
  const bodyText = fullText.slice(bodyStart, bodyEnd);
  const allLines = ironwoodFilterLines(bodyText.split(/\r?\n/));
  if (allLines.length < 4) return null;
  if (ironwoodIsNoiseLine(allLines[0]!)) return null;

  const gc_pm = allLines[0]!;
  if (/plan date:/i.test(gc_pm) || /addendum:/i.test(gc_pm)) return null;
  const gc_name = allLines[1] ?? "";
  const gc_street = allLines[2] ?? "";
  const gc_city_line = allLines[3] ?? "";
  let rest = allLines.slice(4).filter((ln) => !ironwoodIsNoiseLine(ln));
  rest = rest.filter((ln) => !/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(ln));

  let { rest: restLines, jobDate, planDate } = ironwoodSplitDateLines(rest);

  let job_name = "";
  let job_street = "";
  let job_city_line = "";
  if (restLines.length >= 3) {
    job_name = restLines[0]!;
    job_street = restLines[1]!;
    job_city_line = ironwoodCombineCityLines(restLines.slice(2));
  } else if (restLines.length === 2) {
    job_name = restLines[0]!;
    job_street = restLines[1]!;
  } else if (restLines.length === 1) {
    job_name = restLines[0]!;
  }

  if (!job_name) {
    const bidPos = fullText.indexOf("Base Bid Total");
    const propPos = fullText.indexOf("Proposal To:");
    if (bidPos !== -1 && propPos !== -1 && propPos > bidPos) {
      let alt = ironwoodBlockLines(fullText, "Base Bid Total", "Proposal To:");
      alt = alt.filter((ln) => !ironwoodIsNoiseLine(ln));
      const split = ironwoodSplitDateLines(alt);
      if (!jobDate && split.jobDate) jobDate = split.jobDate;
      if (!planDate && split.planDate) planDate = split.planDate;
      if (split.rest.length >= 3) {
        job_name = split.rest[0]!;
        job_street = split.rest[1]!;
        job_city_line = ironwoodCombineCityLines(split.rest.slice(2));
      }
    }
  }

  if (!job_name) return null;

  return {
    gc_pm,
    gc_name,
    gc_street,
    gc_city_line,
    job_name,
    job_street,
    job_city_line,
    job_date: jobDate,
    plan_date: planDate,
    gc_phone: ironwoodExtractPhone(bodyText.slice(0, 800)),
  };
}

function extractMarkerLine(fullText: string, marker: string): string {
  const re = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([^\\n]+)`, "i");
  const m = re.exec(fullText);
  return m?.[1]?.trim() ?? "";
}

function ironwoodParseProposalToLayout(fullText: string): IronwoodParsed | null {
  if (!fullText.includes("Proposal To:")) return null;

  let chunk = fullText.split("Proposal To:", 2)[1] ?? "";
  for (const stop of ["Spec Section Names", "099000", "099100", "09 91 00", "Plan Date:", "1 of 4", "Base Bid Total"]) {
    const j = chunk.indexOf(stop);
    if (j !== -1) chunk = chunk.slice(0, j);
  }

  let lines = ironwoodFilterLines(chunk.split(/\r?\n/));
  lines = lines.filter((ln) => !ironwoodIsNoiseLine(ln));
  if (lines.length && /^Proposal To:\s*/i.test(lines[0]!)) {
    lines[0] = lines[0]!.replace(/^Proposal To:\s*/i, "").trim();
    if (!lines[0]) lines.shift();
  }
  if (lines.length < 3) return null;
  if (lines[0]!.includes("@")) return null;

  const gc_pm = lines[0]!;
  let idx = 1;
  let job_name = "";
  while (idx < lines.length && /^Project:/i.test(lines[idx]!)) {
    const m = /^Project:\s*(.+)$/i.exec(lines[idx]!);
    if (m) job_name = m[1]!.trim();
    idx++;
  }

  const nameStreetLine = lines[idx++] ?? "";
  const { name: gc_name, street: jobStreetFromGcLine } = ironwoodSplitNameAndStreet(nameStreetLine);

  let gc_street = lines[idx++] ?? "";
  let job_city_name = "";
  const streetCity = ironwoodExtractTrailingCityFromStreet(gc_street);
  gc_street = streetCity.street;
  job_city_name = streetCity.cityName;

  let gc_city_line = idx < lines.length ? (lines[idx++] ?? "") : "";
  const dualCity = ironwoodSplitDualCityZip(gc_city_line);
  gc_city_line = dualCity.primary;

  let job_street = jobStreetFromGcLine;
  let job_city_line = "";
  if (dualCity.secondaryStateZip) {
    job_city_line = job_city_name
      ? `${job_city_name}, ${dualCity.secondaryStateZip}`
      : dualCity.secondaryStateZip;
  } else if (job_city_name) {
    job_city_line = job_city_name;
  }

  let rest = lines.slice(idx);
  rest = rest.filter((ln) => !/^Project:/i.test(ln));
  let { rest: restLines, jobDate, planDate } = ironwoodSplitDateLines(rest);

  if (!job_name) job_name = extractMarkerLine(fullText, "Project:");
  if (!job_street) {
    job_street =
      extractFromMarkers(fullText, "Address:", "Scope:") ||
      extractMarkerLine(fullText, "Address:").replace(/^Address:\s*/i, "");
  }
  if (restLines.length >= 2) {
    if (!job_name) job_name = restLines[0]!;
    if (!job_street) {
      job_street = restLines[job_name && restLines[0] === job_name ? 1 : 0]!;
    }
    if (!job_city_line) {
      const cityStart = job_name && restLines[0] === job_name ? 2 : 1;
      job_city_line = ironwoodCombineCityLines(restLines.slice(cityStart));
    }
  } else if (restLines.length === 1 && !job_name) {
    job_name = restLines[0]!;
  }

  if (!job_name) return null;

  return {
    gc_pm,
    gc_name,
    gc_street,
    gc_city_line,
    job_name,
    job_street,
    job_city_line,
    job_date: jobDate,
    plan_date: planDate,
    gc_phone: ironwoodExtractPhone(chunk.slice(0, 600)),
  };
}

function ironwoodPreProposalBlockLooksValid(headerProj: {
  job_name: string;
  job_street: string;
  job_city_line: string;
}): boolean {
  const job_name = (headerProj.job_name ?? "").trim();
  const job_street = (headerProj.job_street ?? "").trim();
  const job_city_line = (headerProj.job_city_line ?? "").trim();
  if (!job_name || job_name.endsWith(":") || job_name.length < 3) return false;
  if (!job_street || !job_city_line) return false;
  const blob = `${job_name} ${job_street} ${job_city_line}`.toLowerCase();
  const bad = [
    "described below",
    "furnish all materials",
    "painting bid proposal",
    "specification sections",
    "bid memo",
    "base bid",
    "alternate pricing",
    "site work",
    "ca license",
    "addendum",
    "email:",
    "lath and plaster",
  ];
  if (bad.some((frag) => blob.includes(frag))) return false;
  if (/\badd\s*$/i.test(job_name)) return false;
  return true;
}

function ironwoodParsePreProposalToProject(fullText: string): {
  job_name: string;
  job_street: string;
  job_city_line: string;
} | null {
  const pos = fullText.indexOf("Proposal To:");
  if (pos === -1) return null;

  let lines = ironwoodFilterLines(fullText.slice(0, pos).split(/\r?\n/));
  lines = lines.filter((ln) => !ironwoodIsNoiseLine(ln));
  while (lines.length && /^.+:\s*$/.test(lines[lines.length - 1]!)) {
    lines.pop();
  }
  if (lines.length < 3) return null;

  let job_name: string;
  let job_street: string;
  let job_city_line: string;
  if (lines.length >= 4 && MONTH_YEAR_RE.test(lines[lines.length - 4]!)) {
    job_name = lines[lines.length - 3]!;
    job_street = lines[lines.length - 2]!;
    job_city_line = ironwoodCombineCityLines(lines.slice(-1));
  } else {
    job_name = lines[lines.length - 3]!;
    job_street = lines[lines.length - 2]!;
    job_city_line = ironwoodCombineCityLines(lines.slice(-1));
  }

  if (!job_name) return null;
  const headerProj = { job_name, job_street, job_city_line };
  if (!ironwoodPreProposalBlockLooksValid(headerProj)) return null;
  return headerProj;
}

function ironwoodParseBlocks(fullText: string): IronwoodParsed | null {
  let parsed = ironwoodParseDescribedBelowLayout(fullText);
  if (!parsed) parsed = ironwoodParseProposalToLayout(fullText);
  if (!parsed) return null;
  if (/ADD\s*\$/i.test(parsed.job_name) || /ADD\s*\$/i.test(parsed.job_street)) {
    parsed = ironwoodParseProposalToLayout(fullText);
  }
  if (!parsed) return null;

  const headerProj = ironwoodParsePreProposalToProject(fullText);
  const projectMarkerName = extractMarkerLine(fullText, "Project:");

  if (projectMarkerName) {
    parsed.job_name = projectMarkerName;
  } else if (headerProj) {
    parsed.job_name = headerProj.job_name;
    parsed.job_street = headerProj.job_street;
    parsed.job_city_line = headerProj.job_city_line;
  }

  if (!parsed.job_street && headerProj) {
    parsed.job_street = headerProj.job_street;
    if (!parsed.job_city_line) parsed.job_city_line = headerProj.job_city_line;
  }

  let job_date = parsed.job_date;
  let plan_date = parsed.plan_date;

  if (!job_date) {
    const hm = fullText
      .slice(0, 1200)
      .match(
        /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i,
      );
    if (hm) job_date = hm[1]!;
  }

  if (!plan_date) {
    for (const pat of [/Plan Date:\s*([^\n\r$]+)/i, /(Issue For Permit\s+[\d.]+(?:\/\d{2,4})?)/i, /(IFP\s+\d{1,2}\/\d{1,2}\/\d{4})/i]) {
      const pm = fullText.slice(0, 2000).match(pat);
      if (pm) {
        plan_date = pm[1]!.trim();
        if (/^\d+\s+of\s+\d+$/i.test(plan_date)) plan_date = "";
        else if (["n/a", "n", ""].includes(plan_date.toLowerCase())) plan_date = "";
        else break;
        plan_date = "";
      }
    }
  }

  parsed.job_date = job_date;
  parsed.plan_date = plan_date;
  return parsed;
}

function ironwoodBaseBidAmount(fullText: string): string {
  const anchor = fullText.indexOf("Base Bid Total");
  if (anchor === -1) return "";
  const window = fullText.slice(Math.max(0, anchor - 400), anchor + 120);
  const amounts = [...window.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)].map((m) => m[1]!);
  if (!amounts.length) return "";
  return amounts.reduce((a, b) =>
    parseFloat(a.replace(/,/g, "")) >= parseFloat(b.replace(/,/g, "")) ? a : b,
  ).replace(/,/g, "");
}

function extractFromMarkers(text: string, startMarker: string, endMarker: string): string {
  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) return "";
  const cursor = startIndex + startMarker.length;
  if (endMarker === "undefined") {
    return text.slice(cursor).trim().replace(/\s+/g, " ");
  }
  const endIndex = text.indexOf(endMarker, cursor);
  let extracted: string;
  if (endIndex === -1) {
    const nextLine = text.indexOf("\n", cursor);
    extracted = nextLine !== -1 ? text.slice(cursor, nextLine) : text.slice(cursor);
  } else {
    extracted = text.slice(cursor, endIndex);
  }
  return extracted.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, "").trim().replace(/\s+/g, " ");
}

function patchFromIronwood(parsed: IronwoodParsed, fullText: string): ProposalImportPatch {
  const gc_address = parsed.gc_street
    ? parsed.gc_city_line
      ? `${parsed.gc_street}, ${parsed.gc_city_line}`
      : parsed.gc_street
    : parsed.gc_city_line;

  const [city, zip, state] = parseCityStateZipLine(parsed.job_city_line);
  const jobInfo: Partial<JobInfoData> = {
    gc_pm: parsed.gc_pm,
    gc_address,
    gc_office_phone: parsed.gc_phone,
    job_date: parsed.job_date,
    job_city: city,
    job_zip: zip,
    job_county: state,
  };

  if (parsed.plan_date && !["n/a", ""].includes(parsed.plan_date.toLowerCase())) {
    jobInfo.drawings = parsed.plan_date;
  }

  const amt = ironwoodBaseBidAmount(fullText);
  if (amt) jobInfo.contract_amount = amt;

  return {
    job_name: parsed.job_name,
    job_address: parsed.job_street,
    contractor: parsed.gc_name,
    jobInfo,
  };
}

function patchFromMarkers(fullText: string, markers = DEFAULT_PDF_MARKERS): ProposalImportPatch | null {
  const job_name = extractFromMarkers(fullText, markers.job_name!.start, markers.job_name!.end);
  const job_address = extractFromMarkers(fullText, markers.job_address!.start, markers.job_address!.end);
  const drawings = extractFromMarkers(fullText, markers.drawings!.start, markers.drawings!.end);
  const architect = extractFromMarkers(fullText, markers.architect!.start, markers.architect!.end);

  if (!job_name) return null;

  return {
    job_name,
    job_address,
    architect,
    jobInfo: {
      drawings,
    },
  };
}

/** Try to read a PO / job number from filenames like ``Ironwood PO 25-0075-9900.pdf``. */
export function jobNumberFromProposalFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  const poM = base.match(/\bPO\s+([\d-]+(?:-\d+)?)\b/i);
  if (poM) return poM[1]!.trim();
  return "";
}

function tryImportIronwoodPo(fullText: string, filename: string): ProposalImportPatch | null {
  const reM = /RE:\s*([^\n]+)/i.exec(fullText);
  const contractM = /CONTRACT\s*#\s*([\d/-]+)/i.exec(fullText);
  const amountM = /TOTAL CONTRACT AMOUNT:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(fullText);
  if (!reM && !contractM) return null;

  const patch: ProposalImportPatch = { jobInfo: {} };
  if (reM) {
    const parts = reM[1]!
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      patch.job_name = parts[0]!;
      patch.job_address = parts[1]!;
    }
    if (parts.length >= 4) {
      const city = parts[parts.length - 2]!;
      const stateZip = parts[parts.length - 1]!;
      const [cityParsed, zip, state] = parseCityStateZipLine(`${city}, ${stateZip}`);
      patch.jobInfo.job_city = cityParsed || city;
      patch.jobInfo.job_zip = zip;
      patch.jobInfo.job_county = state;
    }
  }
  if (amountM) {
    patch.jobInfo.contract_amount = amountM[1]!.replace(/,/g, "");
  }
  const poNum = jobNumberFromProposalFilename(filename);
  if (poNum) patch.job_number = poNum;
  else if (contractM) {
    const raw = contractM[1]!.trim();
    patch.jobInfo.gc_job_number = raw;
    if (/^\d{6}\/\d{4}$/.test(raw.replace(/-/g, ""))) {
      patch.job_number = raw;
    }
  }

  if (!patch.job_name && !patch.job_number && !patch.jobInfo.contract_amount) return null;
  return patch;
}

function tryImportIronwoodPaintBidPdf(fullText: string): ProposalImportPatch | null {
  if (!fullText.includes("Painting Bid Proposal")) return null;
  const parsed = ironwoodParseBlocks(fullText);
  if (!parsed) return null;
  if (![parsed.gc_pm, parsed.gc_name, parsed.job_name, parsed.job_street].some((v) => v.trim())) {
    return null;
  }
  return patchFromIronwood(parsed, fullText);
}

export function importJobInfoFromProposalText(fullText: string, filename: string): ProposalImportResult {
  const text = normalizeProposalPdfText((fullText ?? "").trim());
  if (!text) {
    throw new Error("No text could be extracted from the PDF. Use a searchable (text-based) PDF, not a scan.");
  }

  const ironwood = tryImportIronwoodPaintBidPdf(text);
  if (ironwood) {
    const poNum = jobNumberFromProposalFilename(filename);
    if (poNum) ironwood.job_number = poNum;
    return { patch: ironwood, source: "ironwood", filename };
  }

  const po = tryImportIronwoodPo(text, filename);
  if (po) {
    return { patch: po, source: "po", filename };
  }

  const markers = patchFromMarkers(text);
  if (markers) {
    const poNum = jobNumberFromProposalFilename(filename);
    if (poNum) markers.job_number = poNum;
    return { patch: markers, source: "markers", filename };
  }

  throw new Error(
    "Could not map fields from this PDF layout. It may use a format that is not supported yet (Ironwood Paint Bid Proposal or Project:/Address:/Scope: markers).",
  );
}

export async function importJobInfoFromProposalPdf(file: File): Promise<ProposalImportResult> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a PDF proposal file.");
  }
  const text = await extractPdfPlainText(await file.arrayBuffer());
  return importJobInfoFromProposalText(text, file.name);
}

export function applyProposalImportPatch<T extends {
  job_number: string;
  job_name: string;
  job_address: string;
  contractor: string;
  architect: string;
  jobInfo: JobInfoData;
}>(project: T, result: ProposalImportResult): T {
  const { patch } = result;
  return {
    ...project,
    job_number: patch.job_number?.trim() || project.job_number,
    job_name: patch.job_name?.trim() || project.job_name,
    job_address: patch.job_address?.trim() || project.job_address,
    contractor: patch.contractor?.trim() || project.contractor,
    architect: patch.architect?.trim() || project.architect,
    jobInfo: {
      ...project.jobInfo,
      ...patch.jobInfo,
    },
  };
}
