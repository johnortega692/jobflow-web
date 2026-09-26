import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { patchUserSettings } from "../../lib/budgetLibrary";
import {
  buildEmailSignatureHtml,
  isSignatureDividerLine,
  SIGNATURE_DIVIDER_HTML,
  SIGNATURE_LINE_COUNT,
  type EmailSignatureSettings,
  type SignatureLineStyle,
} from "../../lib/emailSignature";
import { uploadEmailSignatureLogo } from "../../lib/letterheadSettings";
import { profileFromSettings } from "../../lib/userProfile";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { usePaintSettingsData } from "./paintSettingsShared";

const FONT_OPTIONS = [
  { label: "Calibri", value: "Calibri, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times New Roman", value: "Times New Roman, Times, serif" },
];

const PROFILE_PLACEHOLDERS = ["Full name", "Job title", "Phone"];
const BASE_SIZES = [8, 9, 10, 11, 12, 13, 14];

type SigItem = { kind: "line"; index: number } | { kind: "logo" };

function logoFileLabel(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const path = /^https?:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
    const name = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
    return name.split("?")[0] || "logo";
  } catch {
    return "logo";
  }
}

function intrinsicEnd(sig: EmailSignatureSettings): number {
  let last = 2;
  sig.lines.forEach((line, i) => {
    if (line.trim()) last = i;
  });
  return Math.min(SIGNATURE_LINE_COUNT - 1, last);
}

function buildItems(sig: EmailSignatureSettings, through: number): SigItem[] {
  const last = Math.min(SIGNATURE_LINE_COUNT - 1, Math.max(intrinsicEnd(sig), through, 2));
  const items: SigItem[] = [];
  let placed = false;
  for (let i = 0; i <= last; i++) {
    if (sig.logo_position === i) {
      items.push({ kind: "logo" });
      placed = true;
    }
    items.push({ kind: "line", index: i });
  }
  if (!placed) items.push({ kind: "logo" });
  return items;
}

