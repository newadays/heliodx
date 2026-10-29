/**
 * Signed-in user, their claims ({ orgId, role }) and profile (`users/{uid}`).
 * Accounts are created by an admin (invite or `demo-user add`); there is no
 * sign-up here.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { auth, db } from "~/firebase";

export interface Claims {
  orgId: string | null;
  role: string | null;
}

export interface Profile {
  displayName: string;
  title: string | null;
}

interface AuthState {
  user: User | null;
  claims: Claims;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const NO_CLAIMS: Claims = { orgId: null, role: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<Claims>(NO_CLAIMS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (next) => {
        setLoading(true);
        setUser(next);
        if (!next) {
          setClaims(NO_CLAIMS);
          setProfile(null);
          setLoading(false);
          return;
        }
        try {
          const token = await next.getIdTokenResult();
          setClaims({
            orgId: typeof token.claims.orgId === "string" ? token.claims.orgId : null,
            role: typeof token.claims.role === "string" ? token.claims.role : null,
          });
          const snap = await getDoc(doc(db, "users", next.uid));
          const data = snap.data();
          setProfile(data ? { displayName: String(data.displayName ?? next.email ?? ""), title: (data.title as string | null) ?? null } : null);
        } finally {
          setLoading(false);
        }
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      claims,
      profile,
      loading,
      signIn: async (email, password) => {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await cred.user.getIdToken(true);
      },
      signOut: () => fbSignOut(auth),
    }),
    [user, claims, profile, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** "Dr. Demo Clinician" */
export function clinicianName(profile: Profile | null, fallback = "Clinician"): string {
  if (!profile) return fallback;
  return profile.title ? `${profile.title} ${profile.displayName}` : profile.displayName;
}
