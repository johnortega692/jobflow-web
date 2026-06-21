import { useEffect, useMemo, useState } from "react";
import type { PaintItem, TradeSubmittalType } from "../../types/tradeDocuments";
import type { EmailSignatureSettings } from "../../lib/emailSignature";
import type { SuperEmail } from "../../lib/paintUserSettings";
import { sendVendorEmail } from "../../lib/sendVendorEmail";
import { embedLogoUrlInHtml } from "../../lib/emailImageEmbed";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";
import { useAuth } from "../../contexts/AuthContext";
import {
  atticStockEmlFilename,
  buildAtticStockEmailHtmlBody,
  buildAtticStockEmailPlainBody,
  buildAtticStockEmailSubject,
  buildMailtoUrl,
  buildPrepEmailHtmlBody,
  buildPrepEmailPlainBody,
  buildPrepEmailSubject,
  buildVendorEmailHtmlBody,
  buildVendorEmailPlainBody,
  buildVendorEmailSubject,
  buildVendorEmlBlob,
  copyHtmlToClipboard,
  downloadVendorEml,
  prepEmlFilename,
  vendorEmlFilename,
  vendorRecipientEmails,
  type AtticStockCustomItem,
  type AtticStockPaintItem,
  type PaintVendor,
} from "../../lib/paintVendorEmail";

type Props = {
  jobNumber: string;
  jobName: string;
  items: PaintItem[] | AtticStockPaintItem[];
  submittalType: TradeSubmittalType;
  vendors: PaintVendor[];
  superEmails: SuperEmail[];
  defaultQty: number;
  signature: EmailSignatureSettings;
  logoUrl?: string;
  fromEmail?: string;
  fromName?: string;
  jobSuper?: string;
  mode?: "brushout" | "attic_stock" | "prep";
  atticCustomItems?: AtticStockCustomItem[];
  prepSite?: string;
  prepGc?: string;
  onClose: () => void;
  onSent?: () => void;
};