function commitItems(items: SigItem[], sig: EmailSignatureSettings, openText: Set<number>) {
  const lines = Array(SIGNATURE_LINE_COUNT).fill("");
  const line_styles: SignatureLineStyle[] = Array.from({ length: SIGNATURE_LINE_COUNT }, () => ({}));
  const nextOpen = new Set<number>();
  let logo_position = SIGNATURE_LINE_COUNT;
  let n = 0;
  for (const item of items) {
    if (item.kind === "logo") {
      logo_position = n;
      continue;
    }
    if (n >= SIGNATURE_LINE_COUNT) continue;
    lines[n] = sig.lines[item.index] ?? "";
    line_styles[n] = { ...(sig.line_styles[item.index] ?? {}) };
    if (openText.has(item.index)) nextOpen.add(n);
    n += 1;
  }
  return {
    lines,
    line_styles,
    logo_position,
    openText: nextOpen,
    through: Math.max(2, n - 1),
  };
}

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
  const [logoUrlOpen, setLogoUrlOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [shownThrough, setShownThrough] = useState(2);
  const [openText, setOpenText] = useState<Set<number>>(() => new Set());
  const signatureLogoFileRef = useRef<HTMLInputElement>(null);
  const logoUrlRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

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
    setMessage(null);
    return true;
  }, [data, markSaved, setError, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({ save: persist, discard, getIsDirty });
  }, [ready, onBindActions, persist, discard, getIsDirty]);

  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setShownThrough(intrinsicEnd(data.signature));
  }, [data]);

  useEffect(() => {
    if (!logoUrlOpen) return;
    logoUrlRef.current?.focus();
  }, [logoUrlOpen]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  if (loading) return <p className="muted">Loading email signature…</p>;
  if (!data || !user?.id) return null;

  const signature = data.signature;
  const profile = profileFromSettings(letterhead);
  const signaturePreview = buildEmailSignatureHtml(signature, letterhead.logo_url);
  const logoSrc = signature.signature_logo_url || letterhead.logo_url;
  const fontLabel = FONT_OPTIONS.find((font) => font.value === signature.font_family)?.label ?? "Calibri";
  const items = buildItems(signature, shownThrough);
  const lineItems = items.filter((item) => item.kind === "line");

  function updateSignature(patch: Partial<EmailSignatureSettings>) {
    setData((d) => (d ? { ...d, signature: { ...d.signature, ...patch } } : d));
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

  function applyCommit(nextItems: SigItem[]) {
    const committed = commitItems(nextItems, signature, openText);
    updateSignature({
      lines: committed.lines,
      line_styles: committed.line_styles,
      logo_position: committed.logo_position,
    });
    setOpenText(committed.openText);
    setShownThrough(committed.through);
  }

  function moveItem(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    applyCommit(next);
  }

  function removeLine(index: number) {
    if (lineItems.length <= 3) return;
    applyCommit(items.filter((item) => !(item.kind === "line" && item.index === index)));
  }

  function currentEnd(): number {
    return Math.min(SIGNATURE_LINE_COUNT - 1, Math.max(intrinsicEnd(signature), shownThrough, 2));
  }

  function addTextLine() {
    const next = currentEnd() + 1;
    if (next >= SIGNATURE_LINE_COUNT) {
      setError("Signature is full (15 lines). Remove a line first.");
      return;
    }
    setError(null);
    setShownThrough(next);
    setOpenText((prev) => new Set(prev).add(next));
  }

  function addBlankLine() {
    const next = currentEnd() + 1;
    if (next >= SIGNATURE_LINE_COUNT) {
      setError("Signature is full (15 lines). Remove a line first.");
      return;
    }
    setError(null);
    setShownThrough(next);
    setOpenText((prev) => {
      const copy = new Set(prev);
      copy.delete(next);
      return copy;
    });
  }

  function addDivider() {
    const next = currentEnd() + 1;
    if (next >= SIGNATURE_LINE_COUNT) {
      setError("Signature is full (15 lines). Remove a line first.");
      return;
    }
    setError(null);
    setSignatureLine(next, SIGNATURE_DIVIDER_HTML);
    setShownThrough(next);
  }

  async function onSignatureLogoFile(file: File | null) {
    if (!file || !user?.id) return;
    setSignatureLogoUploading(true);
    setMessage(null);
    setError(null);
    try {
      const url = await uploadEmailSignatureLogo(user.id, file);
      updateSignature({ signature_logo_url: url });
      setMessage("Email logo uploaded. Save to keep it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setSignatureLogoUploading(false);
      if (signatureLogoFileRef.current) signatureLogoFileRef.current.value = "";
    }
  }

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(signaturePreview);
      setCopyNote("HTML copied.");
      window.setTimeout(() => setCopyNote(null), 2000);
    } catch {
      setError("Could not copy the signature HTML.");
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  return (
    <>
      <form className="stack plh-form" onSubmit={(e) => void onSave(e)}>
        {(error || message) && (
          <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
        )}

        <div className="sig-intro-row">
          <p className="muted">Appended to vendor brush-out and paint emails you send.</p>
          <div className="sig-actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setPreviewOpen(true)}>
              Preview
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void copyHtml()}>
              {copyNote ?? "Copy HTML"}
            </button>
          </div>
        </div>

        <section className="plh-card">
          <div className="plh-card-head">
            <div>
              <h2>Style &amp; logo</h2>
              <p>Build it line by line, or paste the HTML from the desktop app.</p>
            </div>
            <div className="sig-mode" role="group" aria-label="Signature style">
              <button
                type="button"
                className={signature.use_custom_html ? "" : "is-on"}
                aria-pressed={!signature.use_custom_html}
                onClick={() => updateSignature({ use_custom_html: false })}
              >
                Line builder
              </button>
              <button
                type="button"
                className={signature.use_custom_html ? "is-on" : ""}
                aria-pressed={signature.use_custom_html}
                onClick={() => updateSignature({ use_custom_html: true })}
              >
                Custom HTML
              </button>
            </div>
          </div>

          <div className="sig-style-panel">
            <div className="sig-style-logo">
              <div className="sig-style-logo-top">
                <div className="plh-logo-preview">
                  {logoSrc ? (
                    <img src={logoSrc} alt="Email signature logo" />
                  ) : (
                    <span className="plh-logo-placeholder">[Email logo]</span>
                  )}
                </div>
                <div className="plh-logo-meta">
                  <p className="sig-logo-kicker">Email logo</p>
                  <p className="plh-logo-file">
                    {signature.signature_logo_url ? (
                      <>
                        {logoFileLabel(signature.signature_logo_url)}
                        <span> · uploaded</span>
                      </>
                    ) : letterhead.logo_url ? (
                      "Using your letterhead logo"
                    ) : (
                      "No logo yet"
                    )}
                  </p>
                  <div className="plh-logo-actions">
                    <input
                      ref={signatureLogoFileRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void onSignatureLogoFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-accent btn-small"
                      disabled={signatureLogoUploading}
                      onClick={() => signatureLogoFileRef.current?.click()}
                    >
                      {signatureLogoUploading ? "Uploading…" : signature.signature_logo_url ? "Replace" : "Upload"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small plh-btn-remove"
                      disabled={!signature.signature_logo_url}
                      onClick={() => updateSignature({ signature_logo_url: "" })}
                    >
                      Remove
                    </button>
                  </div>
                  {logoUrlOpen ? (
                    <input
                      ref={logoUrlRef}
                      className="plh-logo-url"
                      value={signature.signature_logo_url}
                      aria-label="Email logo image URL"
                      placeholder="https://… or /logo.png"
                      onChange={(e) => updateSignature({ signature_logo_url: e.target.value })}
                    />
                  ) : (
                    <button type="button" className="plh-url-link" onClick={() => setLogoUrlOpen(true)}>
                      Use an image URL instead
                    </button>
                  )}
                  <p className="plh-hint">Falls back to your letterhead logo when removed.</p>
                </div>
              </div>
            </div>
            <div className="sig-style-type">
              <label>
                Font
                <select
                  value={signature.font_family}
                  disabled={signature.use_custom_html}
                  onChange={(e) => updateSignature({ font_family: e.target.value })}
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                  {!FONT_OPTIONS.some((font) => font.value === signature.font_family) ? (
                    <option value={signature.font_family}>{signature.font_family}</option>
                  ) : null}
                </select>
              </label>
              <label>
                Base size
                <select
                  value={signature.font_size_pt}
                  disabled={signature.use_custom_html}
                  onChange={(e) => updateSignature({ font_size_pt: Number(e.target.value) })}
                >
                  {BASE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} pt
                    </option>
                  ))}
                </select>
              </label>
              <label className="sig-logo-width">
                Logo width
                <span className="sig-width">
                  <input
                    type="number"
                    min={40}
                    max={600}
                    value={signature.logo_max_width_px}
                    onChange={(e) =>
                      updateSignature({
                        logo_max_width_px: Math.max(40, Math.min(600, Number(e.target.value) || 220)),
                      })
                    }
                  />
                  <span>px</span>
                </span>
              </label>
            </div>
          </div>

          {signature.use_custom_html ? (
            <label>
              Custom HTML
              <textarea
                className="paint-signature-html"
                rows={12}
                value={signature.html_body}
                onChange={(e) => updateSignature({ html_body: e.target.value })}
              />
            </label>
          ) : null}
        </section>

        {signature.use_custom_html ? null : (
          <section className="plh-card">
            <div className="plh-card-head">
              <div>
                <h2>Lines</h2>
                <p>Move the logo and dividers like any other line. Profile lines fill in when left blank.</p>
              </div>
            </div>
            <div className="sig-lines">
              {items.map((item, itemIndex) => {
                if (item.kind === "logo") {
                  return (
                    <div className="sig-row" key="sig-logo">
                      <MoveButtons
                        first={itemIndex === 0}
                        last={itemIndex === items.length - 1}
                        onUp={() => moveItem(itemIndex, -1)}
                        onDown={() => moveItem(itemIndex, 1)}
                      />
                      <p className="sig-block-label">Email logo</p>
                    </div>
                  );
                }

                const line = signature.lines[item.index] ?? "";
                const style = signature.line_styles[item.index] ?? {};
                const divider = isSignatureDividerLine(line);
                const blank = !line.trim() && item.index >= 3 && !openText.has(item.index);
                return (
                  <div className="sig-row" key={`sig-line-${item.index}`}>
                    <MoveButtons
                      first={itemIndex === 0}
                      last={itemIndex === items.length - 1}
                      onUp={() => moveItem(itemIndex, -1)}
                      onDown={() => moveItem(itemIndex, 1)}
                    />
                    {divider ? (
                      <p className="sig-block-label">Divider line</p>
                    ) : blank ? (
                      <p className="sig-block-label">Blank line</p>
                    ) : (
                      <div className="sig-line-control">
                        {item.index < 3 ? <span className="sig-profile">Profile</span> : null}
                        <input
                          value={line}
                          placeholder={PROFILE_PLACEHOLDERS[item.index] ?? "Line text"}
                          aria-label={PROFILE_PLACEHOLDERS[item.index] ?? `Signature line ${item.index + 1}`}
                          onChange={(e) => setSignatureLine(item.index, e.target.value)}
                        />
                      </div>
                    )}
                    {divider || blank ? null : (
                      <div className="sig-bi">
                        <button
                          type="button"
                          className={style.bold ? "is-on" : ""}
                          aria-pressed={Boolean(style.bold)}
                          aria-label="Bold"
                          onClick={() => setLineStyle(item.index, { bold: !style.bold })}
                        >
                          B
                        </button>
                        <button
                          type="button"
                          className={style.italic ? "is-on" : ""}
                          aria-pressed={Boolean(style.italic)}
                          aria-label="Italic"
                          onClick={() => setLineStyle(item.index, { italic: !style.italic })}
                        >
                          I
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="sig-remove"
                      aria-label="Remove line"
                      disabled={lineItems.length <= 3}
                      onClick={() => removeLine(item.index)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="sig-add">
              <button type="button" className="btn btn-ghost btn-small" onClick={addTextLine}>
                + Text line
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={addDivider}>
                + Divider
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={addBlankLine}>
                + Blank line
              </button>
            </div>
            <p className="plh-hint">
              Profile lines use {profile.name.trim() || "your name"}, {profile.title.trim() || "job title"}, and{" "}
              {profile.phone.trim() || "phone"} when left blank.
            </p>
          </section>
        )}

        <div className="plh-save-bar">
          <span className="muted">{getIsDirty() ? "Unsaved changes" : "All changes saved"}</span>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save email signature"}
          </button>
        </div>
      </form>

      {previewOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPreviewOpen(false)}>
          <div
            className="modal card stack sig-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sig-preview-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="plh-card-head">
              <div>
                <h2 id="sig-preview-title">Preview</h2>
                <p>
                  Shown at real size in {fontLabel} {signature.font_size_pt} pt, as vendors will see it.
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPreviewOpen(false)}>
                Close
              </button>
            </div>
            <div className="sig-mail">
              <p className="sig-mail-meta">
                <span>To</span> vendor@example.com
              </p>
              <p className="sig-mail-meta">
                <span>Subject</span> Brush-out request · Project
              </p>
              <p className="sig-mail-body">Email body</p>
              <div className="paint-email-html-preview sig-preview-html" dangerouslySetInnerHTML={{ __html: signaturePreview }} />
            </div>
            <div className="sig-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void copyHtml()}>
                {copyNote ?? "Copy HTML"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MoveButtons({
  first,
  last,
  onUp,
  onDown,
}: {
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="sig-move">
      <button type="button" aria-label="Move up" disabled={first} onClick={onUp}>
        ↑
      </button>
      <button type="button" aria-label="Move down" disabled={last} onClick={onDown}>
        ↓
      </button>
    </div>
  );
}
