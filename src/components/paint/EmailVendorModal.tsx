import { useEffect, useMemo, useState } from "react";
import type { PaintItem, TradeSubmittalType } from "../../types/tradeDocuments";
import type { EmailSignatureSettings } from "../../lib/emailSignature";
import type { SuperEmail } from "../../lib/paintUserSettings";
import { sendVendorEmailFromApp } from "../../lib/sendVendorEmail";
import {
  buildMailtoUrl,
  buildVendorEmailHtmlBody,
  buildVendorEmailPlainBody,
  buildVendorEmailSubject,
  buildVendorEmlBlob,
  copyHtmlToClipboard,
  downloadVendorEml,
  vendorEmlFilename,
  vendorRecipientEmails,
  type PaintVendor,
} from "../../lib/paintVendorEmail";

type Props = {
  jobNumber: string;
  jobName: string;
  items: PaintItem[];
  submittalType: TradeSubmittalType;
  vendors: PaintVendor[];
  superEmails: SuperEmail[];
  defaultQty: number;
  signature: EmailSignatureSettings;
  logoUrl?: string;
  fromEmail?: string;
  jobSuper?: string;
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
  jobSuper,
  onClose,
  onSent,
}: Props) {
  const [vendorIdx, setVendorIdx] = useState(0);
  const [subject, setSubject] = useState(() => buildVendorEmailSubject(jobNumber, jobName, submittalType));
  const [ccSelected, setCcSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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
    () =>
      vendor
        ? buildVendorEmailPlainBody(vendor, jobNumber, jobName, items, submittalType, defaultQty)
        : "",
    [vendor, jobNumber, jobName, items, submittalType, defaultQty],
  );

  const htmlBody = useMemo(
    () =>
      vendor
        ? buildVendorEmailHtmlBody(
            vendor,
            jobNumber,
            jobName,
            items,
            submittalType,
            defaultQty,
            signature,
            logoUrl,
          )
        : "",
    [vendor, jobNumber, jobName, items, submittalType, defaultQty, signature, logoUrl],
  );

  async function sendFromApp() {
    if (!vendor) return;
    setSending(true);
    setSendError(null);
    setMessage(null);
    try {
      const id = await sendVendorEmailFromApp({
        to: vendorRecipientEmails(vendor),
        cc: ccList,
        subject,
        html: htmlBody,
        text: plainBody,
        reply_to: fromEmail || undefined,
      });
      onSent?.();
      setMessage(`Email sent to ${vendor.name} (${id}).`);
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
      from: fromEmail,
    });
    downloadVendorEml(vendorEmlFilename(jobNumber, jobName), blob);
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

  function openMailtoHeadersOnly() {
    if (!vendor) return;
    const mailto = buildMailtoUrl(vendorRecipientEmails(vendor), ccList, subject);
    window.location.href = mailto;
    setMessage(
      "Opened mail app with To/CC/Subject only. Paste HTML (Copy HTML button) into the body. Tip: use Download .eml for classic Outlook with formatting.",
    );
  }

  if (!vendors.length) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
          <h3>Email vendor</h3>
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
        <h3 id="email-vendor-title">Email vendor</h3>
        <p className="muted small">
          <strong>Send from app</strong> delivers HTML email directly (requires Resend setup in Settings/DEPLOY).
          Or use <strong>Download .eml</strong> for classic Outlook, or <strong>Copy HTML</strong> to paste manually.
        </p>

        <fieldset className="stack">
          <legend className="paint-col-head">Select vendor</legend>
          {vendors.map((v, i) => (
            <label key={`${v.vendor_email}-${i}`} className="check">
              <input
                type="radio"
                name="vendor"
                checked={vendorIdx === i}
                onChange={() => setVendorIdx(i)}
              />
              {v.name} ({v.brand}) — {v.vendor_email}
            </label>
          ))}
        </fieldset>

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

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending || !vendor}
            onClick={() => void sendFromApp()}
          >
            {sending ? "Sending…" : "Send email"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={openClassicOutlook}>
            Download .eml
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copyHtml()}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-secondary" onClick={openMailtoHeadersOnly}>
            Open mail app (headers only)
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
