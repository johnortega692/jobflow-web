import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  emptyArchitectEntry,
  emptyMaterialVendor,
  loadContactDirectory,
  mergeArchitects,
  mergeMaterialVendors,
  parseArchitectsFromRows,
  parseMaterialVendorsFromRows,
  parseSpreadsheetFile,
  saveContactDirectory,
} from "../../lib/contactDirectory";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import {
  defaultContactDirectory,
  type ArchitectEntry,
  type ContactDirectorySettings,
  type MaterialVendor,
} from "../../types/contactDirectory";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

type ImportMode = "merge" | "replace";

export function VendorArchitectSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [data, setData] = useState<ContactDirectorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vendorImportMode, setVendorImportMode] = useState<ImportMode>("merge");
  const [architectImportMode, setArchitectImportMode] = useState<ImportMode>("merge");
  const vendorFileRef = useRef<HTMLInputElement>(null);
  const architectFileRef = useRef<HTMLInputElement>(null);
  const trackData = data ?? defaultContactDirectory();
  const ready = !loading && data !== null && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadContactDirectory(user.id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load directory"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveContactDirectory(user.id, data);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    markSaved();
    setMessage("Vendors and architects saved.");
    return true;
  }, [data, markSaved, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) setData(snapshot);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  if (loading) return <p className="muted">Loading vendors &amp; architects…</p>;
  if (!data || !user?.id) return null;

  async function importVendors(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const rows = await parseSpreadsheetFile(file);
      const imported = parseMaterialVendorsFromRows(rows);
      if (!imported.length) {
        setError("No vendor rows found. Expected columns: Name, Email, Phone, Products.");
        return;
      }
      setData((d) =>
        d
          ? {
              ...d,
              material_vendors: mergeMaterialVendors(d.material_vendors, imported, vendorImportMode),
            }
          : d,
      );
      setMessage(
        `Imported ${imported.length} vendor row(s) (${vendorImportMode === "merge" ? "merged" : "replaced"}). Click Save to keep.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vendor import failed");
    } finally {
      if (vendorFileRef.current) vendorFileRef.current.value = "";
    }
  }

  async function importArchitects(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const rows = await parseSpreadsheetFile(file);
      const imported = parseArchitectsFromRows(rows);
      if (!imported.length) {
        setError("No architect rows found. Expected columns: Company, Address.");
        return;
      }
      setData((d) =>
        d
          ? {
              ...d,
              architects: mergeArchitects(d.architects, imported, architectImportMode),
            }
          : d,
      );
      setMessage(
        `Imported ${imported.length} architect row(s) (${architectImportMode === "merge" ? "merged" : "replaced"}). Click Save to keep.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Architect import failed");
    } finally {
      if (architectFileRef.current) architectFileRef.current.value = "";
    }
  }

  function patchVendor(i: number, patch: Partial<MaterialVendor>) {
    setData((d) => {
      if (!d) return d;
      const material_vendors = [...d.material_vendors];
      material_vendors[i] = { ...material_vendors[i]!, ...patch };
      return { ...d, material_vendors };
    });
  }

  function patchArchitect(i: number, patch: Partial<ArchitectEntry>) {
    setData((d) => {
      if (!d) return d;
      const architects = [...d.architects];
      architects[i] = { ...architects[i]!, ...patch };
      return { ...d, architects };
    });
  }

  return (
    <form className="stack contact-directory-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
      <section className="stack">
        <h2>Material vendors</h2>
        <p className="muted small">
          Wallcovering sample orders and <strong>Orders by Vendor</strong>. Import from CSV or Excel
          with columns <strong>Name</strong>, <strong>Email</strong>, <strong>Phone</strong>,{" "}
          <strong>Products</strong> (same as desktop vendors.xlsx).
        </p>

        {!readOnly && (
        <div className="row-gap wrap contact-import-bar">
          <label className="check">
            <input
              type="radio"
              name="vendor-import-mode"
              checked={vendorImportMode === "merge"}
              onChange={() => setVendorImportMode("merge")}
            />
            Merge (skip duplicates)
          </label>
          <label className="check">
            <input
              type="radio"
              name="vendor-import-mode"
              checked={vendorImportMode === "replace"}
              onChange={() => setVendorImportMode("replace")}
            />
            Replace all
          </label>
          <input
            ref={vendorFileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => void importVendors(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => vendorFileRef.current?.click()}
          >
            Import CSV / Excel…
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setData((d) =>
                d ? { ...d, material_vendors: [...d.material_vendors, emptyMaterialVendor()] } : d,
              )
            }
          >
            Add vendor
          </button>
          <span className="muted small">{data.material_vendors.length} vendor(s)</span>
        </div>
        )}

        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Products</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.material_vendors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small">
                    No vendors yet — import a file or add one manually.
                  </td>
                </tr>
              ) : (
                data.material_vendors.map((v, i) => (
                  <tr key={`mv-${i}`}>
                    <td>
                      <input value={v.name} onChange={(e) => patchVendor(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <input
                        type="email"
                        value={v.email}
                        onChange={(e) => patchVendor(i, { email: e.target.value })}
                      />
                    </td>
                    <td>
                      <input value={v.phone} onChange={(e) => patchVendor(i, { phone: e.target.value })} />
                    </td>
                    <td>
                      <input
                        value={v.products}
                        onChange={(e) => patchVendor(i, { products: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setData((d) =>
                            d
                              ? {
                                  ...d,
                                  material_vendors: d.material_vendors.filter((_, j) => j !== i),
                                }
                              : d,
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h2>Architects / specifiers</h2>
        <p className="muted small">
          Import from CSV or Excel with columns <strong>Company</strong> and <strong>Address</strong>{" "}
          (same as desktop architects.xlsx). Used for specifier address lookup.
        </p>

        {!readOnly && (
        <div className="row-gap wrap contact-import-bar">
          <label className="check">
            <input
              type="radio"
              name="architect-import-mode"
              checked={architectImportMode === "merge"}
              onChange={() => setArchitectImportMode("merge")}
            />
            Merge (skip duplicates)
          </label>
          <label className="check">
            <input
              type="radio"
              name="architect-import-mode"
              checked={architectImportMode === "replace"}
              onChange={() => setArchitectImportMode("replace")}
            />
            Replace all
          </label>
          <input
            ref={architectFileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => void importArchitects(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => architectFileRef.current?.click()}
          >
            Import CSV / Excel…
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setData((d) =>
                d ? { ...d, architects: [...d.architects, emptyArchitectEntry()] } : d,
              )
            }
          >
            Add architect
          </button>
          <span className="muted small">{data.architects.length} architect(s)</span>
        </div>
        )}

        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Address</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.architects.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted small">
                    No architects yet — import a file or add one manually.
                  </td>
                </tr>
              ) : (
                data.architects.map((a, i) => (
                  <tr key={`arch-${i}`}>
                    <td>
                      <input
                        value={a.company}
                        onChange={(e) => patchArchitect(i, { company: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={a.address}
                        onChange={(e) => patchArchitect(i, { address: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setData((d) =>
                            d
                              ? { ...d, architects: d.architects.filter((_, j) => j !== i) }
                              : d,
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </fieldset>

      {!readOnly && (
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save vendors & architects"}
      </button>
      )}
    </form>
  );
}
