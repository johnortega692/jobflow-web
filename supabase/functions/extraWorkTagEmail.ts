/** Extra-work tag emails. No hours or materials. */

export const EXTRA_WORK_EMAIL_TIME_ZONE = "America/Los_Angeles";
export const EXTRA_WORK_PRODUCTION_ORIGIN = "https://fieldtools.ortegabuilt.com";

const FONT = "Arial, Helvetica, sans-serif";

export type ExtraWorkEmailBrand = {
  companyName: string;
};

export type SignRequestEmailInput = ExtraWorkEmailBrand & {
  tagNumber: string;
  jobNumber: string;
  jobName: string;
  tagDate: string;
  work: string;
  preparerName: string;
  signUrl: string;
  expiresAt: string;
};

export type SignedEmailInput = ExtraWorkEmailBrand & {
  tagNumber: string;
  jobNumber: string;
  jobName: string;
  tagDate: string;
  work: string;
  preparerName: string;
  signerName: string;
  signedAt: string;
  filename: string;
  refused?: boolean;
};

export function companyNameFromSettings(settings: Record<string, unknown> | null | undefined, envName = ""): string {
  const fromSettings = String(settings?.company_name ?? "").trim();
  if (fromSettings) return fromSettings;
  return envName.trim();
}

/** Public Field Tools origin. Localhost is allowed only while Supabase itself is local. */
export function extraWorkSignOrigin(requestOrigin: string, env: { publicUrl?: string; supabaseUrl?: string }): string {
  const configured = String(env.publicUrl ?? "").trim().replace(/\/$/, "");
  const localRuntime = /localhost|127\.0\.0\.1/i.test(String(env.supabaseUrl ?? ""));
  const origin = requestOrigin.trim().replace(/\/$/, "");
  if (localRuntime && /^http:\/\/localhost:\d+$/.test(origin)) return origin;
  if (configured && !/localhost|127\.0\.0\.1|vercel\.app/i.test(configured)) return configured;
  return EXTRA_WORK_PRODUCTION_ORIGIN;
}

export function jobLabel(jobNumber: string, jobName: string): string {
  return [jobNumber.trim(), jobName.trim()].filter(Boolean).join(" — ");
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max = 200): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function clip(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function dateOnly(iso: string): string {
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function zonedParts(iso: string): { date: string; time: string } {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { date: "", time: "" };
  return {
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: EXTRA_WORK_EMAIL_TIME_ZONE,
    }).format(when),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: EXTRA_WORK_EMAIL_TIME_ZONE,
    }).format(when),
  };
}

