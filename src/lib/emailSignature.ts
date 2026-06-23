export type SignatureLineStyle = {
  bold?: boolean;
  italic?: boolean;
  /** 0 = use signature default font size */
  font_size_pt?: number;
};

export type EmailSignatureSettings = {
  lines: string[];
  line_styles: SignatureLineStyle[];
  logo_position: number;
  /** Max width in pixels for signature logo */
  logo_max_width_px: number;
  /** Personal email logo (sized for Gmail paste). Falls back to letterhead logo when empty. */
  signature_logo_url: string;
  font_family: string;
  font_size_pt: number;
  font_color: string;
  use_custom_html: boolean;
  html_body: string;
};

export const SIGNATURE_LINE_COUNT = 15;

export const DEFAULT_EMAIL_SIGNATURE: EmailSignatureSettings = {
  lines: Array(SIGNATURE_LINE_COUNT).fill(""),
  line_styles: Array.from({ length: SIGNATURE_LINE_COUNT }, () => ({})),
  logo_position: 0,
  logo_max_width_px: 220,
  signature_logo_url: "",
  font_family: "Calibri, Arial, sans-serif",
  font_size_pt: 11,
  font_color: "#000000",
  use_custom_html: false,
  html_body: "",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeLineStyles(raw: unknown): SignatureLineStyle[] {
  const styles = Array.from({ length: SIGNATURE_LINE_COUNT }, () => ({} as SignatureLineStyle));
  if (!Array.isArray(raw)) return styles;
  for (let i = 0; i < SIGNATURE_LINE_COUNT; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    styles[i] = {
      bold: Boolean(s.bold),
      italic: Boolean(s.italic),
      font_size_pt: typeof s.font_size_pt === "number" ? s.font_size_pt : 0,
    };
  }
  return styles;
}

function lineStyleCss(style: SignatureLineStyle | undefined, defaults: EmailSignatureSettings): string {
  const parts = [
    "margin:0;padding:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;line-height:normal;",
  ];
  const size = style?.font_size_pt && style.font_size_pt > 0 ? style.font_size_pt : defaults.font_size_pt;
  parts.push(`font-size:${size}pt;`);
  parts.push(`font-family:${defaults.font_family};`);
  parts.push(`color:${defaults.font_color};`);
  if (style?.bold) parts.push("font-weight:bold;");
  if (style?.italic) parts.push("font-style:italic;");
  return parts.join("");
}

function outlookLineBreak(): string {
  return `<div style="height:4px;font-size:4px;line-height:4px;mso-line-height-rule:exactly;">&nbsp;</div>`;
}

function lineToHtmlParagraph(
  line: string,
  style: SignatureLineStyle | undefined,
  defaults: EmailSignatureSettings,
): string {
  const text = (line || "").trim();
  if (!text) return outlookLineBreak();
  const css = lineStyleCss(style, defaults);
  if (text.startsWith("<") && text.includes(">")) {
    return `<p style="${css}">${text}</p>${outlookLineBreak()}`;
  }
  return `<p style="${css}">${esc(text)}</p>${outlookLineBreak()}`;
}

/** Outlook / Gmail paste — table wrapper + width attribute keeps logo from blowing up to full size. */
export function sizedLogoImgTag(logoUrl: string, maxWidthPx: number): string {
  const w = Math.max(40, Math.round(maxWidthPx));
  const img =
    `<img src="${esc(logoUrl)}" alt="Company Logo" width="${w}" border="0" ` +
    `style="width:${w}px !important;max-width:${w}px !important;height:auto !important;` +
    `display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">` +
    `<tr><td width="${w}" style="width:${w}px;max-width:${w}px;padding:0;margin:0;line-height:0;font-size:0;">` +
    `${img}</td></tr></table>`
  );
}

function logoParagraph(logoUrl: string, maxWidthPx: number): string {
  return `<p style="margin:0;padding:0;line-height:normal;">${sizedLogoImgTag(logoUrl, maxWidthPx)}</p>${outlookLineBreak()}`;
}

export function repairSignatureHtml(html: string): string {
  let text = (html || "").trim();
  if (!text) return text;
  if (/^div[\s>]/i.test(text)) text = `<${text}`;
  if (/^p[\s>]/i.test(text)) text = `<${text}`;
  return text.replace(/^(?:\s*<br\s*\/?>\s*)+/i, "");
}

export function normalizeEmailSignature(raw: unknown): EmailSignatureSettings {
  const out: EmailSignatureSettings = {
    ...DEFAULT_EMAIL_SIGNATURE,
    lines: [...DEFAULT_EMAIL_SIGNATURE.lines],
    line_styles: [...DEFAULT_EMAIL_SIGNATURE.line_styles],
  };
  if (!raw || typeof raw !== "object") return out;
  const sig = raw as Record<string, unknown>;

  if (Array.isArray(sig.lines)) {
    out.lines = sig.lines.map((x) => String(x ?? ""));
    while (out.lines.length < SIGNATURE_LINE_COUNT) out.lines.push("");
    out.lines = out.lines.slice(0, SIGNATURE_LINE_COUNT);
  }

  out.line_styles = normalizeLineStyles(sig.line_styles);

  const pos = Number(sig.logo_position);
  out.logo_position = Number.isFinite(pos) ? Math.max(0, Math.min(SIGNATURE_LINE_COUNT, pos)) : 0;

  const logoW = Number(sig.logo_max_width_px);
  out.logo_max_width_px = Number.isFinite(logoW) && logoW > 0 ? Math.round(logoW) : 220;

  out.signature_logo_url =
    typeof sig.signature_logo_url === "string" ? sig.signature_logo_url.trim() : "";

  out.font_family =
    typeof sig.font_family === "string" && sig.font_family.trim()
      ? sig.font_family.trim()
      : DEFAULT_EMAIL_SIGNATURE.font_family;

  const fs = Number(sig.font_size_pt);
  out.font_size_pt = Number.isFinite(fs) && fs > 0 ? fs : 11;

  out.font_color =
    typeof sig.font_color === "string" && sig.font_color.trim()
      ? sig.font_color.trim()
      : DEFAULT_EMAIL_SIGNATURE.font_color;

  out.use_custom_html = Boolean(sig.use_custom_html);
  out.html_body = typeof sig.html_body === "string" ? sig.html_body : "";
  return out;
}