export function EmailVendorModal({
  jobNumber,
  jobName,
  items,
  submittalType,
  vendors = [],
  superEmails,
  defaultQty,
  signature,
  logoUrl = "",
  fromEmail = "",
  fromName = "",
  jobSuper,
  mode = "brushout",
  atticCustomItems = [],
  prepSite = "",
  prepGc = "",
  onClose,
  onSent,
}: Props) {
  const isAtticStock = mode === "attic_stock";
  const isPrep = mode === "prep";
  const atticPaintItems = items as AtticStockPaintItem[];

  const [vendorIdx, setVendorIdx] = useState(0);
  const [subject, setSubject] = useState(() => {
    if (isAtticStock) return buildAtticStockEmailSubject(jobNumber, jobName);
    if (isPrep) return buildPrepEmailSubject(prepSite);
    return buildVendorEmailSubject(jobNumber, jobName, submittalType);
  });
  const [ccSelected, setCcSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [gasUrl, setGasUrl] = useState("");

  const { user } = useAuth();
  const { settings, branding } = useLetterhead();
  const effectiveLogoUrl = logoUrl.trim() || settings.logo_url.trim() || branding.logoUrl.trim();
  const effectiveFromName = fromName.trim() || branding.companyName.trim();

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then((s) => {
      setGasUrl((s.google_urls.paint_tracker ?? "").trim());
    });
  }, [user?.id]);

  useEffect(() => {
    if (!superEmails.length) return;
    const supers = (jobSuper || "")
      .split(/[,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const init: Record<string, boolean> = {};
    for (const s of superEmails) {
      init[s.email] = supers.length ? supers.includes(s.name.trim().toLowerCase()) : false;
    }
    setCcSelected(init);
  }, [superEmails, jobSuper]);

  const vendor = vendors[vendorIdx];
  const ccList = superEmails.filter((s) => ccSelected[s.email]).map((s) => s.email);

  const plainBody = useMemo(
    () => {
      if (!vendor) return "";
      if (isAtticStock) {
        return buildAtticStockEmailPlainBody(
          vendor,
          jobNumber,
          jobName,
          atticPaintItems,
          atticCustomItems,
          signature,
        );
      }
      if (isPrep) {
        return buildPrepEmailPlainBody(
          vendor,
          prepSite,
          prepGc,
          items as PaintItem[],
          defaultQty,
          signature,
        );
      }
      return buildVendorEmailPlainBody(
        vendor,
        jobNumber,
        jobName,
        items as PaintItem[],
        submittalType,
        defaultQty,
        signature,
      );
    },
    [
      vendor,
      isAtticStock,
      isPrep,
      jobNumber,
      jobName,
      items,
      atticPaintItems,
      atticCustomItems,
      submittalType,
      defaultQty,
      signature,
      prepSite,
      prepGc,
    ],
  );

  const htmlBody = useMemo(
    () => {
      if (!vendor) return "";
      if (isAtticStock) {
        return buildAtticStockEmailHtmlBody(
          vendor,
          jobNumber,
          jobName,
          atticPaintItems,
          atticCustomItems,
          signature,
          effectiveLogoUrl,
        );
      }
      if (isPrep) {
        return buildPrepEmailHtmlBody(
          vendor,
          prepSite,
          prepGc,
          items as PaintItem[],
          defaultQty,
          signature,
          effectiveLogoUrl,
        );
      }
      return buildVendorEmailHtmlBody(
        vendor,
        jobNumber,
        jobName,
        items as PaintItem[],
        submittalType,
        defaultQty,
        signature,
        effectiveLogoUrl,
      );
    },
    [
      vendor,
      isAtticStock,
      isPrep,
      jobNumber,
      jobName,
      items,
      atticPaintItems,
      atticCustomItems,
      submittalType,
      defaultQty,
      signature,
      effectiveLogoUrl,
      prepSite,
      prepGc,
    ],
  );

  async function sendFromApp() {
    if (!vendor) return;
    setSending(true);
    setSendError(null);
    setMessage(null);
    const htmlForSend = await embedLogoUrlInHtml(htmlBody, effectiveLogoUrl);
    const payload = {
      to: vendorRecipientEmails(vendor),
      cc: ccList,
      subject,
      html: htmlForSend,
      text: plainBody,
      reply_to: fromEmail || undefined,
      from_name: effectiveFromName || undefined,
    };
    try {
      const { id, channel } = await sendVendorEmail(payload, { gasUrl: gasUrl || undefined });
      onSent?.();
      setMessage(
        channel === "gas"
          ? `Email sent to ${vendor.name} via Gmail (${id}).`
          : `Email sent to ${vendor.name} (${id}).`,
      );
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send email.");
    } finally {
      setSending(false);
    }
  }

  function openClassicOutlook() {
    if (!vendor) return;
    const to = vendorRecipientEmails(vendor);
    const blob = buildVendorEmlBlob({
      to,
      cc: ccList,
      subject,
      htmlBody,
      plainBody,
      from:
        fromEmail && effectiveFromName
          ? `${effectiveFromName} <${fromEmail}>`
          : fromEmail || effectiveFromName,
    });
    downloadVendorEml(
      isAtticStock
        ? atticStockEmlFilename(jobNumber, jobName)
        : isPrep
          ? prepEmlFilename(prepSite)
          : vendorEmlFilename(jobNumber, jobName),
      blob,
    );
    onSent?.();
    setMessage(
      "Downloaded .eml file — double-click it to open in classic Outlook (or right-click → Open with → Outlook). HTML body and signature are included.",
    );
  }

  async function copyHtml() {
    await copyHtmlToClipboard(htmlBody, plainBody);
    setMessage(
      "HTML copied. Click in the Outlook compose body and press Ctrl+V. If formatting looks wrong, use Download .eml instead.",
    );
  }

  function openMailto() {
    if (!vendor) return;
    const mailto = buildMailtoUrl(vendorRecipientEmails(vendor), ccList, subject, plainBody);
    window.location.href = mailto;
    onSent?.();
    setMessage(
      "Opened mail app with To, CC, subject, and formatted plain-text body. For HTML tables and logo, use Download .eml instead.",
    );
  }

  if (!vendors.length) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
          <h3>{isAtticStock ? "Order Attic Stock" : isPrep ? "Send brush-out request (no job # yet)" : "Email vendor"}</h3>
          <p className="banner banner-error">
            No vendors configured. Add vendors under Settings → Paint &amp; email.
          </p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-email-modal"
        role="dialog"
        aria-labelledby="email-vendor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="email-vendor-title">
          {isAtticStock ? "Order Attic Stock" : isPrep ? "Send brush-out request (no job # yet)" : "Email vendor"}
        </h3>

        <label>
          Select vendor
          <select
            className="paint-field-select"
            value={vendorIdx}
            onChange={(e) => setVendorIdx(Number(e.target.value))}
          >
            {vendors.map((v, i) => (
              <option key={`${v.vendor_email}-${i}`} value={i}>
                {v.name} ({v.brand}) — {v.vendor_email}
              </option>
            ))}
          </select>
        </label>

        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        {superEmails.length > 0 && (
          <fieldset className="stack">
            <legend className="paint-col-head">Super email (CC)</legend>
            {superEmails.map((s) => (
              <label key={s.email} className="check">
                <input
                  type="checkbox"
                  checked={Boolean(ccSelected[s.email])}
                  onChange={(e) => setCcSelected((m) => ({ ...m, [s.email]: e.target.checked }))}
                />
                {s.name ? `${s.name} (${s.email})` : s.email}
              </label>
            ))}
          </fieldset>
        )}

        <div className="stack">
          <p className="paint-col-head">HTML preview</p>
          <div
            className="paint-email-html-preview paint-email-html-preview--full"
            dangerouslySetInnerHTML={{ __html: htmlBody }}
          />
        </div>

        {sendError && <div className="banner banner-error">{sendError}</div>}
        {message && <div className="banner banner-ok">{message}</div>}

        {gasUrl ? (
          <p className="muted small">
            Sends through your <strong>Dashboard Web App</strong> Google account (Settings → Google Apps Script URLs).
          </p>
        ) : (
          <p className="muted small">
            Set the <strong>Dashboard Web App URL</strong> in Settings to send via Gmail, or configure Resend on the server.
          </p>
        )}

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending || !vendor}
            onClick={() => void sendFromApp()}
          >
            {sending ? "Sending…" : gasUrl ? "Send via Gmail" : "Send email"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={openClassicOutlook}>
            Download .eml
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copyHtml()}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-secondary" onClick={openMailto}>
            Open in mail app
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