function shell(input: { preheader: string; companyName: string; preparerName: string; body: string }): string {
  const company = input.companyName.trim();
  const preparer = input.preparerName.trim();
  const footer = [
    company ? `<div style="font-size:13px;line-height:1.4;color:#374151;">${esc(company)}</div>` : "",
    preparer ? `<div style="font-size:13px;line-height:1.4;color:#6B7280;margin-top:4px;">Sent by ${esc(preparer)}</div>` : "",
  ].join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
</head>
<body bgcolor="#F3F4F6" style="margin:0;padding:0;background:#F3F4F6;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F3F4F6;">${esc(clip(input.preheader, 90))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="background:#F3F4F6;margin:0;padding:0;">
  <tr>
    <td align="center" bgcolor="#F3F4F6" style="background:#F3F4F6;padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background:#FFFFFF;">
        <tr>
          <td bgcolor="#1F2A37" style="background:#1F2A37;padding:22px 24px;font-family:${FONT};">
            ${company ? `<div style="font-size:20px;line-height:1.3;font-weight:700;color:#FFFFFF;">${esc(company)}</div>` : ""}
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:28px 24px 8px;font-family:${FONT};color:#111827;">
            ${input.body}
          </td>
        </tr>
        <tr>
          <td bgcolor="#F8FAFC" style="background:#F8FAFC;padding:18px 24px 22px;font-family:${FONT};border-top:1px solid #E5E7EB;">
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function summaryRows(rows: { label: string; value: string }[]): string {
  const body = rows
    .filter((row) => row.value.trim())
    .map(
      (row) => `<tr>
        <td valign="top" width="108" bgcolor="#F8FAFC" style="width:108px;background:#F8FAFC;padding:10px 12px;font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;color:#6B7280;text-transform:uppercase;">${esc(row.label)}</td>
        <td valign="top" bgcolor="#F8FAFC" style="background:#F8FAFC;padding:10px 12px;font-family:${FONT};font-size:15px;line-height:1.4;color:#111827;word-break:break-word;overflow-wrap:anywhere;">${esc(row.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;margin:0 0 20px;">
    ${body}
  </table>`;
}

function signButton(url: string): string {
  const href = esc(url);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
    <tr>
      <td align="center" bgcolor="#0B63D8" style="background:#0B63D8;border-radius:8px;">
        <a href="${href}" style="display:block;padding:14px 18px;font-family:${FONT};font-size:16px;line-height:1.2;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">Review and sign</a>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.45;color:#4B5563;">Button not working? Copy this link:</p>
  <p style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:1.45;color:#1F2A37;word-break:break-all;">${href}</p>`;
}

export function buildSignRequestEmail(input: SignRequestEmailInput): { subject: string; html: string; text: string } {
  const job = jobLabel(input.jobNumber, input.jobName);
  const tag = input.tagNumber.trim();
  const work = truncate(input.work);
  const preparer = input.preparerName.trim();
  const when = dateOnly(input.tagDate);
  const expires = zonedParts(input.expiresAt).date;
  const intro = preparer
    ? `${preparer} has sent you an extra work tag to review and sign.`
    : "You have been sent an extra work tag to review and sign.";
  const expiryLine = `This link works once and expires on ${expires}. If you were not expecting this, reply to this email before signing.`;
  const subject = `Signature requested: Extra work tag ${tag}${job ? `, ${job}` : ""}`;
  const rows = [
    { label: "Job", value: job },
    { label: "Date", value: when },
    { label: "Work", value: work },
    ...(preparer ? [{ label: "Prepared", value: preparer }] : []),
  ];
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">Extra work tag ${esc(tag)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.45;color:#374151;">${esc(intro)}</p>
    ${summaryRows(rows)}
    ${signButton(input.signUrl)}
    <p style="margin:0 0 20px;font-size:13px;line-height:1.45;color:#4B5563;">${esc(expiryLine)}</p>`;
  const text = [
    input.companyName.trim(),
    "",
    `Extra work tag ${tag}`,
    "",
    intro,
    "",
    job ? `Job: ${job}` : "",
    when ? `Date: ${when}` : "",
    work ? `Work: ${work}` : "",
    preparer ? `Prepared: ${preparer}` : "",
    "",
    "Review and sign",
    input.signUrl,
    "",
    expiryLine,
    "",
    input.companyName.trim(),
    preparer ? `Sent by ${preparer}` : "",
  ]
    .filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n")
    .trim();
  return {
    subject,
    html: shell({
      preheader: clip(`Review and sign extra work tag ${tag}${job ? ` for ${job}` : ""}.`, 90),
      companyName: input.companyName,
      preparerName: preparer,
      body,
    }),
    text,
  };
}

export function buildSignedEmail(input: SignedEmailInput): { subject: string; html: string; text: string } {
  const job = jobLabel(input.jobNumber, input.jobName);
  const tag = input.tagNumber.trim();
  const work = truncate(input.work);
  const preparer = input.preparerName.trim();
  const when = dateOnly(input.tagDate);
  const signed = zonedParts(input.signedAt);
  const signer = input.signerName.trim();
  const refused = Boolean(input.refused);
  const title = refused ? `Extra work tag ${tag} was refused` : `Extra work tag ${tag} is signed`;
  const detail = refused
    ? [signer ? `Refused by ${signer}` : "Refused", signed.date ? `on ${signed.date}` : "", signed.time ? `at ${signed.time}` : ""]
        .filter(Boolean)
        .join(" ")
    : [signer ? `Signed by ${signer}` : "Signed", signed.date ? `on ${signed.date}` : "", signed.time ? `at ${signed.time}` : ""]
        .filter(Boolean)
        .join(" ");
  const subject = `${refused ? "Refused" : "Signed"}: Extra work tag ${tag}${job ? `, ${job}` : ""}`;
  const bannerBg = refused ? "#FEF3C7" : "#EAF3DE";
  const bannerBorder = refused ? "#F5D78A" : "#C0DD97";
  const bannerText = refused ? "#78350F" : "#27500A";
  const attached = refused ? "Copy attached" : "Signed copy attached";
  const rows = [
    { label: "Job", value: job },
    { label: "Date", value: when },
    { label: "Work", value: work },
  ];
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bannerBg}" style="background:${bannerBg};border:1px solid ${bannerBorder};border-radius:8px;margin:0 0 18px;">
      <tr>
        <td bgcolor="${bannerBg}" style="background:${bannerBg};padding:14px 16px;font-family:${FONT};color:${bannerText};">
          <div style="font-size:16px;line-height:1.35;font-weight:700;">${esc(title)}</div>
          <div style="font-size:14px;line-height:1.4;margin-top:4px;">${esc(detail)}</div>
        </td>
      </tr>
    </table>
    ${summaryRows(rows)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
      <tr>
        <td width="46" valign="middle" bgcolor="#FFFFFF" style="width:46px;background:#FFFFFF;padding:0 10px 16px 0;">
          <div style="font-family:${FONT};font-size:11px;line-height:1;font-weight:700;color:#1F2A37;border:1px solid #D1D5DB;border-radius:4px;padding:8px 6px;text-align:center;">PDF</div>
        </td>
        <td valign="middle" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:0 0 16px;font-family:${FONT};">
          <div style="font-size:14px;line-height:1.35;color:#111827;word-break:break-word;">${esc(input.filename.trim())}</div>
          <div style="font-size:13px;line-height:1.35;color:#6B7280;margin-top:2px;">${esc(attached)}</div>
        </td>
      </tr>
    </table>`;
  const text = [
    input.companyName.trim(),
    "",
    title,
    detail,
    "",
    job ? `Job: ${job}` : "",
    when ? `Date: ${when}` : "",
    work ? `Work: ${work}` : "",
    "",
    input.filename.trim(),
    attached,
    "",
    input.companyName.trim(),
    preparer ? `Sent by ${preparer}` : "",
  ]
    .filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n")
    .trim();
  return {
    subject,
    html: shell({
      preheader: clip(detail || title, 90),
      companyName: input.companyName,
      preparerName: preparer,
      body,
    }),
    text,
  };
}
