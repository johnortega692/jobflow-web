import { FormEvent, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DeliverySettingsSection } from "../components/settings/DeliverySettingsSection";
import { GoogleSheetsSettingsSection } from "../components/settings/GoogleSheetsSettingsSection";
import { ManpowerCalSettingsSection } from "../components/settings/ManpowerCalSettingsSection";
import { PaintCatalogSettingsSection } from "../components/settings/PaintCatalogSettingsSection";
import { PaintEmailSettingsSection } from "../components/settings/PaintEmailSettingsSection";
import { PdfFieldRow } from "../components/settings/PdfFieldRow";
import type { SettingsSectionActions } from "../components/settings/settingsSectionTypes";
import { UnsavedChangesDialog } from "../components/settings/UnsavedChangesDialog";
import { UserApprovalsSettingsSection } from "../components/settings/UserApprovalsSettingsSection";
import { VendorArchitectSettingsSection } from "../components/settings/VendorArchitectSettingsSection";
import { WorkOrderSettingsSection } from "../components/settings/WorkOrderSettingsSection";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { uploadLetterheadLogo } from "../lib/letterheadSettings";
import { pdfSignerDisplayName } from "../lib/printCore";
import { useSettingsDirtyTracker } from "../lib/useSettingsDirtyTracker";
import type { LetterheadPdfVisibility } from "../types/letterheadSettings";

