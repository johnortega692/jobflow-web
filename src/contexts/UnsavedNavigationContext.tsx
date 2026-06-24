import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog";

type UnsavedGuard = {
  sectionLabel: string;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
};

type UnsavedNavigationContextValue = {
  registerGuard: (guard: UnsavedGuard | null) => void;
  requestNavigation: (to: string, e?: MouseEvent) => boolean;
};

const UnsavedNavigationContext = createContext<UnsavedNavigationContextValue | null>(null);

export function UnsavedNavigationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const guardRef = useRef<UnsavedGuard | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingTo, setPendingTo] = useState<string | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);

  const registerGuard = useCallback((guard: UnsavedGuard | null) => {
    guardRef.current = guard;
    setDirty(guard?.isDirty() ?? false);
  }, []);

  const requestNavigation = useCallback((to: string, e?: MouseEvent) => {
    const guard = guardRef.current;
    if (!guard?.isDirty()) return true;
    e?.preventDefault();
    setPendingTo(to);
    return false;
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function onDialogSave() {
    const guard = guardRef.current;
    const to = pendingTo;
    if (!guard || !to) return;
    setDialogSaving(true);
    const ok = await guard.save();
    setDialogSaving(false);
    if (!ok) return;
    setPendingTo(null);
    setDirty(false);
    navigate(to);
  }

  function onDialogDiscard() {
    const guard = guardRef.current;
    const to = pendingTo;
    if (!guard || !to) return;
    guard.discard();
    setPendingTo(null);
    setDirty(false);
    navigate(to);
  }

  function onDialogCancel() {
    setPendingTo(null);
  }

  const value: UnsavedNavigationContextValue = {
    registerGuard,
    requestNavigation,
  };

  return (
    <UnsavedNavigationContext.Provider value={value}>
      {children}
      {pendingTo && guardRef.current && (
        <UnsavedChangesDialog
          targetLabel={guardRef.current.sectionLabel}
          saving={dialogSaving}
          onSave={() => void onDialogSave()}
          onDiscard={onDialogDiscard}
          onCancel={onDialogCancel}
        />
      )}
    </UnsavedNavigationContext.Provider>
  );
}

export function useUnsavedNavigation() {
  const ctx = useContext(UnsavedNavigationContext);
  if (!ctx) {
    throw new Error("useUnsavedNavigation must be used within UnsavedNavigationProvider");
  }
  return ctx;
}

export function useUnsavedNavigationGuard(opts: {
  enabled?: boolean;
  sectionLabel: string;
  isDirty: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const { registerGuard } = useUnsavedNavigation();
  const { enabled = true, sectionLabel, isDirty, onSave, onDiscard } = opts;

  const onSaveRef = useRef(onSave);
  const onDiscardRef = useRef(onDiscard);
  onSaveRef.current = onSave;
  onDiscardRef.current = onDiscard;

  useEffect(() => {
    if (!enabled) {
      registerGuard(null);
      return;
    }
    registerGuard({
      sectionLabel,
      isDirty: () => isDirty,
      save: () => onSaveRef.current(),
      discard: () => onDiscardRef.current(),
    });
    return () => registerGuard(null);
  }, [enabled, sectionLabel, isDirty, registerGuard]);
}
