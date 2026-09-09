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
import {
  brushoutColorLine,
  brushoutOrderLineStatus,
  defaultBrushoutOrderSelection,
  type BrushoutOrderLineStatus,
} from "../../lib/paintBrushouts";

const ORDER_STATUS_LABEL: Record<BrushoutOrderLineStatus, string> = {
  new: "New",
  switched: "Switched",
  unchanged: "On list",
};

function orderStatusClass(status: BrushoutOrderLineStatus): string {
  if (status === "unchanged") return "brushout-status-pill brushout-status-pill--on-sheet";
  if (status === "switched") return "brushout-status-pill brushout-status-pill--revised";
  return "brushout-status-pill brushout-status-pill--new";
}

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
  /** Job setup Super (ICBI) — always CC'd when present. */
  staffSuperName?: string;
  staffSuperEmail?: string;
  staffSuperRoleLabel?: string;
  foremanName?: string;
  foremanEmail?: string;
  composeEmailMethod?: ComposeEmailMethod;
  mode?: "brushout" | "attic_stock" | "prep";
  atticCustomItems?: AtticStockCustomItem[];
  prepSite?: string;
  prepGc?: string;
  /** Last issued package items — used to pre-check new / switched colors on a revision. */
  previouslyOrderedItems?: PaintItem[];
  /** When false, stored floor text is omitted from the order list and email. */
  includeItemFloor?: boolean;
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
  staffSuperName = "",
  staffSuperEmail = "",
  staffSuperRoleLabel = "Super",
  foremanName = "",
  foremanEmail = "",
  composeEmailMethod = "gmail",
  mode = "brushout",
  atticCustomItems = [],
  prepSite = "",
  prepGc = "",
  previouslyOrderedItems = [],
  includeItemFloor = true,
  onClose,
}: Props) {
  const isAtticStock = mode === "attic_stock";
  const isPrep = mode === "prep";
  const showItemPicker = !isAtticStock;
  const atticPaintItems = items as AtticStockPaintItem[];
  const paintItems = items as PaintItem[];

  const [vendorIdx, setVendorIdx] = useState<number | "">("");
  const [subject] = useState(() => {
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
    const pushUnique = (email: string) => {
      const addr = email.trim();
      if (addr && !list.includes(addr)) list.push(addr);
    };
    pushUnique(foremanEmail);
    pushUnique(staffSuperEmail);
    const superAddr = superEmail.trim();
    if (includeSuperCc) pushUnique(superAddr);
    return list;
  }, [foremanEmail, staffSuperEmail, includeSuperCc, superEmail]);

  const colorRows = useMemo(
    () =>
      paintItems
        .map((item, index) => ({
          item,
          index,
          line: brushoutColorLine(includeItemFloor ? item : { ...item, floor: "" }),
          status: brushoutOrderLineStatus(item, previouslyOrderedItems),
        }))
        .filter((row) => row.line),
    [paintItems, previouslyOrderedItems, includeItemFloor],
  );

  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultBrushoutOrderSelection(paintItems, previouslyOrderedItems),
  );

  useEffect(() => {
    setSelected(defaultBrushoutOrderSelection(paintItems, previouslyOrderedItems));
  }, [paintItems, previouslyOrderedItems]);

  const orderItems = useMemo(() => {
    const picked = showItemPicker ? paintItems.filter((_, index) => selected.has(index)) : paintItems;
    if (includeItemFloor) return picked;
    return picked.map((item) => ({ ...item, floor: "" }));
  }, [paintItems, selected, showItemPicker, includeItemFloor]);

  function toggleColor(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectPreset(mode: "all" | "changes" | "none") {
    if (mode === "none") {
      setSelected(new Set());
      return;
    }
    if (mode === "all") {
      setSelected(new Set(colorRows.map((row) => row.index)));
      return;
    }
    setSelected(
      new Set(
        colorRows
          .filter((row) => row.status === "new" || row.status === "switched")
          .map((row) => row.index),
      ),
    );
  }

  const hasPreviousOrder = previouslyOrderedItems.some((item) => item.color.trim());
  const selectedCount = colorRows.filter((row) => selected.has(row.index)).length;

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
          orderItems,
          defaultQty,
          activeSignature,
        );
      }
      return buildVendorEmailPlainBody(
        vendor,
        jobNumber,
        jobName,
        orderItems,
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
      orderItems,
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
          orderItems,
          defaultQty,
          activeSignature,
          effectiveLogoUrl,
        );
      }
      return buildVendorEmailHtmlBody(
        vendor,
        jobNumber,
        jobName,
        orderItems,
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
      orderItems,
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

        <label className="check">
          <input
            type="checkbox"
            checked={includeSignature}
            onChange={(e) => setIncludeSignature(e.target.checked)}
          />
          Include signature
        </label>

        {(superEmail.trim() || staffSuperEmail.trim() || foremanEmail.trim()) && (
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
            {staffSuperEmail.trim() ? (
              <label className="check">
                <input type="checkbox" checked disabled readOnly />
                {staffSuperName.trim()
                  ? `${staffSuperName.trim()} (${staffSuperEmail.trim()})`
                  : staffSuperEmail.trim()}{" "}
                — {staffSuperRoleLabel}
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

        {showItemPicker && (
          <fieldset className="stack">
            <legend className="paint-col-head">
              Colors in this order ({selectedCount} of {colorRows.length})
            </legend>
            <div className="row-gap wrap brushouts-send-presets">
              {hasPreviousOrder ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectPreset("changes")}>
                  New &amp; switched
                </button>
              ) : null}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectPreset("all")}>
                All
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectPreset("none")}>
                None
              </button>
            </div>
            <div className="brushouts-send-list" role="list">
              {colorRows.length === 0 ? (
                <p className="muted small">No paint colors on this list yet.</p>
              ) : (
                colorRows.map(({ index, item, line, status }) => (
                  <label key={`brushout-color-${index}`} className="brushouts-send-row check" role="listitem">
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggleColor(index)}
                    />
                    <span className="brushouts-send-row-main">
                      <span className="brushouts-send-label">
                        {item.label.trim() || `Row ${index + 1}`}
                        {item.floor.trim() ? ` · ${item.floor.trim()}` : ""}
                      </span>
                      <span className="brushouts-send-color muted small">{line}</span>
                    </span>
                    {hasPreviousOrder ? <span className={orderStatusClass(status)}>{ORDER_STATUS_LABEL[status]}</span> : null}
                  </label>
                ))
              )}
            </div>
          </fieldset>
        )}

        {isAtticStock ? (
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
        ) : (
          <p className="muted small">
            Formatted HTML is copied automatically — compose opens <strong>empty</strong>. Click in the body and press{" "}
            <strong>Ctrl+V</strong> for tables{includeSignature ? " and signature" : ""}. Use <strong>Copy HTML</strong>{" "}
            to copy again.
          </p>
        )}

        {message && <div className="banner banner-ok">{message}</div>}

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!vendor || openingGmail || (showItemPicker && selectedCount === 0)}
            onClick={() => void openCompose()}
          >
            {openingGmail ? "Opening…" : composeEmailButtonLabel(composeEmailMethod)}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!vendor || (showItemPicker && selectedCount === 0)} onClick={() => void copyHtml()}>
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
