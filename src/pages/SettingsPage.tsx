import { FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DeliverySettingsSection } from "../components/settings/DeliverySettingsSection";
import { GoogleSheetsSettingsSection } from "../components/settings/GoogleSheetsSettingsSection";
import { PaintEmailSettingsSection } from "../components/settings/PaintEmailSettingsSection";
import { VendorArchitectSettingsSection } from "../components/settings/VendorArchitectSettingsSection";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { profileDisplayLabel } from "../lib/userProfile";
import { uploadLetterheadLogo } from "../lib/letterheadSettings";

export function SettingsPage() {
  const { user } = useAuth();
  const { profile, settings, branding, loading, saving, error, setSettings, setProfile, save } =
    useLetterhead();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const err = await save();
    if (!err) {
      setMessage("Settings saved. Your profile and company info will pre-fill forms and PDFs.");
    }
  }

  async function onLogoFile(file: File | null) {
    if (!file || !user) return;
    setUploading(true);
    setMessage(null);
    try {
      const url = await uploadLetterheadLogo(user.id, file);
      setSettings({ logo_url: url });
      setMessage("Logo uploaded. Click Save settings to keep it.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) return <p className="muted">Loading settings…</p>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Your contact info and company letterhead. Saved once and applied across RFIs, submittals,
            transmittals, and submittal packages.
          </p>
        </div>
        <Link to="/projects" className="btn btn-secondary">
          Back to projects
        </Link>
      </div>

      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <form className="card stack settings-form" onSubmit={(e) => void onSubmit(e)}>
        <section className="stack">
          <h2>Your profile</h2>
          <p className="muted small">
            Used to pre-fill <strong>From</strong> on RFIs, <strong>Prepared by</strong> on submittal
            packages, transmittal <strong>By:</strong> line, and PDF signature blocks.
          </p>
          <div className="grid-2">
            <label>
              Full name
              <input
                value={profile.name}
                onChange={(e) => setProfile({ name: e.target.value })}
                placeholder="John Ortega"
                autoComplete="name"
              />
            </label>
            <label>
              Job title
              <input
                value={profile.title}
                onChange={(e) => setProfile({ title: e.target.value })}
                placeholder="Project Manager"
                autoComplete="organization-title"
              />
            </label>
            <label>
              Phone
              <input
                value={profile.phone}
                onChange={(e) => setProfile({ phone: e.target.value })}
                placeholder="(555) 555-5555"
                autoComplete="tel"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={profile.email}
                onChange={(e) => setProfile({ email: e.target.value })}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </label>
          </div>
        </section>

        <section className="stack">
          <h2>Company &amp; letterhead</h2>
          <p className="muted small">Shown on printed PDF headers, footers, and cover pages.</p>
          <label>
            Company name
            <input
              value={settings.company_name}
              onChange={(e) => setSettings({ company_name: e.target.value })}
              placeholder="Ironwood Commercial Builders"
            />
          </label>
          <label>
            Company address
            <input
              value={settings.company_address}
              onChange={(e) => setSettings({ company_address: e.target.value })}
              placeholder="3953 Industrial Way, Suite E Concord, CA 94520"
            />
          </label>
          <div className="grid-2">
            <label>
              Office phone
              <input
                value={settings.company_phone}
                onChange={(e) => setSettings({ company_phone: e.target.value })}
                placeholder="925-609-8356"
              />
            </label>
            <label>
              License #
              <input
                value={settings.company_license}
                onChange={(e) => setSettings({ company_license: e.target.value })}
                placeholder="89536"
              />
            </label>
          </div>
          <p className="muted small settings-contact-preview">
            Letterhead line: {branding.companyContactLine || "—"}
          </p>
        </section>

        <section className="stack">
          <h2>Logo</h2>
          <p className="muted small">
            Upload an image or paste a URL. Shown at the top of printed PDFs.
          </p>
          {settings.logo_url && (
            <div className="logo-preview">
              <img src={settings.logo_url} alt="Company logo preview" />
            </div>
          )}
          <div className="row-gap">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload logo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!settings.logo_url}
              onClick={() => setSettings({ logo_url: "" })}
            >
              Remove logo
            </button>
          </div>
          <label>
            Or logo URL
            <input
              value={settings.logo_url}
              onChange={(e) => setSettings({ logo_url: e.target.value })}
              placeholder="/logo.png or https://…"
            />
          </label>
        </section>

        <section className="stack settings-preview">
          <h2>Preview</h2>
          <div className="settings-preview-box">
            {branding.logoUrl ? (
              <img className="settings-preview-logo" src={branding.logoUrl} alt="" />
            ) : (
              <strong>{branding.companyName}</strong>
            )}
            <p className="muted small">{branding.companyContactLine || branding.companyInfo}</p>
            <p className="small">
              Thank you,
              <br />
              <br />
              {profileDisplayLabel(profile) || branding.signerName}
              <br />
              {profile.phone || branding.signerPhone}
              <br />
              {profile.email || branding.signerEmail}
            </p>
          </div>
        </section>

        <div className="row-gap">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <div className="card stack settings-form">
        <VendorArchitectSettingsSection />
      </div>

      <div className="card stack settings-form">
        <DeliverySettingsSection />
      </div>

      <div className="card stack settings-form">
        <GoogleSheetsSettingsSection />
      </div>

      <div className="card stack settings-form">
        <PaintEmailSettingsSection />
      </div>
    </div>
  );
}
