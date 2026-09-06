import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  STARTUP_CHECKLIST_CATALOG,
  STARTUP_CHECKLIST_GROUP_META,
  STARTUP_SOURCE_LABELS,
} from "../../config/projectStartupItemsCatalog";
import { useAuth } from "../../contexts/AuthContext";
import {
  catalogDefaultEnabledMap,
  enabledIdsFromMap,
  loadStartupChecklistDefaultsDraft,
  resetStartupChecklistDefaultEnabled,
  saveStartupChecklistDefaultEnabled,
} from "../../lib/startupChecklistDefaults";
import {
  isPublicWorksCatalogItem,
  isWallcoveringCatalogItem,
  type StartupChecklistGroup,
} from "../../lib/projectStartupItems";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

type TrackData = {
  enabledIds: string[];
};

const GROUPS = Object.keys(STARTUP_CHECKLIST_GROUP_META) as StartupChecklistGroup[];

export function StartupChecklistSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [usingCustom, setUsingCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackData = useMemo<TrackData>(() => ({ enabledIds }), [enabledIds]);
  const ready = !loading && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadStartupChecklistDefaultsDraft(user.id)
      .then((draft) => {
        setEnabledIds(draft.enabledIds);
        setUsingCustom(draft.usingCustom);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load startup checklist defaults"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveStartupChecklistDefaultEnabled(user.id, enabledIds);
    setSaving(false);
    if (err) {
      setError(err);
      return false;
    }
    setUsingCustom(true);
    markSaved();
    setMessage("Startup checklist defaults saved. New jobs will use this list.");
    return true;
  }, [enabledIds, markSaved, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions || readOnly) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) setEnabledIds(snapshot.enabledIds);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty, readOnly]);

  function toggleId(id: string) {
    if (readOnly) return;
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return STARTUP_CHECKLIST_CATALOG.filter((item) => next.has(item.id)).map((item) => item.id);
    });
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onReset() {
    if (!user?.id) return;
    if (!window.confirm("Reset to the built-in Startup checklist defaults?")) return;
    setResetting(true);
    setMessage(null);
    setError(null);
    const err = await resetStartupChecklistDefaultEnabled(user.id);
    setResetting(false);
    if (err) {
      setError(err);
      return;
    }
    setEnabledIds(enabledIdsFromMap(catalogDefaultEnabledMap()));
    setUsingCustom(false);
    markSaved();
    setMessage("Restored built-in Startup checklist defaults.");
  }

  if (loading) return <p className="muted">Loading startup checklist defaults…</p>;
  if (!user?.id) return null;

  return (
    <form className="stack" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      <div>
        <h2>Startup checklist</h2>
        <p className="muted small">
          Choose which items are enabled when a new job is created. Existing jobs keep the checklist
          they already have. You can still change items per job in Job setup.
        </p>
        <p className="muted small">
          Public works and wallcovering items still turn on automatically when those job flags are
          set, even if they are unchecked here.
        </p>
        <p className="muted small">
          {usingCustom ? "Using your company default list." : "Using built-in defaults."}
        </p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      <div className="stack settings-startup-defaults">
        {GROUPS.map((group) => {
          const meta = STARTUP_CHECKLIST_GROUP_META[group];
          const rows = STARTUP_CHECKLIST_CATALOG.filter((item) => item.group === group);
          return (
            <div key={group} className="startup-config-group stack">
              <p className="paint-col-head">{meta.label}</p>
              {rows.map((item) => (
                <div key={item.id} className="startup-config-row">
                  <div className="startup-config-row-head">
                    <label className="checkbox-row startup-config-enable">
                      <input
                        type="checkbox"
                        checked={enabledIds.includes(item.id)}
                        disabled={readOnly}
                        onChange={() => toggleId(item.id)}
                      />
                      <span className="startup-config-row-label">{item.label}</span>
                    </label>
                    <div className="startup-config-badges">
                      {item.blocking && (
                        <span className="startup-config-badge startup-config-badge--blocking">blocking</span>
                      )}
                      {isPublicWorksCatalogItem(item.id) && (
                        <span className="startup-config-badge startup-config-badge--public-works">
                          public works
                        </span>
                      )}
                      {isWallcoveringCatalogItem(item.id) && (
                        <span className="startup-config-badge startup-config-badge--wallcovering">
                          wallcovering
                        </span>
                      )}
                      {item.source !== "manual" && (
                        <span className="startup-config-badge startup-config-badge--auto">
                          auto · {STARTUP_SOURCE_LABELS[item.source]}
                        </span>
                      )}
                      {item.dateSensitive && (
                        <span className="startup-config-badge startup-config-badge--due">due date</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="row-gap wrap">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={resetting || saving}
            onClick={() => void onReset()}
          >
            {resetting ? "Resetting…" : "Reset to defaults"}
          </button>
        </div>
      )}
    </form>
  );
}
