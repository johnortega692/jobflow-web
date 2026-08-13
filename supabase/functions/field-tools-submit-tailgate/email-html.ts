import type { OrderBranding } from "../field-tools-submit-order/branding.ts";

const NAVY = "#1a3a5c";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTailgateEmailHtml(input: {
  branding: OrderBranding;
  title: string;
  jobLabel: string;
  conductedBy: string;
  completedAt: string;
  names: string[];
  notes: string;
}): string {
  const logo = input.branding.logoUrl && /^https?:\/\//i.test(input.branding.logoUrl)
    ? `<img src="${escapeHtml(input.branding.logoUrl)}" alt="${escapeHtml(input.branding.companyName)}" style="max-height:52px;max-width:200px;display:block;" />`
    : `<div style="font-size:18px;font-weight:700;color:${NAVY};">${escapeHtml(input.branding.companyName)}</div>`;

  const names = input.names.map((n) => `<li>${escapeHtml(n)}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#333;">
  <table role="presentation" width="100%" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:8px;padding:24px;">
        <tr><td>${logo}</td></tr>
        <tr><td style="padding-top:16px;font-size:20px;font-weight:700;color:${NAVY};">Safety Tailgate</td></tr>
        <tr><td style="padding-top:8px;">${escapeHtml(input.title)}</td></tr>
        <tr><td style="padding-top:12px;font-size:14px;">
          <div><strong>Job:</strong> ${escapeHtml(input.jobLabel)}</div>
          <div><strong>Conducted by:</strong> ${escapeHtml(input.conductedBy)}</div>
          <div><strong>Date:</strong> ${escapeHtml(input.completedAt)}</div>
        </td></tr>
        <tr><td style="padding-top:16px;">
          <div style="font-weight:700;color:${NAVY};">Signed in</div>
          <ul style="margin:8px 0 0;padding-left:20px;">${names}</ul>
        </td></tr>
        ${input.notes.trim() ? `<tr><td style="padding-top:12px;"><strong>Notes:</strong> ${escapeHtml(input.notes)}</td></tr>` : ""}
        <tr><td style="padding-top:16px;font-size:13px;color:#666;">Signed PDF is attached.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
