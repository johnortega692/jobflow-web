import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  /** Job setup Super (ICBI). Checked by default; the user can turn it off. */
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
  const [includeStaffSuperCc, setIncludeStaffSuperCc] = useState(Boolean(staffSuperEmail.trim()));
  const [includeForemanCc, setIncludeForemanCc] = useState(Boolean(foremanEmail.trim()));
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

  useEffect(() => {
    setIncludeStaffSuperCc(Boolean(staffSuperEmail.trim()));
  }, [staffSuperEmail]);

  useEffect(() => {
    setIncludeForemanCc(Boolean(foremanEmail.trim()));
  }, [foremanEmail]);

  const vendor = vendorIdx === "" ? undefined : vendors[vendorIdx];
  const activeSignature = includeSignature ? signature : undefined;
  const ccList = useMemo(() => {
    const list: string[] = [];
    const pushUnique = (email: string) => {
      const addr = email.trim();
      if (addr && !list.includes(addr)) list.push(addr);
    };
    if (includeForemanCc) pushUnique(foremanEmail);
    if (includeStaffSuperCc) pushUnique(staffSuperEmail);
    if (includeSuperCc) pushUnique(superEmail);
    return list;
  }, [foremanEmail, staffSuperEmail, superEmail, includeForemanCc, includeStaffSuperCc, includeSuperCc]);

  const colorRows = useMemo(
    () =>
      paintItems
        .map((item, index) => ({
          item,
          index,
          line: brushoutColorLine(includeItemFloor ? item : { ...item, floor: "" }),
          productLine: [item.product.trim(), item.sheen.trim()].filter(Boolean).join(" · "),
          missingProduct: Boolean(item.color.trim()) && !item.product.trim(),
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
  const missingProductCount = useMemo(
    () => orderItems.filter((item) => item.color.trim() && !item.product.trim()).length,
    [orderItems],
  );

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

  if (!isAtticStock && !isPrep) {
    const ccPeople = [
      foremanEmail.trim()
        ? {
            key: "foreman",
            name: foremanName.trim() || foremanEmail.trim(),
            role: "Foreman",
            on: includeForemanCc,
            toggle: () => setIncludeForemanCc((v) => !v),
          }
        : null,
      staffSuperEmail.trim()
        ? {
            key: "staff-super",
            name: staffSuperName.trim() || staffSuperEmail.trim(),
            role: staffSuperRoleLabel,
            on: includeStaffSuperCc,
            toggle: () => setIncludeStaffSuperCc((v) => !v),
          }
        : null,
      superEmail.trim()
        ? {
            key: "super",
            name: superName.trim() || superEmail.trim(),
            role: superRoleLabel,
            on: includeSuperCc,
            toggle: () => setIncludeSuperCc((v) => !v),
          }
        : null,
    ].filter((person): person is NonNullable<typeof person> => Boolean(person));

    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="modal card ob-dialog"
          role="dialog"
          aria-labelledby="email-vendor-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ob-head">
            <div>
              <h2 id="email-vendor-title">Order brushouts</h2>
              <p>{[jobName.trim() || "Project", "Interior paint"].join(" · ")}</p>
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
          </div>

          {ccPeople.length > 0 ? (
            <div className="ob-field ob-field--cc">
              <span>Cc</span>
              <div className="ob-cc">
                {ccPeople.map((person) => (
                  <button
                    key={person.key}
                    type="button"
                    className={`ob-cc-chip${person.on ? " is-on" : ""}`}
                    aria-pressed={person.on}
                    onClick={person.toggle}
                  >
                    <strong>{person.name}</strong>
                    <span>· {person.role}</span>
                  </button>
                ))}
                <span className="ob-cc-note">from job setup</span>
              </div>
            </div>
          ) : null}

          <section className="ob-colors">
            <div className="ob-colors-head">
              <p>
                <strong>Colors</strong>
                <span>
                  {selectedCount} of {colorRows.length} selected
                </span>
              </p>
              <div className="ob-colors-actions">
                {hasPreviousOrder ? (
                  <button type="button" onClick={() => selectPreset("changes")}>
                    New &amp; switched
                  </button>
                ) : null}
                <button type="button" onClick={() => selectPreset("all")}>
                  Select all
                </button>
                <button type="button" onClick={() => selectPreset("none")}>
                  None
                </button>
              </div>
            </div>
            <div className="ob-color-list" role="list">
              {colorRows.length === 0 ? (
                <p className="muted small">No paint colors on this list yet.</p>
              ) : (
                colorRows.map(({ index, item, productLine, missingProduct, status }) => (
                  <label key={`brushout-color-${index}`} className="ob-color" role="listitem">
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggleColor(index)}
                    />
                    <span className="ob-letter">{item.label.trim() || "•"}</span>
                    <span className="ob-color-copy">
                      <span className="ob-color-name">{item.color.trim() || "Color"}</span>
                      <span className={`ob-color-meta${missingProduct ? " is-missing" : ""}`}>
                        {missingProduct ? "Missing product" : productLine || "No product / sheen"}
                      </span>
                    </span>
                    {hasPreviousOrder ? <span className={orderStatusClass(status)}>{ORDER_STATUS_LABEL[status]}</span> : null}
                  </label>
                ))
              )}
            </div>
          </section>

          {missingProductCount > 0 ? (
            <div className="banner banner-warn">
              {missingProductCount} selected color{missingProductCount === 1 ? "" : "s"}{" "}
              {missingProductCount === 1 ? "has" : "have"} no product. The vendor email will show a blank Product
              column for {missingProductCount === 1 ? "that row" : "those rows"}.
            </div>
          ) : null}

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

          <div className="ob-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M4 16V6a2 2 0 0 1 2-2h10" />
            </svg>
            <p>
              The order table is copied for you. When your mail app opens, click in the body and press <kbd>Ctrl+V</kbd>.
            </p>
          </div>

          {message ? <div className="banner banner-ok">{message}</div> : null}

          <div className="ob-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!vendor || (selectedCount === 0)}
              onClick={() => void copyHtml()}
            >
              Copy HTML
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!vendor || openingGmail || selectedCount === 0}
              onClick={() => void openCompose()}
            >
              {openingGmail ? "Opening…" : composeEmailButtonLabel(composeEmailMethod)}
            </button>
          </div>
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
                <input
                  type="checkbox"
                  checked={includeForemanCc}
                  onChange={(e) => setIncludeForemanCc(e.target.checked)}
                />
                {foremanName.trim()
                  ? `${foremanName.trim()} (${foremanEmail.trim()})`
                  : foremanEmail.trim()}{" "}
                — foreman
              </label>
            ) : null}
            {staffSuperEmail.trim() ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeStaffSuperCc}
                  onChange={(e) => setIncludeStaffSuperCc(e.target.checked)}
                />
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
                colorRows.map(({ index, line, productLine, missingProduct, status }) => (
                  <label key={`brushout-color-${index}`} className="brushouts-send-row check" role="listitem">
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggleColor(index)}
                    />
                    <span className="brushouts-send-row-main">
                      <span className="brushouts-send-color">{line}</span>
                      <span
                        className={`brushouts-send-meta${missingProduct ? " brushouts-send-meta--missing" : ""}`}
                      >
                        {missingProduct ? "Missing product" : productLine || "No product / sheen"}
                      </span>
                    </span>
                    {hasPreviousOrder ? <span className={orderStatusClass(status)}>{ORDER_STATUS_LABEL[status]}</span> : null}
                  </label>
                ))
              )}
            </div>
          </fieldset>
        )}

        {missingProductCount > 0 ? (
          <div className="banner banner-warn">
            {missingProductCount} selected color{missingProductCount === 1 ? "" : "s"}{" "}
            {missingProductCount === 1 ? "has" : "have"} no product. The vendor email will show a blank Product
            column for {missingProductCount === 1 ? "that row" : "those rows"}.
          </div>
        ) : null}

        {vendor && isAtticStock ? (
          <div className="stack">
            <p className="paint-col-head">Message preview</p>
            <div
              className="paint-email-html-preview paint-email-html-preview--full"
              dangerouslySetInnerHTML={{ __html: htmlBody }}
            />
          </div>
        ) : null}

        {vendor ? (
          <p className="muted small">
            Formatted HTML is copied automatically — compose opens <strong>empty</strong>. Click in the body and press{" "}
            <strong>Ctrl+V</strong> for tables{includeSignature ? " and signature" : ""}. Use <strong>Copy HTML</strong>{" "}
            to copy again.
          </p>
        ) : isAtticStock ? (
          <p className="muted small">Select a vendor to preview the email table, including Product and Sheen.</p>
        ) : (
          <p className="muted small">Select a vendor to build the email.</p>
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
