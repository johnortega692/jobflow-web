import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import type { DeliverySchedulingSettings } from "../../lib/deliverySettings";
import {
  DEFAULT_EMAIL_SIGNATURE,
  resolveEmailSignatureLogoUrl,
  type EmailSignatureSettings,
} from "../../lib/emailSignature";
import {
  buildMaterialOrderEmailHtmlBody,
  buildMaterialOrderEmailPlainBody,
  buildMaterialOrderEmailSubject,
  type MaterialOrderEmailItem,
  type MaterialOrderEmailType,
} from "../../lib/materialOrderEmail";
import {
  composeEmailButtonLabel,
  loadPaintUserSettings,
  type ComposeEmailMethod,
} from "../../lib/paintUserSettings";
import {
  copyHtmlToClipboard,
  openGmailComposeWithHtml,
} from "../../lib/paintVendorEmail";
import type { MaterialVendor } from "../../types/contactDirectory";

type Props = {
  materialType: MaterialOrderEmailType;
  jobNumber: string;
  jobName: string;
  poNumber: string;
  deliveryAddress: string;
  specifier: string;
  items: MaterialOrderEmailItem[];
  delivery: DeliverySchedulingSettings;
  vendors: MaterialVendor[];
  /** Download order PDF(s) for the selected vendor before compose. */
  onDownloadPdfs: (vendor: MaterialVendor) => Promise<void>;
  onClose: () => void;
};

export function MaterialOrderEmailModal({
  materialType,
  jobNumber,
  jobName,
  poNumber,
  deliveryAddress,
  specifier,
  items,
  delivery,
  vendors,
  onDownloadPdfs,
  onClose,
}: Props) {
  const { user } = useAuth();
  const { settings, branding } = useLetterhead();
  const [vendorIdx, setVendorIdx] = useState<number | "">("");
  const [subject, setSubject] = useState(() =>
    buildMaterialOrderEmailSubject(materialType, jobNumber, jobName),
  );
  const [includeSignature, setIncludeSignature] = useState(false);
  const [signature, setSignature] = useState<EmailSignatureSettings>(DEFAULT_EMAIL_SIGNATURE);
  const [composeEmailMethod, setComposeEmailMethod] = useState<ComposeEmailMethod>("gmail");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSubject(buildMaterialOrderEmailSubject(materialType, jobNumber, jobName));
  }, [materialType, jobNumber, jobName]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then((s) => {
      setComposeEmailMethod(s.compose_email_method);
      setSignature(s.signature);
    });
  }, [user?.id]);

  const vendor = vendorIdx === "" ? undefined : vendors[vendorIdx];
  const activeSignature = includeSignature ? signature : undefined;
  const effectiveLogoUrl = resolveEmailSignatureLogoUrl(
    signature,
    "",
    settings.logo_url,
    branding.logoUrl,
  );

  const manufacturer = items[0]?.manufacturer.trim() || "";

  const emailParams = useMemo(() => {
    if (!vendor) return null;
    return {
      materialType,
      jobNumber,
      jobName,
      poNumber,
      deliveryAddress,
      specifier,
      manufacturer,
      items,
      delivery,
      signature: activeSignature,
      logoUrl: effectiveLogoUrl,
    };
  }, [
    vendor,
    materialType,
    jobNumber,
    jobName,
    poNumber,
    deliveryAddress,
    specifier,
    manufacturer,
    items,
    delivery,
    activeSignature,
    effectiveLogoUrl,
  ]);

  const plainBody = useMemo(
    () => (emailParams ? buildMaterialOrderEmailPlainBody(emailParams) : ""),
    [emailParams],
  );
  const htmlBody = useMemo(
    () => (emailParams ? buildMaterialOrderEmailHtmlBody(emailParams) : ""),
    [emailParams],
  );

  async function copyHtml() {
    if (!emailParams) return;
    await copyHtmlToClipboard(htmlBody, plainBody);
    setMessage("HTML copied — paste into your email body.");
  }

  async function openCompose() {
    if (!vendor || !emailParams) return;
    setBusy(true);
    setMessage(null);
    try {
      await onDownloadPdfs(vendor);
      const to = vendor.email.trim() ? [vendor.email.trim()] : [];
      await openGmailComposeWithHtml({
        to,
        cc: [],
        subject,
        htmlBody,
        plainFallback: plainBody,
        logoUrl: includeSignature ? effectiveLogoUrl : undefined,
        logoMaxWidthPx: includeSignature ? signature.logo_max_width_px : undefined,
        method: composeEmailMethod,
      });
      setMessage(
        composeEmailMethod === "mailto"
          ? "PDF downloaded and mail app opened — attach the PDF, then paste HTML into the body."
          : "PDF downloaded and Gmail opened — attach the PDF, then paste HTML (Ctrl+V).",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not prepare order email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card paint-email-modal paint-email-modal--sticky-actions"
        role="dialog"
        aria-labelledby="material-order-email-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="paint-email-modal-scroll stack">
          <h2 id="material-order-email-title">Email order</h2>

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
              <option value="">
                {vendors.length ? "Select vendor…" : "No material vendors in Settings"}
              </option>
              {vendors.map((v, i) => (
                <option key={`${v.email}-${v.name}-${i}`} value={i}>
                  {v.name}
                  {v.products.trim() ? ` (${v.products.trim()})` : ""}
                  {v.email.trim() ? ` — ${v.email.trim()}` : ""}
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

          <div className="stack">
            <p className="paint-col-head">Message preview</p>
            <div
              className="paint-email-html-preview paint-email-html-preview--full"
              dangerouslySetInnerHTML={{
                __html: htmlBody || "<p class='muted'>Select a vendor to preview.</p>",
              }}
            />
            <p className="muted small">
              Order PDF downloads first — attach it in your email. Formatted HTML is copied
              automatically; compose opens <strong>empty</strong> — press <strong>Ctrl+V</strong> in
              the body.
            </p>
          </div>

          {message && (
            <div className={`banner ${message.toLowerCase().includes("could not") ? "banner-error" : "banner-ok"}`}>
              {message}
            </div>
          )}
        </div>

        <div className="paint-email-modal-sticker row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!vendor || busy}
            onClick={() => void openCompose()}
          >
            {busy ? "Preparing…" : composeEmailButtonLabel(composeEmailMethod)}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!vendor || busy} onClick={() => void copyHtml()}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
