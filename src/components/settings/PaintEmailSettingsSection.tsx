import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { patchUserSettings } from "../../lib/budgetLibrary";
import { buildEmailSignatureHtml, SIGNATURE_FONT_SIZE_OPTIONS, SIGNATURE_LINE_COUNT } from "../../lib/emailSignature";
import type { SignatureLineStyle } from "../../lib/emailSignature";
import {
  loadPaintUserSettings,
  type PaintUserSettings,
  type SuperEmail,
} from "../../lib/paintUserSettings";
import type { PaintVendor } from "../../lib/paintVendorEmail";

function emptyVendor(): PaintVendor {
  return { name: "", brand: "PPG", vendor_email: "", store_email: "" };
}

function emptySuper(): SuperEmail {
  return { name: "", email: "" };
}

export function PaintEmailSettingsSection() {
  const { user } = useAuth();
  const { settings: letterhead } = useLetterhead();
  const [data, setData] = useState<PaintUserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadPaintUserSettings(user.id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load paint settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <p className="muted">Loading paint &amp; email settings…</p>;
  if (!data || !user?.id) return null;

  const signaturePreview = buildEmailSignatureHtml(data.signature, letterhead.logo_url);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user?.id || !data) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await patchUserSettings(user.id, {
      vendors: data.vendors.filter((v) => v.vendor_email.trim()),
      super_emails: data.super_emails.filter((s) => s.email.trim()),
      default_brushout_qty: data.default_brushout_qty,
      signature: data.signature,
    });
    setSaving(false);
    if (err) setError(err);
    else setMessage("Paint vendors, super emails, and signature saved.");
  }

  function setVendor(i: number, patch: Partial<PaintVendor>) {
    setData((d) => {
      if (!d) return d;
      const vendors = [...d.vendors];
      vendors[i] = { ...vendors[i]!, ...patch };
      return { ...d, vendors };
    });
  }

  function setSuper(i: number, patch: Partial<SuperEmail>) {
    setData((d) => {
      if (!d) return d;
      const super_emails = [...d.super_emails];
      super_emails[i] = { ...super_emails[i]!, ...patch };
      return { ...d, super_emails };
    });
  }

  function setSignatureLine(i: number, value: string) {
    setData((d) => {
      if (!d) return d;
      const lines = [...d.signature.lines];
      lines[i] = value;
      return { ...d, signature: { ...d.signature, lines } };
    });
  }

  function setLineStyle(i: number, patch: Partial<SignatureLineStyle>) {
    setData((d) => {
      if (!d) return d;
      const line_styles = [...d.signature.line_styles];
      line_styles[i] = { ...line_styles[i], ...patch };
      return { ...d, signature: { ...d.signature, line_styles } };
    });
  }

  return (
    <form className="stack paint-email-settings" onSubmit={(e) => void onSave(e)}>
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>Paint vendors</h2>
        <p className="muted small">
          Used when you click <strong>Email vendor</strong> on paint submittals. Saved to your account
          (overrides the default vendors.json list).
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Brand</th>
                <th>Vendor email</th>
                <th>Store email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v, i) => (
                <tr key={`vendor-${i}`}>
                  <td>
                    <input value={v.name} onChange={(e) => setVendor(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input value={v.brand} onChange={(e) => setVendor(i, { brand: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={v.vendor_email}
                      onChange={(e) => setVendor(i, { vendor_email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={v.store_email ?? ""}
                      onChange={(e) => setVendor(i, { store_email: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setData((d) =>
                          d ? { ...d, vendors: d.vendors.filter((_, j) => j !== i) } : d,
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setData((d) => (d ? { ...d, vendors: [...d.vendors, emptyVendor()] } : d))}
        >
          Add vendor
        </button>
      </section>

      <section className="stack">
        <h2>Super email list (CC)</h2>
        <p className="muted small">
          Shown as CC checkboxes when emailing a paint vendor. Job superintendent names are auto-selected
          when they match.
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.super_emails.map((s, i) => (
                <tr key={`super-${i}`}>
                  <td>
                    <input value={s.name} onChange={(e) => setSuper(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={s.email}
                      onChange={(e) => setSuper(i, { email: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setData((d) =>
                          d
                            ? { ...d, super_emails: d.super_emails.filter((_, j) => j !== i) }
                            : d,
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            setData((d) => (d ? { ...d, super_emails: [...d.super_emails, emptySuper()] } : d))
          }
        >
          Add super email
        </button>
      </section>

      <section className="stack">
        <h2>Brush-out defaults</h2>
        <label className="paint-qty-label">
          Default brush-out quantity (regular requests)
          <input
            type="number"
            min={1}
            max={99}
            value={data.default_brushout_qty}
            onChange={(e) =>
              setData((d) =>
                d ? { ...d, default_brushout_qty: Math.max(1, Number(e.target.value) || 1) } : d,
              )
            }
          />
        </label>
      </section>

      <section className="stack">
        <h2>HTML email signature</h2>
        <p className="muted small">
          Appended to vendor brush-out emails. Logo uses your letterhead logo URL above. For custom HTML,
          replace <code>cid:logo_image</code> with your logo URL or leave it — JobFlow substitutes the
          letterhead logo automatically.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={data.signature.use_custom_html}
            onChange={(e) =>
              setData((d) =>
                d
                  ? {
                      ...d,
                      signature: { ...d.signature, use_custom_html: e.target.checked },
                    }
                  : d,
              )
            }
          />
          Use custom HTML signature (matches desktop app)
        </label>

        <div className="grid-2">
          <label>
            Logo max width (px)
            <input
              type="number"
              min={80}
              max={600}
              value={data.signature.logo_max_width_px}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          logo_max_width_px: Math.max(80, Math.min(600, Number(e.target.value) || 220)),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
          <label>
            Logo after line #
            <input
              type="number"
              min={0}
              max={SIGNATURE_LINE_COUNT}
              value={data.signature.logo_position}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          logo_position: Math.max(
                            0,
                            Math.min(SIGNATURE_LINE_COUNT, Number(e.target.value) || 0),
                          ),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
          <label>
            Default font
            <select
              value={data.signature.font_family}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d ? { ...d, signature: { ...d.signature, font_family: e.target.value } } : d,
                )
              }
            >
              <option value="Calibri, Arial, sans-serif">Calibri</option>
              <option value="Arial, Helvetica, sans-serif">Arial</option>
              <option value="Times New Roman, Times, serif">Times New Roman</option>
            </select>
          </label>
          <label>
            Default size (pt)
            <input
              type="number"
              min={8}
              max={14}
              value={data.signature.font_size_pt}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          font_size_pt: Math.max(8, Math.min(14, Number(e.target.value) || 11)),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
        </div>

        {data.signature.use_custom_html ? (
          <label>
            Custom HTML
            <textarea
              className="paint-signature-html"
              rows={12}
              value={data.signature.html_body}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? { ...d, signature: { ...d.signature, html_body: e.target.value } }
                    : d,
                )
              }
            />
          </label>
        ) : (
          <div className="stack paint-signature-lines">
            <p className="muted small">
              Set text per line. Use Bold / Italic / Size overrides per line (size 0 = default{" "}
              {data.signature.font_size_pt} pt).
            </p>
            <div className="paint-settings-table-wrap">
              <table className="paint-settings-table paint-signature-style-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Line text</th>
                    <th>Bold</th>
                    <th>Italic</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signature.lines.map((line, i) => {
                    const style = data.signature.line_styles[i] ?? {};
                    return (
                      <tr key={`sig-line-${i}`}>
                        <td>{i + 1}</td>
                        <td>
                          <input value={line} onChange={(e) => setSignatureLine(i, e.target.value)} />
                        </td>
                        <td className="paint-sig-style-cell">
                          <input
                            type="checkbox"
                            checked={Boolean(style.bold)}
                            onChange={(e) => setLineStyle(i, { bold: e.target.checked })}
                          />
                        </td>
                        <td className="paint-sig-style-cell">
                          <input
                            type="checkbox"
                            checked={Boolean(style.italic)}
                            onChange={(e) => setLineStyle(i, { italic: e.target.checked })}
                          />
                        </td>
                        <td>
                          <select
                            value={style.font_size_pt ?? 0}
                            onChange={(e) =>
                              setLineStyle(i, { font_size_pt: Number(e.target.value) })
                            }
                          >
                            {SIGNATURE_FONT_SIZE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="paint-email-preview-box">
          <p className="paint-col-head">Signature preview</p>
          <div
            className="paint-email-html-preview"
            dangerouslySetInnerHTML={{ __html: signaturePreview }}
          />
        </div>
      </section>

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save paint & email settings"}
      </button>
    </form>
  );
}
