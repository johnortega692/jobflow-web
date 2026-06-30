import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isAppAdmin, loadUserProfileAuth, type AppRole } from "../lib/appRole";
import { supabase } from "../lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  appRole: AppRole | null;
  roleLoading: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  jobRole: string;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [jobRole, setJobRole] = useState("");
  const [roleLoading, setRoleLoading] = useState(false);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setAppRole(null);
      setIsApproved(false);
      setJobRole("");
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    const profile = await loadUserProfileAuth(userId);
    setAppRole(profile.appRole);
    setIsApproved(profile.isApproved);
    setJobRole(profile.jobRole);
    setRoleLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data.session) setSession(data.session);
    if (data.user) {
      const profile = await loadUserProfileAuth(data.user.id);
      if (!profile.isApproved) {
        return "Your account is awaiting admin approval.";
      }
    }
    return null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (data.session) {
      await supabase.auth.signOut();
      setSession(null);
    }
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAppRole(null);
    setIsApproved(false);
    setJobRole("");
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      appRole,
      roleLoading,
      isAdmin: isAppAdmin(appRole),
      isApproved,
      jobRole,
      refreshProfile,
      signIn,
      signUp,
      signOut,
    }),
    [session, loading, appRole, roleLoading, isApproved, jobRole, refreshProfile, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
