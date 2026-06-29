import type { OrderBranding } from "./branding.ts";
import { formatDateNeeded } from "./dates.ts";

export type EmailHtmlInput = {
  branding: OrderBranding;
  orderTitle: string;
  jobCode: string;
  jobName: string;
  poNumber?: string;
  siteContact: string;
  dateNeeded: string;
  notes: string;
  vendorLabel?: string;
  pm?: string;
  super?: string;
  sections: { title: string; lines: string[] }[];
};

const NAVY = "#1a3a5c";
const ACCENT = "#2196F3";
const RED = "#D2232A";

export function buildOrderEmailHtml(input: EmailHtmlInput): string {
  const jobLabel = `${input.jobCode}${input.jobName ? ` — ${input.jobName}` : ""}`;
  const logoBlock = input.branding.logoUrl && /^https?:\/\//i.test(input.branding.logoUrl)
    ? `<img src="${escapeAttr(input.branding.logoUrl)}" alt="${escapeAttr(input.branding.companyName)}" style="max-height:52px;max-width:200px;display:block;" />`
    : `<div style="font-size:18px;font-weight:700;color:${NAVY};">${escapeHtml(input.branding.companyName)}</div>`;

  const metaRows = [
    input.poNumber ? metaRow("PO Number", input.poNumber, true) : "",
    metaRow("Project", jobLabel),
    input.dateNeeded ? metaRow("Date needed", formatDateNeeded(input.dateNeeded), true) : "",
    input.siteContact ? metaRow("Site contact", input.siteContact) : "",
    input.vendorLabel ? metaRow("Vendor", input.vendorLabel) : "",
    input.pm ? metaRow("PM", input.pm) : "",
    input.super ? metaRow("Superintendent", input.super) : "",
  ].filter(Boolean).join("");

  const sections = input.sections
    .filter((s) => s.lines.length > 0)
    .map((s) => sectionTable(s.title, s.lines))
    .join("");

  const footerLines = [input.branding.companyName, input.branding.companyAddress, input.branding.companyPhone]
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join("<br>");

  const preheader = [
    input.orderTitle,
    input.jobCode,
    input.jobName,
    input.poNumber ? `PO# ${input.poNumber}` : "",
    "See attached PDF for order details.",
  ].filter(Boolean).join(" — ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(input.orderTitle)} — ${escapeHtml(input.jobCode)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <div style="display:none;font-size:1px;color:#f4f6f8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border:1px solid #e0e4ea;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px 12px;border-bottom:3px solid ${NAVY};">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">${logoBlock}</td>
                  <td align="right" style="vertical-align:middle;">
                    <div style="font-size:22px;font-weight:700;color:#222;margin:0;">${escapeHtml(input.orderTitle)}</div>
                    ${
    input.poNumber
      ? `<div style="margin-top:8px;"><span style="display:inline-block;background:${NAVY};color:#fff;padding:5px 12px;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:0.5px;">PO# ${escapeHtml(input.poNumber)}</span></div>`
      : ""
  }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#e3f2fd;border-left:4px solid ${ACCENT};font-size:14px;color:#555;">
              Order details are included below and attached as a PDF. Please confirm receipt and expected delivery timeline.
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px 8px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size:14px;">
                ${metaRows}
              </table>
            </td>
          </tr>
          ${
    input.notes.trim()
      ? `<tr><td style="padding:8px 24px 16px;">
          <div style="border:1px solid #d0d7de;border-radius:6px;background:#f8fafc;padding:12px 14px;font-size:13px;color:#444;">
            <div style="font-size:12px;font-weight:700;color:${NAVY};margin-bottom:6px;">Delivery notes</div>
            ${escapeHtml(input.notes)}
          </div>
        </td></tr>`
      : ""
  }
          ${sections ? `<tr><td style="padding:8px 24px 20px;">${sections}</td></tr>` : ""}
          <tr>
            <td style="padding:16px 24px 24px;border-top:1px solid #e8eaed;font-size:14px;color:#333;">
              <p style="margin:0 0 12px;">If you have any questions, please contact us directly.</p>
              <p style="margin:0;">Thank you for your prompt attention to this order.</p>
              <p style="margin:16px 0 0;font-size:14px;">
                Sincerely,<br>
                <strong>Purchasing Department</strong><br>
                ${footerLines || escapeHtml(input.branding.companyName)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function metaRow(label: string, value: string, highlight = false): string {
  const valueStyle = highlight
    ? `color:${RED};font-weight:700;`
    : "color:#333;";
  return `<tr>
    <td style="padding:5px 16px 5px 0;font-weight:700;color:#666;vertical-align:top;white-space:nowrap;width:120px;">${escapeHtml(label)}</td>
    <td style="padding:5px 0;${valueStyle}">${escapeHtml(value)}</td>
  </tr>`;
}

function sectionTable(title: string, lines: string[]): string {
  const rows = lines
    .map((line, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#fafafa";
      return `<tr style="background:${bg};">
        <td style="padding:6px 10px;border-bottom:1px solid #e8eaed;font-size:13px;color:#333;">${escapeHtml(line)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="margin-top:12px;">
      <div style="font-size:15px;font-weight:700;color:${NAVY};margin:0 0 8px;">${escapeHtml(title)}</div>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th align="left" style="padding:6px 10px;font-size:12px;font-weight:700;color:#333;border-bottom:2px solid #ddd;">Item</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export function lineItemsToStrings(items: unknown[]): string[] {
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.raw === "string") return o.raw;
      if (typeof o.name === "string") {
        const qty = o.quantity ? `${o.quantity} ` : "";
        const detail = o.detail ? ` (${o.detail})` : "";
        return `${qty}${o.name}${detail}`.trim();
      }
    }
    return String(item);
  });
}

export function orderTitleForType(type: string): string {
  switch (type) {
    case "material":
    case "job_scope_kit":
      return "Material Order";
    case "rental":
      return "Rental Order";
    case "equipment":
      return "Equipment Order";
    case "wallcovering":
      return "Wallcovering Order";
    case "haul_off":
      return "Haul Off Request";
    default:
      return "Field Order";
  }
}
