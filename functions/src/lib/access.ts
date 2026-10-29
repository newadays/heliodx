/**
 * §4.11 · Who may act on a study. Uploads belong to the clinician who
 * uploaded them; sample studies belong to the workspace (owner id
 * `SAMPLE_OWNER`, files under `studies/{orgId}/samples/…`), so every member
 * of that organization may review, sign, share and reset them.
 */
export const SAMPLE_OWNER = "samples";

export interface AccessStudy {
  clinicianUid?: string | null;
  orgId?: string | null;
  source?: string | null;
}

export function isSample(study: AccessStudy): boolean {
  return study.source === "sample" && study.clinicianUid === SAMPLE_OWNER;
}

/** The owner, or (for a sample) any member of its organization. */
export function canAct(study: AccessStudy, uid: string, orgId?: string | null): boolean {
  if (study.clinicianUid === uid) return true;
  return isSample(study) && !!orgId && study.orgId === orgId;
}

/** A signed-in caller: a bare uid (server-side callers, tests) or uid + org claim. */
export type Caller = string | { uid: string; orgId?: string | null };

export function asCaller(caller: Caller): { uid: string; orgId: string | null } {
  return typeof caller === "string" ? { uid: caller, orgId: null } : { uid: caller.uid, orgId: caller.orgId ?? null };
}

/** From a callable request's auth. */
export function callerOf(auth: { uid: string; token: Record<string, unknown> }): { uid: string; orgId: string | null } {
  return { uid: auth.uid, orgId: typeof auth.token.orgId === "string" ? auth.token.orgId : null };
}
