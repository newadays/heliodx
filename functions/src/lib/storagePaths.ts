/**
 * Storage layout: every study's files sit under its owner,
 * `studies/{orgId}/{uid}/{studyId}/…` (original, thumb, overlays/, shares/),
 * and uploads are staged at `studies/{orgId}/{uid}/staging/{uploadId}.png`.
 * Studies stored before this layout keep `studies/{orgId}/{studyId}/…`; code
 * that needs a study's folder takes it from the study's own image path, so
 * both layouts keep working.
 */
export const STAGING_DIR = "staging";

export function studyDir(orgId: string, uid: string, studyId: string): string {
  return `studies/${orgId}/${uid}/${studyId}`;
}

export function stagingPath(orgId: string, uid: string, uploadId: string): string {
  return `studies/${orgId}/${uid}/${STAGING_DIR}/${uploadId}.png`;
}

/** The folder holding a study's files, from its stored image path when it has one. */
export function studyDirOf(studyId: string, study: { orgId?: string | null; clinicianUid?: string | null; image?: { storagePath?: string | null } | null }): string {
  const original = study.image?.storagePath;
  if (original && original.includes("/")) return original.slice(0, original.lastIndexOf("/"));
  return studyDir(study.orgId ?? "unknown", study.clinicianUid ?? "unknown", studyId);
}

/** `studies/{orgId}/{uid}/{studyId}/original.<ext>`, or the older `studies/{orgId}/{studyId}/original.<ext>`. */
const ORIGINAL_PATH = /^studies\/([^/]+)\/(?:([^/]+)\/)?([^/]+)\/original\.[a-z0-9]+$/i;

export function parseOriginalPath(name: string): { orgId: string; uid: string | null; studyId: string } | null {
  const m = ORIGINAL_PATH.exec(name);
  if (!m || m[3] === STAGING_DIR) return null;
  return { orgId: m[1], uid: m[2] ?? null, studyId: m[3] };
}