const SETTINGS_TABS = [
  { id: "profile", label: "Profile & letterhead" },
  { id: "users", label: "User approvals", adminOnly: true as const },
  { id: "vendors", label: "Vendors & architects" },
  { id: "delivery", label: "Delivery" },
  { id: "google", label: "Google Sheets", adminOnly: true as const },
  { id: "paint-catalog", label: "Paint products & sheens" },
  { id: "paint-email", label: "Paint & email" },
  { id: "manpower", label: "Manpower" },
  { id: "work-orders", label: "Work orders" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];
type SettingsTabId = SettingsTab["id"];

type PendingLeave =
  | { kind: "tab"; tab: SettingsTabId }
  | { kind: "route"; to: string };

function tabLabel(tabId: SettingsTabId): string {
  return SETTINGS_TABS.find((t) => t.id === tabId)?.label ?? "Settings";
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { user, isAdmin, roleLoading } = useAuth();
  const { profile, settings, branding, loading, saving, error, setSettings, setProfile, save, reload } =
    useLetterhead();
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionActionsRef = useRef<Partial<Record<SettingsTabId, SettingsSectionActions>>>({});
  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");
  const [dirtyTabs, setDirtyTabs] = useState<Partial<Record<SettingsTabId, true>>>({});
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const setTabDirty = useCallback((tab: SettingsTabId, dirty: boolean) => {
    setDirtyTabs((prev) => {
      if (dirty) return prev[tab] ? prev : { ...prev, [tab]: true };
      if (!prev[tab]) return prev;
      const next = { ...prev };
      delete next[tab];
      return next;
    });
  }, []);

  const onProfileDirty = useCallback((dirty: boolean) => setTabDirty("profile", dirty), [setTabDirty]);
  const onVendorsDirty = useCallback((dirty: boolean) => setTabDirty("vendors", dirty), [setTabDirty]);
  const onDeliveryDirty = useCallback((dirty: boolean) => setTabDirty("delivery", dirty), [setTabDirty]);
  const onGoogleDirty = useCallback((dirty: boolean) => setTabDirty("google", dirty), [setTabDirty]);
  const onPaintCatalogDirty = useCallback(
    (dirty: boolean) => setTabDirty("paint-catalog", dirty),
    [setTabDirty],
  );
  const onPaintEmailDirty = useCallback((dirty: boolean) => setTabDirty("paint-email", dirty), [setTabDirty]);
  const onWorkOrdersDirty = useCallback((dirty: boolean) => setTabDirty("work-orders", dirty), [setTabDirty]);

  const profileReady = !loading && Boolean(user);
  const { markSaved: markProfileSaved, getIsDirty: getProfileDirty } = useSettingsDirtyTracker(
    settings,
    profileReady,
    onProfileDirty,
  );

  const bindSectionActions = useCallback((tab: SettingsTabId, actions: SettingsSectionActions) => {
    sectionActionsRef.current[tab] = actions;
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    sectionActionsRef.current.profile = {
      save: async () => {
        setMessage(null);
        const err = await save();
        if (err) return false;
        markProfileSaved();
        setMessage("Settings saved. Your profile and company info will pre-fill forms and PDFs.");
        return true;
      },
      discard: () => reload(),
      getIsDirty: getProfileDirty,
    };
  }, [getProfileDirty, markProfileSaved, profileReady, reload, save]);

  const sharedSettingsReadOnly = !roleLoading && !isAdmin;
  const visibleTabs = SETTINGS_TABS.filter((tab) => !("adminOnly" in tab && tab.adminOnly) || isAdmin);

  useEffect(() => {
    if (!roleLoading && activeTab === "users" && !isAdmin) {
      setActiveTab("profile");
    }
    if (!roleLoading && activeTab === "google" && !isAdmin) {
      setActiveTab("profile");
    }
  }, [activeTab, isAdmin, roleLoading]);

  function isActiveTabDirty(): boolean {
    return sectionActionsRef.current[activeTab]?.getIsDirty() ?? Boolean(dirtyTabs[activeTab]);
  }

  useEffect(() => {
    const hasDirty = Object.keys(dirtyTabs).length > 0;
    if (!hasDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyTabs]);

  function completeLeave(next: PendingLeave) {
    if (next.kind === "tab") {
      setActiveTab(next.tab);
    } else {
      navigate(next.to);
    }
    setPendingLeave(null);
  }

  function requestTabChange(tab: SettingsTabId) {
    if (tab === activeTab) {
      setNavOpen(false);
      return;
    }
    if (isActiveTabDirty()) {
      setPendingLeave({ kind: "tab", tab });
      return;
    }
    setActiveTab(tab);
    setNavOpen(false);
  }

  function onBackClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!isActiveTabDirty()) return;
    e.preventDefault();
    setPendingLeave({ kind: "route", to: "/projects" });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const err = await save();
    if (!err) {
      markProfileSaved();
      setMessage("Settings saved. Your profile and company info will pre-fill forms and PDFs.");
    }
  }

  function setPdfShow(key: keyof LetterheadPdfVisibility, show: boolean) {
    setSettings({ pdf_show: { ...settings.pdf_show, [key]: show } });
  }

  async function onLogoFile(file: File | null) {
    if (!file || !user) return;
    setUploading(true);
    setMessage(null);
    try {
      const url = await uploadLetterheadLogo(user.id, file, { orgShared: isAdmin });
      setSettings({ logo_url: url });
      setMessage("Logo uploaded. Click Save settings to keep it.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDialogSave() {
    const actions = sectionActionsRef.current[activeTab];
    if (!actions) {
      setPendingLeave(null);
      return;
    }
    setDialogSaving(true);
    const ok = await actions.save();
    setDialogSaving(false);
    if (!ok || !pendingLeave) return;
    completeLeave(pendingLeave);
  }

  function onDialogDiscard() {
    const leave = pendingLeave;
    if (!leave) return;
    const actions = sectionActionsRef.current[activeTab];
    void Promise.resolve(actions?.discard()).then(() => completeLeave(leave));
  }

  if (loading) return <p className="muted">Loading settings…</p>;

  const activeTabMeta = visibleTabs.find((t) => t.id === activeTab) ?? visibleTabs[0];

  return (
    <div className="page settings-page">
      <div className="page-header settings-page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Account defaults for letterhead, contacts, integrations, and paint workflows. Each section
            saves independently.
            {!roleLoading && !isAdmin && (
              <>
                {" "}
                Company letterhead and integration sections are shared for everyone. You can edit your
                profile; other sections are view-only unless you are an admin.
              </>
            )}
          </p>
        </div>
        <div className="settings-page-header-actions">
          <button
            type="button"
            className="btn btn-secondary settings-nav-toggle"
            aria-expanded={navOpen}
            aria-controls="settings-sidebar"
            onClick={() => setNavOpen((open) => !open)}
          >
            Sections
          </button>
          <Link to="/projects" className="btn btn-secondary" onClick={onBackClick}>
            Back to projects
          </Link>
        </div>
      </div>

      <div className={`settings-shell${navOpen ? " settings-shell--nav-open" : ""}`}>
        {navOpen && (
          <button
            type="button"
            className="settings-nav-backdrop"
            aria-label="Close settings menu"
            onClick={() => setNavOpen(false)}
          />
        )}

        <aside id="settings-sidebar" className="settings-sidebar" aria-label="Settings sections">
          <nav className="settings-nav">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-nav-item${activeTab === tab.id ? " settings-nav-item--active" : ""}${dirtyTabs[tab.id] ? " settings-nav-item--dirty" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
                onClick={() => requestTabChange(tab.id)}
              >
                <span className="settings-nav-item-label">{tab.label}</span>
                {dirtyTabs[tab.id] ? (
                  <span className="settings-nav-item-dot" aria-label="Unsaved changes" title="Unsaved changes" />
                ) : null}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-main">
          <div className="settings-main-header">
            <h2 className="settings-main-title">{activeTabMeta?.label ?? "Settings"}</h2>
          </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "profile" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "profile"}
      >
        {(error || message) && activeTab === "profile" && (
          <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
        )}

        <form className="stack" onSubmit={(e) => void onSubmit(e)}>
          <section className="stack">
            <h2>Your profile</h2>
            <p className="muted small">
              Used to pre-fill <strong>From</strong> on RFIs, <strong>Prepared by</strong> on
              submittal packages, transmittal <strong>By:</strong> line, and PDF signature blocks.
              Toggle each field to show or hide it on printed PDFs.
            </p>
            <div className="grid-2">
              <PdfFieldRow
                label="Full name"
                showInPdf={settings.pdf_show.signer_name}
                onShowInPdfChange={(show) => setPdfShow("signer_name", show)}
              >
                <input
                  value={profile.name}
                  onChange={(e) => setProfile({ name: e.target.value })}
                  placeholder="John Ortega"
                  autoComplete="name"
                />
              </PdfFieldRow>
              <PdfFieldRow
                label="Job title"
                showInPdf={settings.pdf_show.signer_title}
                onShowInPdfChange={(show) => setPdfShow("signer_title", show)}
              >
                <input
                  value={profile.title}
                  onChange={(e) => setProfile({ title: e.target.value })}
                  placeholder="Project Manager"
                  autoComplete="organization-title"
                />
              </PdfFieldRow>
              <PdfFieldRow
                label="Phone"
                showInPdf={settings.pdf_show.signer_phone}
                onShowInPdfChange={(show) => setPdfShow("signer_phone", show)}
              >
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile({ phone: e.target.value })}
                  placeholder="(555) 555-5555"
                  autoComplete="tel"
                />
              </PdfFieldRow>
              <PdfFieldRow
                label="Email"
                showInPdf={settings.pdf_show.signer_email}
                onShowInPdfChange={(show) => setPdfShow("signer_email", show)}
              >
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ email: e.target.value })}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </PdfFieldRow>
            </div>
          </section>

          {isAdmin ? (
          <>
          <section className="stack">
            <h2>Company &amp; letterhead</h2>
            <p className="muted small">Shown on printed PDF headers, footers, and cover pages.</p>
            <PdfFieldRow
              label="Company name"
              showInPdf={settings.pdf_show.company_name}
              onShowInPdfChange={(show) => setPdfShow("company_name", show)}
            >
              <input
                value={settings.company_name}
                onChange={(e) => setSettings({ company_name: e.target.value })}
                placeholder="Ironwood Commercial Builders"
              />
            </PdfFieldRow>
            <PdfFieldRow
              label="Company address"
              showInPdf={settings.pdf_show.company_address}
              onShowInPdfChange={(show) => setPdfShow("company_address", show)}
            >
              <input
                value={settings.company_address}
                onChange={(e) => setSettings({ company_address: e.target.value })}
                placeholder="3953 Industrial Way, Suite E Concord, CA 94520"
              />
            </PdfFieldRow>
            <div className="grid-2">
              <PdfFieldRow
                label="Office phone"
                showInPdf={settings.pdf_show.company_phone}
                onShowInPdfChange={(show) => setPdfShow("company_phone", show)}
              >
                <input
                  value={settings.company_phone}
                  onChange={(e) => setSettings({ company_phone: e.target.value })}
                  placeholder="925-609-8356"
                />
              </PdfFieldRow>
              <PdfFieldRow
                label="License #"
                showInPdf={settings.pdf_show.company_license}
                onShowInPdfChange={(show) => setPdfShow("company_license", show)}
              >
                <input
                  value={settings.company_license}
                  onChange={(e) => setSettings({ company_license: e.target.value })}
                  placeholder="89536"
                />
              </PdfFieldRow>
            </div>
            <p className="muted small settings-contact-preview">
              Letterhead line: {branding.companyContactLine || "—"}
            </p>
          </section>

          <section className="stack">
            <div className="settings-section-head">
              <h2>Logo</h2>
              <label className="settings-pdf-toggle" title={`${settings.pdf_show.logo ? "Hide" : "Show"} logo in PDF output`}>
                <input
                  type="checkbox"
                  checked={settings.pdf_show.logo}
                  onChange={(e) => setPdfShow("logo", e.target.checked)}
                />
                <span className="settings-pdf-toggle-track" aria-hidden="true">
                  <span className="settings-pdf-toggle-thumb" />
                </span>
                <span className="settings-pdf-toggle-text">
                  {settings.pdf_show.logo ? "Show in PDF" : "Hidden in PDF"}
                </span>
              </label>
            </div>
            <p className="muted small">
              Upload an image or paste a URL. Shown at the top of printed PDFs when enabled.
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
          </>
          ) : (
          <section className="stack">
            <h2>Company letterhead</h2>
            <p className="muted small">
              Shared Ironwood letterhead used on all PDFs. Contact an admin to update company info or
              the logo.
            </p>
            {settings.logo_url ? (
              <div className="logo-preview">
                <img src={settings.logo_url} alt="Company logo" />
              </div>
            ) : null}
            <div className="grid-2">
              <label>
                Company name
                <input value={settings.company_name} readOnly disabled />
              </label>
              <label>
                Office phone
                <input value={settings.company_phone} readOnly disabled />
              </label>
              <label className="grid-span-2">
                Company address
                <input value={settings.company_address} readOnly disabled />
              </label>
              <label>
                License #
                <input value={settings.company_license} readOnly disabled />
              </label>
            </div>
            {branding.companyContactLine ? (
              <p className="muted small settings-contact-preview">
                Letterhead line: {branding.companyContactLine}
              </p>
            ) : null}
          </section>
          )}

          <section className="stack settings-preview">
            <h2>PDF preview</h2>
            <p className="muted small">How your letterhead and signature appear on printed PDFs.</p>
            <div className="settings-preview-box">
              {branding.logoUrl ? (
                <img className="settings-preview-logo" src={branding.logoUrl} alt="" />
              ) : branding.companyName ? (
                <strong>{branding.companyName}</strong>
              ) : null}
              {branding.companyContactLine ? (
                <p className="muted small">{branding.companyContactLine}</p>
              ) : null}
              {(branding.footerName || branding.footerPhone || branding.footerEmail) && (
                <p className="small">
                  Thank you,
                  <br />
                  <br />
                  {pdfSignerDisplayName(branding) || null}
                  {branding.footerPhone ? (
                    <>
                      {pdfSignerDisplayName(branding) ? <br /> : null}
                      {branding.footerPhone}
                    </>
                  ) : null}
                  {branding.footerEmail ? (
                    <>
                      <br />
                      {branding.footerEmail}
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </section>

          <div className="row-gap">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "users" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "users"}
      >
        <UserApprovalsSettingsSection />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "vendors" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "vendors"}
      >
        <VendorArchitectSettingsSection
          readOnly={sharedSettingsReadOnly}
          onDirtyChange={sharedSettingsReadOnly ? undefined : onVendorsDirty}
          onBindActions={(actions) => bindSectionActions("vendors", actions)}
        />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "delivery" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "delivery"}
      >
        <DeliverySettingsSection
          readOnly={sharedSettingsReadOnly}
          onDirtyChange={sharedSettingsReadOnly ? undefined : onDeliveryDirty}
          onBindActions={(actions) => bindSectionActions("delivery", actions)}
        />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "google" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "google"}
      >
        <GoogleSheetsSettingsSection
          onDirtyChange={onGoogleDirty}
          onBindActions={(actions) => bindSectionActions("google", actions)}
        />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "paint-catalog" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "paint-catalog"}
      >
        <PaintCatalogSettingsSection
          readOnly={sharedSettingsReadOnly}
          onDirtyChange={sharedSettingsReadOnly ? undefined : onPaintCatalogDirty}
          onBindActions={(actions) => bindSectionActions("paint-catalog", actions)}
        />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "paint-email" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "paint-email"}
      >
        <PaintEmailSettingsSection
          readOnly={sharedSettingsReadOnly}
          onDirtyChange={onPaintEmailDirty}
          onBindActions={(actions) => bindSectionActions("paint-email", actions)}
        />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "manpower" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "manpower"}
      >
        <ManpowerCalSettingsSection />
      </div>

      <div
        className={`card stack settings-form settings-tab-panel${activeTab === "work-orders" ? "" : " settings-tab-panel--hidden"}`}
        aria-hidden={activeTab !== "work-orders"}
      >
        <WorkOrderSettingsSection
          readOnly={sharedSettingsReadOnly}
          onDirtyChange={sharedSettingsReadOnly ? undefined : onWorkOrdersDirty}
          onBindActions={(actions) => bindSectionActions("work-orders", actions)}
        />
      </div>
        </div>
      </div>

      {pendingLeave && (
        <UnsavedChangesDialog
          tabLabel={tabLabel(activeTab)}
          saving={dialogSaving}
          onSave={() => void onDialogSave()}
          onDiscard={onDialogDiscard}
          onCancel={() => setPendingLeave(null)}
        />
      )}
    </div>
  );
}
