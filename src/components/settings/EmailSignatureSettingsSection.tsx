import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { patchUserSettings } from "../../lib/budgetLibrary";
import {
  buildEmailSignatureHtml,
  SIGNATURE_FONT_SIZE_OPTIONS,
  SIGNATURE_LINE_COUNT,
} from "../../lib/emailSignature";
import { uploadEmailSignatureLogo } from "../../lib/letterheadSettings";
import type { SignatureLineStyle } from "../../lib/emailSignature";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { usePaintSettingsData } from "./paintSettingsShared";

export function EmailSignatureSettingsSection({
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { settings: letterhead } = useLetterhead();
  const {
    user,
    data,
    setData,
    loading,
    error,
    setError,
    ready,
    markSaved,
    getIsDirty,
    discard,
  } = usePaintSettingsData(onDirtyChange);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [signatureLogoUploading, setSignatureLogoUploading] = useState(false);
  const signatureLogoFileRef = useRef<HTMLInputElement>(null);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data) return false;
    setSaving(true);
    setMessage(null);
    setError(null);

    const err = await patchUserSettings(user.id, { signature: data.signature });
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    markSaved();
    setMessage("Email signature saved.");
    return true;
  }, [data, markSaved, setError, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({ save: persist, discard, getIsDirty });
  }, [ready, onBindActions, persist, discard, getIsDirty]);

  if (loading) return <p className="muted">Loading email signature…</p>;
  if (!data || !user?.id) return null;

  const signaturePreview = buildEmailSignatureHtml(data.signature, letterhead.logo_url);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
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

  async function onSignatureLogoFile(file: File | null) {
    if (!file || !user?.id) return;
    setSignatureLogoUploading(true);
    setMessage(null);
    setError(null);
    try {
      const url = await uploadEmailSignatureLogo(user.id, file);
      setData((d) =>
        d ? { ...d, signature: { ...d.signature, signature_logo_url: url } } : d,
      );
      setMessage("Email signature logo uploaded. Click Save to keep it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setSignatureLogoUploading(false);
      if (signatureLogoFileRef.current) signatureLogoFileRef.current.value = "";
    }
  }

  return (
    <form className="stack paint-email-settings paint-email-signature-personal" onSubmit={(e) => void onSave(e)}>
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>HTML email signature</h2>
        <p className="muted small">
          Your personal signature — appended to vendor brush-out and paint emails you send. Upload a logo sized
          for email (recommended width matches <strong>Logo max width</strong> below). When empty, the company
          letterhead logo is used. Lines 1–3 default to Profile full name, job title, and phone when blank.
        </p>

        <section className="stack">
          <p className="paint-col-head">Email signature logo</p>
          {(data.signature.signature_logo_url || letterhead.logo_url) && (
            <div className="logo-preview">
              <img
                src={data.signature.signature_logo_url || letterhead.logo_url}
                alt="Email signature logo preview"
              />
            </div>
          )}
          <p className="muted small">
            {data.signature.signature_logo_url
              ? "Using your uploaded email logo."
              : letterhead.logo_url
                ? "No email logo uploaded — preview shows letterhead logo as fallback."
                : "Upload a PNG sized for email (e.g. 220px wide) for reliable Gmail paste."}
          </p>
          <div className="row-gap wrap">
            <input
              ref={signatureLogoFileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onSignatureLogoFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={signatureLogoUploading}
              onClick={() => signatureLogoFileRef.current?.click()}
            >
              {signatureLogoUploading ? "Uploading…" : "Upload email logo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!data.signature.signature_logo_url}
              onClick={() =>
                setData((d) =>
                  d ? { ...d, signature: { ...d.signature, signature_logo_url: "" } } : d,
                )
              }
            >
              Remove email logo
            </button>
          </div>
          <label>
            Or email logo URL
            <input
              value={data.signature.signature_logo_url}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? { ...d, signature: { ...d.signature, signature_logo_url: e.target.value } }
                    : d,
                )
              }
              placeholder="https://… or leave blank for letterhead logo"
            />
          </label>
        </section>

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
              Line 1 = full name, line 2 = job title, line 3 = phone (from Profile when empty). Bold /
              Italic / Size overrides per line (size 0 = default {data.signature.font_size_pt} pt).
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
        {saving ? "Saving…" : "Save email signature"}
      </button>
    </form>
  );
}
