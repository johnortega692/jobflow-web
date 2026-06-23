import { useEffect, useMemo, useState } from "react";
import type { PaintItem, TradeSubmittalType } from "../../types/tradeDocuments";
import type { EmailSignatureSettings } from "../../lib/emailSignature";
import { resolveEmailSignatureLogoUrl } from "../../lib/emailSignature";
import type { SuperEmail, ComposeEmailMethod } from "../../lib/paintUserSettings";
import { composeEmailButtonLabel } from "../../lib/paintUserSettings";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  buildAtticStockEmailHtmlBody,
  buildAtticStockEmailPlainBody,
  buildAtticStockEmailSubject,
  openGmailComposeWithHtml,
  buildPrepEmailHtmlBody,
  buildPrepEmailPlainBody,
  buildPrepEmailSubject,
  buildVendorEmailHtmlBody,
  buildVendorEmailPlainBody,
  buildVendorEmailSubject,
  copyHtmlToClipboard,
  vendorRecipientEmails,
  type AtticStockCustomItem,
  type AtticStockPaintItem,
  type PaintVendor,
} from "../../lib/paintVendorEmail";
import { MailtoSetupHelp } from "../settings/MailtoSetupHelp";

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
  jobSuper?: string;
  foremanName?: string;
  foremanEmail?: string;
  composeEmailMethod?: ComposeEmailMethod;
  mode?: "brushout" | "attic_stock" | "prep";
  atticCustomItems?: AtticStockCustomItem[];
  prepSite?: string;
  prepGc?: string;
  onClose: () => void;
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
  jobSuper,
  foremanName = "",
  foremanEmail = "",
  composeEmailMethod = "gmail",
  mode = "brushout",
  atticCustomItems = [],
  prepSite = "",
  prepGc = "",
  onClose,
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
  const [openingGmail, setOpeningGmail] = useState(false);

  const { settings, branding } = useLetterhead();
  const effectiveLogoUrl = resolveEmailSignatureLogoUrl(
    signature,
    logoUrl,
    settings.logo_url,
    branding.logoUrl,
  );

  useEffect(() => {
    const supers = (jobSuper || "")
      .split(/[,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const init: Record<string, boolean> = {};
    for (const s of superEmails) {
      init[s.email] = supers.length ? supers.includes(s.name.trim().toLowerCase()) : false;
    }
    const foreman = foremanEmail.trim();
    if (foreman) init[foreman] = true;
    setCcSelected(init);
  }, [superEmails, jobSuper, foremanEmail]);

  const vendor = vendors[vendorIdx];
  const ccList = useMemo(() => {
    const list = superEmails.filter((s) => ccSelected[s.email]).map((s) => s.email);
    const foreman = foremanEmail.trim();
    if (foreman && !list.includes(foreman)) list.push(foreman);
    return list;
  }, [superEmails, ccSelected, foremanEmail]);

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

  async function copyHtml() {
    await copyHtmlToClipboard(htmlBody, "");
    setMessage("Formatted HTML copied — click in compose and press Ctrl+V (not plain text).");
  }

  async function openCompose() {
    if (!vendor || openingGmail) return;
    setOpeningGmail(true);
    setMessage(null);
    try {
      const result = await openGmailComposeWithHtml({
        to: vendorRecipientEmails(vendor),
        cc: ccList,
        subject,
        htmlBody,
        plainFallback: plainBody,
        logoUrl: effectiveLogoUrl,
        logoMaxWidthPx: signature.logo_max_width_px,
        method: composeEmailMethod,
      });
      if (!result.ok) {
        setMessage(result.warning ?? "Could not open compose.");
        return;
      }
      setMessage(result.warning ?? "Compose opened — press Ctrl+V in the empty body to paste formatted HTML only.");
    } finally {
      setOpeningGmail(false);
    }
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

        <MailtoSetupHelp compact method={composeEmailMethod} />

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

        {(superEmails.length > 0 || foremanEmail.trim()) && (
          <fieldset className="stack">
            <legend className="paint-col-head">CC recipients</legend>
            {foremanEmail.trim() ? (
              <label className="check">
                <input type="checkbox" checked disabled readOnly />
                {foremanName.trim()
                  ? `${foremanName.trim()} (${foremanEmail.trim()})`
                  : foremanEmail.trim()}{" "}
                — foreman
              </label>
            ) : null}
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
          <p className="paint-col-head">Message preview</p>
          <div
            className="paint-email-html-preview paint-email-html-preview--full"
            dangerouslySetInnerHTML={{ __html: htmlBody }}
          />
          <p className="muted small">
            Formatted HTML is copied automatically — compose opens <strong>empty</strong>. Click in the body and press{" "}
            <strong>Ctrl+V</strong> for tables and signature. Use <strong>Copy HTML</strong> to copy again.
          </p>
        </div>

        {message && <div className="banner banner-ok">{message}</div>}

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!vendor || openingGmail}
            onClick={() => void openCompose()}
          >
            {openingGmail ? "Opening…" : composeEmailButtonLabel(composeEmailMethod)}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!vendor} onClick={() => void copyHtml()}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