function applyLogoSizeToHtml(html: string, maxWidthPx: number, logoUrl: string): string {
  const url = logoUrl.trim();
  const w = Math.max(40, Math.round(maxWidthPx));

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const isLogo =
      /cid:logo_image/i.test(tag) ||
      /alt=["']Company Logo["']/i.test(tag) ||
      (url.length > 0 && tag.includes(url)) ||
      (/src=["']data:image\//i.test(tag) && /alt=["']Company Logo["']/i.test(tag));
    if (!isLogo) return tag;

    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const src = srcMatch?.[1] ?? url;
    if (!src) return tag;
    return sizedLogoImgTag(src, w);
  });
}

/** Re-apply signature logo width after inlining logo as a data URL (Gmail paste). */
export function constrainSignatureLogoInHtml(html: string, maxWidthPx: number, logoUrl = ""): string {
  return applyLogoSizeToHtml(html, maxWidthPx, logoUrl);
}

/** Add line breaks Outlook keeps when pasting custom signature HTML. */
function normalizeCustomHtmlForOutlook(html: string): string {
  let out = html;
  out = out.replace(/<p(\s[^>]*)?>\s*(<br\s*\/?>)?\s*<\/p>/gi, outlookLineBreak());
  out = out.replace(/<p(\s[^>]*)?>\s*&nbsp;\s*<\/p>/gi, outlookLineBreak());
  out = out.replace(/<\/p>/gi, `</p>${outlookLineBreak()}`);
  out = out.replace(/(<br\s*\/?>\s*){3,}/gi, `<br /><br />${outlookLineBreak()}`);
  return out;
}

function resolveLogoInHtml(html: string, logoUrl: string, maxWidthPx: number): string {
  let result = html;
  if (!logoUrl.trim()) {
    result = result.replace(/<img[^>]*src=["']cid:logo_image["'][^>]*>/gi, "");
  } else {
    result = result.replace(/cid:logo_image/gi, logoUrl.trim());
    result = applyLogoSizeToHtml(result, maxWidthPx, logoUrl);
  }
  return result;
}

function generateHtmlFromFields(signature: EmailSignatureSettings, logoUrl: string): string {
  const sig = normalizeEmailSignature(signature);
  const lines = sig.lines;
  const styles = sig.line_styles;
  const pos = sig.logo_position;
  const includeLogo = Boolean(logoUrl.trim());

  const parts = [
    `<br><br><div style="font-family: ${sig.font_family}; font-size: ${sig.font_size_pt}pt; color: ${sig.font_color};">`,
  ];

  for (let i = 0; i < SIGNATURE_LINE_COUNT; i++) {
    if (includeLogo && pos === i) parts.push(logoParagraph(logoUrl, sig.logo_max_width_px));
    const para = lineToHtmlParagraph(lines[i] ?? "", styles[i], sig);
    if (para) parts.push(para);
  }
  if (includeLogo && pos >= SIGNATURE_LINE_COUNT) {
    parts.push(logoParagraph(logoUrl, sig.logo_max_width_px));
  }
  parts.push("</div>");
  return parts.join("");
}

/** Email signature logo — personal upload first, then letterhead / branding fallbacks. */
export function resolveEmailSignatureLogoUrl(
  signature: EmailSignatureSettings,
  ...fallbacks: (string | undefined)[]
): string {
  const own = normalizeEmailSignature(signature).signature_logo_url.trim();
  if (own) return own;
  for (const fb of fallbacks) {
    const url = fb?.trim();
    if (url) return url;
  }
  return "";
}

/** HTML fragment appended before closing body in vendor emails. */
export function buildEmailSignatureHtml(signature: EmailSignatureSettings, fallbackLogoUrl = ""): string {
  const sig = normalizeEmailSignature(signature);
  const logoUrl = resolveEmailSignatureLogoUrl(sig, fallbackLogoUrl);
  if (sig.use_custom_html && sig.html_body.trim()) {
    let body = repairSignatureHtml(sig.html_body);
    body = resolveLogoInHtml(body, logoUrl, sig.logo_max_width_px);
    body = normalizeCustomHtmlForOutlook(body);
    if (!/^(?:\s*<br\s*\/?>\s*)+/i.test(body)) body = `<br /><br />${body}`;
    return body;
  }
  return generateHtmlFromFields(sig, logoUrl);
}

export function buildEmailSignaturePlain(signature: EmailSignatureSettings): string {
  const sig = normalizeEmailSignature(signature);
  const out = ["Thank you,", ""];
  for (const line of sig.lines) {
    const text = (line || "").trim();
    if (text && !text.startsWith("<")) out.push(text);
  }
  return out.join("\n");
}

export const SIGNATURE_FONT_SIZE_OPTIONS = [
  { label: "Default", value: 0 },
  { label: "8 pt (small)", value: 8 },
  { label: "10 pt", value: 10 },
  { label: "11 pt", value: 11 },
  { label: "12 pt", value: 12 },
];
