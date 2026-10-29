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
  return useLiveTrace(studyId).trace;
}

/**
 * The case's trace, live, plus the stream's state (agent console §5):
 * "connecting" until the first server answer, "live" while current, and
 * "reconnecting" when offline or after an error. A Firestore listener ends
 * on an error, so it resubscribes with backoff; what is already shown is
 * never cleared meanwhile.
 */
export type StreamState = "connecting" | "live" | "reconnecting";

export function useLiveTrace(studyId: string | null): { trace: TraceEntry[]; live: StreamState } {
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  // A new case starts from nothing.
  useEffect(() => {
    setTrace([]);
    setState("connecting");
    setAttempt(0);
  }, [studyId]);
  useEffect(() => {
    if (!studyId) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = onSnapshot(
      query(collection(db, "studies", studyId, "trace"), orderBy("seq"), limit(400)),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.metadata.fromCache) setState("live");
        setTrace(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TraceEntry, "id">) })));
      },
      () => {
        setState("reconnecting");
        retry = setTimeout(() => setAttempt((a) => a + 1), Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      },
    );
    return () => {
      stop();
      if (retry) clearTimeout(retry);
    };
  }, [studyId, attempt]);
  return { trace, live: !online && state === "live" ? "reconnecting" : state };
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
