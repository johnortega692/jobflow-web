import { FormEvent, useCallback, useEffect, useState } from "react";
import { patchOrgSettings, patchUserSettings } from "../../lib/budgetLibrary";
import type { PaintVendor } from "../../lib/paintVendorEmail";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import { MailtoSetupHelp } from "./MailtoSetupHelp";
import { usePaintSettingsData } from "./paintSettingsShared";

function emptyVendor(): PaintVendor {
  return { name: "", brand: "PPG", vendor_email: "", store_email: "" };
}

export function PaintVendorsSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
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

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data) return false;
    setSaving(true);
    setMessage(null);
    setError(null);

    if (!readOnly) {
      const errOrg = await patchOrgSettings(user.id, {
        vendors: data.vendors.filter((v) => v.vendor_email.trim()),
        default_brushout_qty: data.default_brushout_qty,
      });
      if (errOrg) {
        setSaving(false);
        setError(errOrg);
        return false;
      }
    }

    const errUser = await patchUserSettings(user.id, {
      compose_email_method: data.compose_email_method,
    });
    setSaving(false);
    if (errUser) {
      setError(errUser);
      return false;
    }
    markSaved();
    setMessage(readOnly ? "Compose email preference saved." : "Paint vendor settings saved.");
    return true;
  }, [data, markSaved, readOnly, setError, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({ save: persist, discard, getIsDirty });
  }, [ready, onBindActions, persist, discard, getIsDirty]);

  if (loading) return <p className="muted">Loading paint vendor settings…</p>;
  if (!data || !user?.id) return null;

  function setVendor(i: number, patch: Partial<PaintVendor>) {
    setData((d) => {
      if (!d) return d;
      const vendors = [...d.vendors];
      vendors[i] = { ...vendors[i]!, ...patch };
      return { ...d, vendors };
    });
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  return (
    <form className="stack paint-email-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>Compose email</h2>
        <p className="muted small">
          How <strong>Order Brushouts</strong>, transmittal relay, and sample-order emails open on your computer.
          Saved to your account.
        </p>
        <label>
          Open compose with
          <select
            className="paint-field-select"
            value={data.compose_email_method}
            onChange={(e) =>
              setData((d) =>
                d
                  ? { ...d, compose_email_method: e.target.value === "mailto" ? "mailto" : "gmail" }
                  : d,
              )
            }
          >
            <option value="gmail">Gmail (new browser tab)</option>
            <option value="mailto">Windows default mail app (MAILTO)</option>
          </select>
        </label>
        <MailtoSetupHelp method={data.compose_email_method} />
      </section>

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
        <section className="stack">
          <h2>Paint vendors</h2>
          <p className="muted small">
            Used when you click <strong>Order Brushouts</strong> on paint submittals, transmittals, and brush-out
            requests. Uses your <strong>Compose email</strong> choice above. Shared company list (admin
            edits); overrides the default vendors.json list.
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
      </fieldset>

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save paint vendor settings"}
      </button>
    </form>
  );
}
