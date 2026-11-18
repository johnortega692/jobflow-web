import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  DEFAULT_EMAIL_SIGNATURE,
  resolveEmailSignatureLogoUrl,
  type EmailSignatureSettings,
} from "../../lib/emailSignature";
import {
  composeEmailButtonLabel,
  loadPaintUserSettings,
  type ComposeEmailMethod,
} from "../../lib/paintUserSettings";
import { copyHtmlToClipboard, openGmailComposeWithHtml, vendorRecipientEmails, type PaintVendor } from "../../lib/paintVendorEmail";
import {
  buildPaintSampleOrderHtmlBody,
  buildPaintSampleOrderPlainBody,
  buildPaintSampleOrderSubject,
  paintSampleOrderItems,
} from "../../lib/paintSampleOrderEmail";
import type { PaintItem } from "../../types/tradeDocuments";

type Props = {
  jobNumber: string;
  jobName: string;
  jobLocation: string;
  architect: string;
  specifierAddress: string;
  pmName: string;
  items: PaintItem[];
  vendors: PaintVendor[];
  includeLocation: boolean;
  onClose: () => void;
};

export function PaintOrderSamplesModal({
  jobNumber,
  jobName,
  jobLocation,
  architect,
  specifierAddress,
  pmName,
  items,
  vendors,
  includeLocation,
  onClose,
}: Props) {
  const { user } = useAuth();
  const { settings, branding } = useLetterhead();
  const companyAddress = (settings.company_address || branding.companyAddress || "")
    .trim()
    .replace(/\s*\n\s*/g, ", ");
  const rows = useMemo(() => paintSampleOrderItems(items, includeLocation), [items, includeLocation]);
  const [vendorIdx, setVendorIdx] = useState<number | "">("");
  const [address, setAddress] = useState(companyAddress);
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [includeSignature, setIncludeSignature] = useState(false);
  const [signature, setSignature] = useState<EmailSignatureSettings>(DEFAULT_EMAIL_SIGNATURE);
  const [composeEmailMethod, setComposeEmailMethod] = useState<ComposeEmailMethod>("gmail");
  const [message, setMessage] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (companyAddress && !address.trim()) setAddress(companyAddress);
  }, [companyAddress, address]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then((saved) => {
      setComposeEmailMethod(saved.compose_email_method);
      setSignature(saved.signature);
    });
  }, [user?.id]);

  const vendor = vendorIdx === "" ? undefined : vendors[vendorIdx];
  const chosenCount = rows.filter((_, index) => selected.has(index)).length;
  const activeSignature = includeSignature ? signature : undefined;
  const logoUrl = resolveEmailSignatureLogoUrl(signature, "", settings.logo_url, branding.logoUrl);

  const email = useMemo(() => {
    const picked = rows.filter((_, index) => selected.has(index));
    if (!vendor || !picked.length) return null;
    const params = {
      vendor: vendor.name || vendor.brand || "Team",
      jobNumber: jobNumber.trim(),
      jobName: jobName.trim(),
      jobLocation,
      architect,
      specifierAddress,
      qty,
      shippingAddress: address,
      pmName,
      items: picked,
      signature: activeSignature,
      logoUrl,
    };
    return {
      subject: buildPaintSampleOrderSubject(jobNumber, jobName),
      plain: buildPaintSampleOrderPlainBody(params),
      html: buildPaintSampleOrderHtmlBody(params),
    };
  }, [vendor, rows, selected, jobNumber, jobName, jobLocation, architect, specifierAddress, qty, address, pmName, activeSignature, logoUrl]);

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function copyHtml() {
    if (!email) return;
    await copyHtmlToClipboard(email.html, email.plain);
    setMessage("HTML copied — paste into your email body.");
  }

  async function openCompose() {
    if (!vendor || !email) return;
    setOpening(true);
    setMessage(null);
    try {
      await openGmailComposeWithHtml({
        to: vendorRecipientEmails(vendor),
        cc: [],
        subject: email.subject,
        htmlBody: email.html,
        plainFallback: email.plain,
        logoUrl: includeSignature ? logoUrl : undefined,
        logoMaxWidthPx: includeSignature ? signature.logo_max_width_px : undefined,
        method: composeEmailMethod,
      });
      setMessage(
        composeEmailMethod === "mailto"
          ? "Opened in your mail app — paste HTML into the body if needed."
          : "Gmail opened — paste HTML into the body (Ctrl+V).",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open compose.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card ob-dialog"
        role="dialog"
        aria-labelledby="paint-samples-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ob-head">
          <div>
            <h2 id="paint-samples-title">Order samples</h2>
            <p>{[jobName.trim() || "Project", "Mailed samples"].join(" · ")}</p>
          </div>
          <button type="button" className="ob-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="ob-field">
          <span>To</span>
          <select
            value={vendorIdx}
            disabled={!vendors.length}
            aria-label="Vendor"
            onChange={(event) => {
              const next = event.target.value;
              setVendorIdx(next === "" ? "" : Number(next));
            }}
          >
            <option value="">{vendors.length ? "Select vendor…" : "No paint vendors in Settings"}</option>
            {vendors.map((row, index) => (
              <option key={`${row.vendor_email}-${index}`} value={index}>
                {row.name} ({row.brand}) — {row.vendor_email}
              </option>
            ))}
          </select>
        </div>

        <div className="ob-field">
          <span>Ship</span>
          <input
            aria-label="Ship samples to"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Office address"
          />
        </div>

        <div className="ob-field">
          <span>Qty</span>
          <input
            aria-label="Samples of each color"
            type="number"
            min={1}
            value={qty}
            onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>

        <section className="ob-colors">
          <div className="ob-colors-head">
            <p>
              <strong>Colors</strong>
              <span>
                {chosenCount} of {rows.length} selected
              </span>
            </p>
            <div className="ob-colors-actions">
              <button type="button" onClick={() => setSelected(new Set(rows.map((_, index) => index)))}>
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
          </div>
          <div className="ob-color-list" role="list">
            {rows.length === 0 ? (
              <p className="muted small">No paint colors on this list yet.</p>
            ) : (
              rows.map((row, index) => (
                <label key={`paint-sample-${index}`} className="ob-color" role="listitem">
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                  <span className="ob-letter">{row.label || "•"}</span>
                  <span className="ob-color-copy">
                    <span className="ob-color-name">{row.color || "Color"}</span>
                    <span className="ob-color-meta">{[row.product, row.sheen].filter(Boolean).join(" · ") || "No product / sheen"}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </section>

        <div className="ob-sign-row">
          <button
            type="button"
            role="switch"
            className={`sched-toggle${includeSignature ? " is-on" : ""}`}
            aria-checked={includeSignature}
            aria-label="Include my email signature"
            onClick={() => setIncludeSignature((on) => !on)}
          >
            <span className="sched-toggle-knob" />
          </button>
          <span>Include my email signature</span>
          <Link to="/settings" state={{ tab: "email-signature" }} className="ob-edit-link" onClick={onClose}>
            Edit signature
          </Link>
        </div>

        {message ? <div className="banner banner-ok">{message}</div> : null}

        <div className="ob-actions">
          <button type="button" className="btn btn-secondary" disabled={!email} onClick={() => void copyHtml()}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!email || opening} onClick={() => void openCompose()}>
            {opening ? "Opening…" : composeEmailButtonLabel(composeEmailMethod)}
          </button>
        </div>
      </div>
    </div>
  );
}
