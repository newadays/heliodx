/**
 * Live Firestore data for the screens. Demo accounts read only their own
 * studies (rules), so every list query filters on clinicianUid; admins of a
 * real organization see the organization's.
 */
import { collection, doc, limit, onSnapshot, orderBy, query, where, type FirestoreError } from "firebase/firestore";
import { getBlob, getDownloadURL, ref } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";

import type { AuditEntry, Study, TraceEntry } from "@/types/study";
import { useAuth } from "~/auth/AuthContext";
import { db, storage } from "~/firebase";

export interface Live<T> {
  data: T;
  loading: boolean;
  error: FirestoreError | null;
}

/** The signed-in clinician's studies, newest first (index: orgId, clinicianUid, updatedAt desc). */
/** Owner id of the workspace's sample studies (§4.11). */
export const SAMPLE_OWNER = "samples";

/**
 * The worklist: the clinician's own studies plus the workspace's samples
 * (§4.11), as two live queries merged newest first.
 */
export function useStudies(max = 60): Live<Study[]> {
  const { user, claims } = useAuth();
  const [own, setOwn] = useState<Live<Study[]>>({ data: [], loading: true, error: null });
  const [samples, setSamples] = useState<Live<Study[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!user || !claims.orgId) return;
    const listen = (owner: string, set: typeof setOwn) =>
      onSnapshot(
        query(collection(db, "studies"), where("orgId", "==", claims.orgId), where("clinicianUid", "==", owner), orderBy("updatedAt", "desc"), limit(max)),
        (snap) =>
          set({
            data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Study, "id">) })).filter((s) => !s.deletedAt),
            loading: false,
            error: null,
          }),
        (error) => set((s) => ({ ...s, loading: false, error })),
      );
    const stopOwn = listen(user.uid, setOwn);
    const stopSamples = listen(SAMPLE_OWNER, setSamples);
    return () => {
      stopOwn();
      stopSamples();
    };
  }, [user, claims.orgId, max]);
  return useMemo(
    () => ({
      data: [...own.data, ...samples.data],
      loading: own.loading || samples.loading,
      // Samples are optional (other organizations have none): only the own list's error blocks.
      error: own.error,
    }),
    [own, samples],
  );
}

export function useStudy(studyId: string | null): Live<Study | null> {
  const [state, setState] = useState<Live<Study | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!studyId) return;
    setState({ data: null, loading: true, error: null });
    return onSnapshot(
      doc(db, "studies", studyId),
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...(snap.data() as Omit<Study, "id">) } : null, loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
  }, [studyId]);
  return state;
}

export function useTrace(studyId: string | null): TraceEntry[] {
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  useEffect(() => {
    if (!studyId) return;
    setTrace([]);
    return onSnapshot(
      query(collection(db, "studies", studyId, "trace"), orderBy("seq"), limit(400)),
      (snap) => setTrace(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TraceEntry, "id">) }))),
      () => setTrace([]),
    );
  }, [studyId]);
  return trace;
}

export function useAudit(studyId: string | null): AuditEntry[] {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => {
    if (!studyId) return;
    setAudit([]);
    return onSnapshot(
      query(collection(db, "studies", studyId, "audit"), orderBy("at"), limit(200)),
      (snap) => setAudit(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEntry, "id">) }))),
      () => setAudit([]),
    );
  }, [studyId]);
  return audit;
}

const urlCache = new Map<string, Promise<string>>();

/**
 * A URL for a Storage file: the download URL (a plain <img> link, no CORS
 * needed), or, when the object has no download token, the bytes fetched with
 * the signed-in user's token as an object URL. Cached per session; null until
 * loaded or when missing.
 */
/** A URL for a Storage file (see useStorageUrl), outside React. */
export function storageUrl(path: string): Promise<string> {
  let p = urlCache.get(path);
  if (!p) {
    const r = ref(storage, path);
    p = getDownloadURL(r).catch(() => getBlob(r).then((blob) => URL.createObjectURL(blob)));
    urlCache.set(path, p);
    p.catch(() => urlCache.delete(path));
  }
  return p;
}

export function useStorageUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    storageUrl(path).then((u) => live && setUrl(u)).catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

/** Re-renders every `intervalMs`, for live elapsed times. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface OrganizationView {
  name: string;
  legalName?: string;
  sharePolicy?: { whatsapp?: boolean; email?: boolean; pdf?: boolean; linkExpiryDays?: number };
}

/** The signed-in member's organization (members may read their own). */
export function useOrganization(orgId: string | null): OrganizationView | null {
  const [org, setOrg] = useState<OrganizationView | null>(null);
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      doc(db, "organizations", orgId),
      (snap) => setOrg(snap.exists() ? (snap.data() as OrganizationView) : null),
      () => setOrg(null),
    );
  }, [orgId]);
  return org;
}
