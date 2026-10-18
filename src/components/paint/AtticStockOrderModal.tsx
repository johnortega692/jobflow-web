import { useEffect, useMemo, useState } from "react";
import type { PaintItem } from "../../types/tradeDocuments";
import type { EmailSignatureSettings } from "../../lib/emailSignature";
import { resolveEmailSignatureLogoUrl } from "../../lib/emailSignature";
import type { ComposeEmailMethod } from "../../lib/paintUserSettings";
import { composeEmailButtonLabel } from "../../lib/paintUserSettings";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  previewNextMaterialOrderPo,
  recordMaterialOrderPo,
  resolveMaterialOrderPo,
} from "../../lib/materialOrderPo";
import {
  atticStockLinesFromSchedule,
  buildAtticStockEmailHtmlBody,
  buildAtticStockEmailPlainBody,
  buildAtticStockEmailSubject,
  openGmailComposeWithHtml,
  vendorRecipientEmails,
  type PaintVendor,
} from "../../lib/paintVendorEmail";

type Props = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  items: PaintItem[];
  vendors: PaintVendor[];
  signature: EmailSignatureSettings;
  logoUrl?: string;
  composeEmailMethod?: ComposeEmailMethod;
  createdBy?: string | null;
  createdByName?: string;
  onClose: () => void;
  onOrdered: (message: string) => void;
};

export function AtticStockOrderModal({
  projectId,
  jobNumber,
  jobName,
  items,
  vendors,
  signature,
  logoUrl = "",
  composeEmailMethod = "gmail",
  createdBy = null,
  createdByName = "",
  onClose,
  onOrdered,
}: Props) {
  const lines = useMemo(() => atticStockLinesFromSchedule(items), [items]);
  const [rows, setRows] = useState(() => lines.map((item) => ({ item, included: true })));
  const [vendorIdx, setVendorIdx] = useState<number | "">("");
  const [po, setPo] = useState("");
  const [poNote, setPoNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(false);

  const { settings, branding } = useLetterhead();
  const effectiveLogoUrl = resolveEmailSignatureLogoUrl(signature, logoUrl, settings.logo_url, branding.logoUrl);

  useEffect(() => {
    setRows(lines.map((item) => ({ item, included: true })));
  }, [lines]);

  useEffect(() => {
    let cancelled = false;
    void previewNextMaterialOrderPo(jobNumber)
      .then((next) => {
        if (!cancelled) setPo(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPoNote(e instanceof Error ? e.message : "Could not preview the next PO.");
      });
    return () => {
      cancelled = true;
    };
  }, [jobNumber]);

  const vendor = vendorIdx === "" ? undefined : vendors[vendorIdx];
  const selected = rows.filter((row) => row.included && (row.item.color.trim() || row.item.product.trim()));
  const activeSignature = includeSignature ? signature : undefined;

  function setQty(index: number, qty: string) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, item: { ...row.item, qty } } : row)));
  }

  function toggle(index: number) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, included: !row.included } : row)));
  }

  async function onNextPo() {
    setError(null);
    setPoNote(null);
    try {
      setPo(await previewNextMaterialOrderPo(jobNumber));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview the next PO.");
    }
  }

  async function onSend() {
    if (!vendor) return;
    if (!selected.length) {
      setError("Choose at least one color.");
      return;
    }
    if (!po.trim()) {
      setError("Get the next PO or enter a PO number.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const poNumber = await resolveMaterialOrderPo({ jobNumber, overridePo: po.trim() });
      await recordMaterialOrderPo({
        projectId,
        jobNumber,
        jobName,
        poNumber,
        scope: "paint",
        vendorLabel: vendor.name,
        createdBy,
        createdByName,
      });
      setPo(poNumber);
      const paintItems = selected.map((row) => row.item);
      const plainBody = buildAtticStockEmailPlainBody(
        vendor,
        jobNumber,
        jobName,
        paintItems,
        [],
        activeSignature,
        poNumber,
      );
      const htmlBody = buildAtticStockEmailHtmlBody(
        vendor,
        jobNumber,
        jobName,
        paintItems,
        [],
        activeSignature,
        effectiveLogoUrl,
        poNumber,
      );
      await openGmailComposeWithHtml({
        to: vendorRecipientEmails(vendor),
        cc: [],
        subject: buildAtticStockEmailSubject(jobNumber, jobName, poNumber),
        htmlBody,
        plainFallback: plainBody,
        method: composeEmailMethod,
      });
      onOrdered(`Attic stock order emailed for PO ${poNumber}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the attic stock order.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-email-modal"
        role="dialog"
        aria-labelledby="attic-stock-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="attic-stock-order-title">Order attic stock</h2>
        <p className="muted small">
          Colors come from this paint schedule. The email goes to the store with the PO. Turn the cans over to the GC
          later on a transmittal.
        </p>

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

        <div className="attic-order-po">
          <label>
            PO
            <input value={po} onChange={(e) => setPo(e.target.value)} aria-label="Purchase order number" />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void onNextPo()}>
            Next PO
          </button>
        </div>
        {poNote ? <p className="muted small">{poNote}</p> : null}

        <label className="check">
          <input
            type="checkbox"
            checked={includeSignature}
            onChange={(e) => setIncludeSignature(e.target.checked)}
          />
          Include signature
        </label>

        <fieldset className="stack">
          <legend className="paint-col-head">
            Colors ({selected.length} of {rows.length})
          </legend>
          <div className="attic-order-list" role="list">
            {rows.length === 0 ? (
              <p className="muted small">No colors on this paint schedule yet.</p>
            ) : (
              rows.map((row, index) => {
                const title = [row.item.label.trim(), row.item.color.trim()].filter(Boolean).join(" · ");
                const meta = [row.item.product.trim(), row.item.sheen.trim()].filter(Boolean).join(" · ");
                return (
                  <div key={`attic-${index}`} className="attic-order-row" role="listitem">
                    <label className="check attic-order-color">
                      <input type="checkbox" checked={row.included} onChange={() => toggle(index)} />
                      <span className="brushouts-send-row-main">
                        <span className="brushouts-send-color">{title || "Untitled color"}</span>
                        <span className="brushouts-send-meta">{meta || "No product / sheen"}</span>
                      </span>
                    </label>
                    <input
                      className="attic-order-qty"
                      value={row.item.qty}
                      onChange={(e) => setQty(index, e.target.value)}
                      aria-label={`Quantity for ${title || "color"}`}
                    />
                  </div>
                );
              })
            )}
          </div>
        </fieldset>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!vendor || sending || selected.length === 0 || !po.trim()}
            onClick={() => void onSend()}
          >
            {sending ? "Sending…" : composeEmailButtonLabel(composeEmailMethod)}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
