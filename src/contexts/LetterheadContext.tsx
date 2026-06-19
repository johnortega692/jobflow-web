import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadLetterheadSettings,
  letterheadToPrintBranding,
  resolvePrintBranding,
  saveLetterheadSettings,
} from "../lib/letterheadSettings";
import { profileFromSettings, profileToSettingsPatch } from "../lib/userProfile";
import type { PrintBranding } from "../lib/printCore";
import {
  emptyLetterheadSettings,
  coerceLetterheadSettings,
  type LetterheadSettings,
} from "../types/letterheadSettings";
import type { UserProfile } from "../types/userProfile";
import { useAuth } from "./AuthContext";

type LetterheadContextValue = {
  settings: LetterheadSettings;
  profile: UserProfile;
  branding: PrintBranding;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setSettings: (patch: Partial<LetterheadSettings>) => void;
  setProfile: (patch: Partial<UserProfile>) => void;
  save: () => Promise<string | null>;
  reload: () => Promise<void>;
};

const LetterheadContext = createContext<LetterheadContextValue | null>(null);

export function LetterheadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettingsState] = useState<LetterheadSettings>(emptyLetterheadSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setSettingsState(emptyLetterheadSettings());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadLetterheadSettings(user.id);
      setSettingsState(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setSettings = useCallback((patch: Partial<LetterheadSettings>) => {
    setSettingsState((prev) => coerceLetterheadSettings({ ...prev, ...patch }));
  }, []);

  const setProfile = useCallback((patch: Partial<UserProfile>) => {
    setSettings(profileToSettingsPatch(patch));
  }, [setSettings]);

  const save = useCallback(async () => {
    if (!user) return "Sign in to save settings.";
    setSaving(true);
    setError(null);
    const err = await saveLetterheadSettings(user.id, settings);
    setSaving(false);
    if (err) setError(err);
    return err;
  }, [user, settings]);

  const branding = useMemo(
    () => (user ? letterheadToPrintBranding(settings) : resolvePrintBranding(null)),
    [user, settings],
  );

  const profile = useMemo(() => profileFromSettings(settings), [settings]);

  const value = useMemo(
    () => ({
      settings,
      profile,
      branding,
      loading,
      saving,
      error,
      setSettings,
      setProfile,
      save,
      reload,
    }),
    [settings, profile, branding, loading, saving, error, setSettings, setProfile, save, reload],
  );

  return <LetterheadContext.Provider value={value}>{children}</LetterheadContext.Provider>;
}

export function useLetterhead() {
  const ctx = useContext(LetterheadContext);
  if (!ctx) throw new Error("useLetterhead must be used within LetterheadProvider");
  return ctx;
}
