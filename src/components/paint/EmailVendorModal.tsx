import { useEffect, useMemo, useState } from "react";
import type { PaintItem, TradeSubmittalType } from "../../types/tradeDocuments";
import type { EmailSignatureSettings } from "../../lib/emailSignature";
import { resolveEmailSignatureLogoUrl } from "../../lib/emailSignature";
import type { ComposeEmailMethod } from "../../lib/paintUserSettings";
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

type Props = {
  jobNumber: string;
  jobName: string;
  items: PaintItem[] | AtticStockPaintItem[];
  submittalType: TradeSubmittalType;
  vendors: PaintVendor[];
  defaultQty: number;
  signature: EmailSignatureSettings;
  logoUrl?: string;
  superName?: string;
  superEmail?: string;
  /** Label next to the super CC checkbox (e.g. "GC super" or "ICBI super"). */
  superRoleLabel?: string;
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
  defaultQty,
  signature,
  logoUrl = "",
  superName = "",
  superEmail = "",
  superRoleLabel = "super",
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

  const [vendorIdx, setVendorIdx] = useState<number | "">("");
  const [subject, setSubject] = useState(() => {
    if (isAtticStock) return buildAtticStockEmailSubject(jobNumber, jobName);
    if (isPrep) return buildPrepEmailSubject(prepSite);
    return buildVendorEmailSubject(jobNumber, jobName, submittalType);
  });
  const [includeSuperCc, setIncludeSuperCc] = useState(Boolean(superEmail.trim()));
  const [includeSignature, setIncludeSignature] = useState(false);
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
    setIncludeSuperCc(Boolean(superEmail.trim()));
  }, [superEmail]);

  const vendor = vendorIdx === "" ? undefined : vendors[vendorIdx];
  const activeSignature = includeSignature ? signature : undefined;
  const ccList = useMemo(() => {
    const list: string[] = [];
    const foreman = foremanEmail.trim();
    if (foreman) list.push(foreman);
    const superAddr = superEmail.trim();
    if (includeSuperCc && superAddr && !list.includes(superAddr)) list.push(superAddr);
    return list;
  }, [foremanEmail, includeSuperCc, superEmail]);

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
          activeSignature,
        );
      }
      if (isPrep) {
        return buildPrepEmailPlainBody(
          vendor,
          prepSite,
          prepGc,
          items as PaintItem[],
          defaultQty,
          activeSignature,
        );
      }
      return buildVendorEmailPlainBody(
        vendor,
        jobNumber,
        jobName,
        items as PaintItem[],
        submittalType,
        defaultQty,
        activeSignature,
      );
    },
    [
      vendor,
      isAtticStock,
      isPrep,
      jobNumber,
      jobName,
      atticPaintItems,
      atticCustomItems,
      prepSite,
      prepGc,
      items,
      submittalType,
      defaultQty,
      activeSignature,
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
          activeSignature,
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
          activeSignature,
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
        activeSignature,
        effectiveLogoUrl,
      );
    },
    [
      vendor,
      isAtticStock,
      isPrep,
      jobNumber,
      jobName,
      atticPaintItems,
      atticCustomItems,
      prepSite,
      prepGc,
      items,
      submittalType,
      defaultQty,
      activeSignature,
      effectiveLogoUrl,
    ],
  );

  async function copyHtml() {
    if (!vendor) return;
    await copyHtmlToClipboard(htmlBody, plainBody);
    setMessage("HTML copied — paste into your email body.");
  }

  async function openCompose() {
    if (!vendor) return;
    setOpeningGmail(true);
    setMessage(null);
    try {
      const to = vendorRecipientEmails(vendor);
      await openGmailComposeWithHtml({
        to,
        cc: ccList,
        subject,
        htmlBody,
        plainFallback: plainBody,
        method: composeEmailMethod,
      });
      setMessage(
        composeEmailMethod === "mailto"
          ? "Opened in your mail app — paste HTML into the body if needed."
          : "Gmail opened — paste HTML into the body (Ctrl+V).",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not open compose.");
    } finally {
      setOpeningGmail(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-email-modal"
        role="dialog"
        aria-labelledby="email-vendor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="email-vendor-title">{isAtticStock ? "Email vendor" : "Order Brushouts"}</h2>

        <label>
          Vendor
          <select
            value={vendorIdx}
            disabled={!vendors.length}
            onChange={(e) => {
              const next = e.target.value;
              setVendorIdx(next === "" ? "" : Number(next));
            }}
          >
            <option value="">Select vendor…</option>
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

        <label className="check">
          <input
            type="checkbox"
            checked={includeSignature}
            onChange={(e) => setIncludeSignature(e.target.checked)}
          />
          Include signature
        </label>

        {(superEmail.trim() || foremanEmail.trim()) && (
          <fieldset className="stack">
            <legend className="paint-col-head">CC recipients (Job setup)</legend>
            {foremanEmail.trim() ? (
              <label className="check">
                <input type="checkbox" checked disabled readOnly />
                {foremanName.trim()
                  ? `${foremanName.trim()} (${foremanEmail.trim()})`
                  : foremanEmail.trim()}{" "}
                — foreman
              </label>
            ) : null}
            {superEmail.trim() ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeSuperCc}
                  onChange={(e) => setIncludeSuperCc(e.target.checked)}
                />
                {superName.trim()
                  ? `${superName.trim()} (${superEmail.trim()})`
                  : superEmail.trim()}{" "}
                — {superRoleLabel}
              </label>
            ) : null}
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
            <strong>Ctrl+V</strong> for tables{includeSignature ? " and signature" : ""}. Use <strong>Copy HTML</strong>{" "}
            to copy again.
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
