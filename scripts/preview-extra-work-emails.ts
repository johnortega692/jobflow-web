import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRA_WORK_PRODUCTION_ORIGIN,
  buildSignRequestEmail,
  buildSignedEmail,
  extraWorkSignOrigin,
} from "../supabase/functions/extraWorkTagEmail.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "email-previews");
mkdirSync(dir, { recursive: true });

const longWork = `${"Paint the stairwell walls and patch the dents along the corridor. ".repeat(8)}<script>alert(1)</script>`;
const brand = { companyName: "Northline Builders" };

const sign = buildSignRequestEmail({
  ...brand,
  tagNumber: "001",
  jobNumber: "1151",
  jobName: "Crusoe 2nd Floor & <East>",
  tagDate: "2026-10-29",
  work: longWork,
  preparerName: "Luis G.",
  signUrl: `${EXTRA_WORK_PRODUCTION_ORIGIN}/sign-tag/abc123token`,
  expiresAt: "2026-11-02T07:59:00.000Z",
});

const signed = buildSignedEmail({
  ...brand,
  tagNumber: "001",
  jobNumber: "1151",
  jobName: "Crusoe 2nd Floor & <East>",
  tagDate: "2026-10-29",
  work: longWork,
  preparerName: "Luis G.",
  signerName: "Pat Lee",
  signedAt: "2026-10-29T14:42:00.000Z",
  filename: "1151 Extra Work Tag 001.pdf",
});

const problems: string[] = [];
function check(label: string, value: string) {
  if (/hours|materials/i.test(value)) problems.push(`${label} mentions hours or materials`);
  if (value.includes("<script>")) problems.push(`${label} did not escape HTML`);
  if (value.includes("Ironwood")) problems.push(`${label} hardcoded a company name`);
}

check("sign html", sign.html);
check("sign text", sign.text);
check("signed html", signed.html);
check("signed text", signed.text);

if (!sign.html.includes("Nov 1, 2026")) problems.push("expiry date was not Nov 1, 2026");
if (!signed.html.includes("Oct 29, 2026") || !signed.html.includes("7:42 AM")) problems.push("signed timestamp was not Oct 29, 2026 at 7:42 AM");
if (!sign.text.split("\n").includes(`${EXTRA_WORK_PRODUCTION_ORIGIN}/sign-tag/abc123token`)) problems.push("plain text link is not on its own line");
if (sign.html.includes(longWork)) problems.push("work description was not truncated");
if (!sign.html.includes("&lt;East&gt;")) problems.push("job name was not escaped");
if (extraWorkSignOrigin("http://localhost:5173", { supabaseUrl: "https://example.supabase.co" }) !== EXTRA_WORK_PRODUCTION_ORIGIN) {
  problems.push("localhost origin was used in production");
}
if (extraWorkSignOrigin("http://localhost:5173", { supabaseUrl: "http://127.0.0.1:54321" }) !== "http://localhost:5173") {
  problems.push("localhost origin was blocked in local dev");
}
if (extraWorkSignOrigin("https://evil.example", { publicUrl: "http://localhost:5173", supabaseUrl: "https://example.supabase.co" }) !== EXTRA_WORK_PRODUCTION_ORIGIN) {
  problems.push("configured localhost URL was used in production");
}

writeFileSync(join(dir, "sign-request.html"), sign.html);
writeFileSync(join(dir, "sign-request.txt"), sign.text);
writeFileSync(join(dir, "signed.html"), signed.html);
writeFileSync(join(dir, "signed.txt"), signed.text);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`Wrote previews to ${dir}`);
console.log(sign.subject);
console.log(signed.subject);
