/**
 * F11 · Demo accounts. Judges sign in with an email/password account an
 * admin creates (scripts/demo-user.ts); there is no self sign-up. Each
 * account is a member of the synthetic demo organization with the `demo`
 * role, sees its own uploads (kept until the account is removed) and the
 * workspace's sample studies, which every demo account shares (§4.11).
 */
import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";

import { SAMPLE_OWNER } from "./access";
import { DEFAULT_ROSTER } from "../radiology/roster";
import { DEMO_ORG, DEMO_ORGANIZATION, DEMO_PROFILE, DEMO_ROLE } from "./demo";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export interface DemoAccount {
  uid: string;
  email: string;
  created: boolean;
  /** Password-setup link for a new account; null when it already existed. */
  resetLink: string | null;
}

/** Creates the demo organization, or brings an existing one up to date (the 29 Oct rename to "HelioDX", the B14 radiologist roster). */
export async function ensureDemoOrganization(db: Firestore): Promise<void> {
  const orgRef = db.collection("organizations").doc(DEMO_ORG);
  const snap = await orgRef.get();
  if (!snap.exists) {
    await orgRef.set({ ...DEMO_ORGANIZATION, radiologists: DEFAULT_ROSTER, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } else if (snap.get("name") !== DEMO_ORGANIZATION.name || snap.get("legalName") !== DEMO_ORGANIZATION.legalName || !Array.isArray(snap.get("radiologists"))) {
    // B14: the simulated radiologists' roster, added to organizations created before it existed.
    await orgRef.update({
      name: DEMO_ORGANIZATION.name,
      legalName: DEMO_ORGANIZATION.legalName,
      ...(Array.isArray(snap.get("radiologists")) ? {} : { radiologists: DEFAULT_ROSTER }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Creates (or re-binds) a demo account with a confirmed, simulated clinician profile. */
export async function addDemoUser(
  db: Firestore,
  auth: Auth,
  input: { email: string; displayName?: string; title?: string | null },
): Promise<DemoAccount> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_email");
  const displayName = input.displayName?.trim() || DEMO_PROFILE.displayName;
  const title = input.title === undefined ? DEMO_PROFILE.title : input.title?.trim() || null;

  await ensureDemoOrganization(db);

  let uid: string;
  let created = false;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch {
    uid = (await auth.createUser({ email, emailVerified: true, displayName: title ? `${title} ${displayName}` : displayName })).uid;
    created = true;
  }

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const existingOrg = snap.exists ? (snap.get("orgId") as string | null) : null;
  // Never move a real clinician into the demo organization.
  if (existingOrg && existingOrg !== DEMO_ORG) throw new Error("already_member_elsewhere");

  await userRef.set(
    {
      uid,
      email,
      displayName,
      title,
      simulated: true,
      orgId: DEMO_ORG,
      role: DEMO_ROLE,
      orgConfirmedAt: snap.exists ? (snap.get("orgConfirmedAt") ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      invitedBy: "cli",
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await auth.setCustomUserClaims(uid, { orgId: DEMO_ORG, role: DEMO_ROLE });

  const resetLink = created ? await auth.generatePasswordResetLink(email) : null;
  return { uid, email, created, resetLink };
}

/** Deletes a demo account with its studies (audit, trace, Storage objects) and profile. */
export async function removeDemoUser(db: Firestore, auth: Auth, bucket: Bucket, email: string): Promise<{ uid: string; studies: number }> {
  const user = await auth.getUserByEmail(email.trim().toLowerCase());
  const profile = await db.collection("users").doc(user.uid).get();
  const claimsOrg = user.customClaims?.orgId as string | undefined;
  if ((profile.exists && profile.get("orgId") !== DEMO_ORG) || (claimsOrg && claimsOrg !== DEMO_ORG)) {
    throw new Error("not_a_demo_account");
  }
  const studies = await clearDemoStudies(db, bucket, user.uid);
  await profile.ref.delete();
  await auth.deleteUser(user.uid);
  return { uid: user.uid, studies };
}

/** Deletes the workspace's sample studies (audit, trace, Storage objects); returns how many. */
export async function clearWorkspaceSamples(db: Firestore, bucket: Bucket): Promise<number> {
  const studies = await db.collection("studies").where("orgId", "==", DEMO_ORG).where("clinicianUid", "==", SAMPLE_OWNER).select().get();
  for (const doc of studies.docs) await db.recursiveDelete(doc.ref);
  await bucket.deleteFiles({ prefix: `studies/${DEMO_ORG}/${SAMPLE_OWNER}/` }).catch(() => undefined);
  return studies.size;
}

/** Deletes every study a demo account owns (its uploads, and samples seeded per account before §4.11); returns how many. */
export async function clearDemoStudies(db: Firestore, bucket: Bucket, uid: string): Promise<number> {
  const studies = await db.collection("studies").where("orgId", "==", DEMO_ORG).where("clinicianUid", "==", uid).select().get();
  for (const doc of studies.docs) {
    // Studies stored before the per-user layout.
    await bucket.deleteFiles({ prefix: `studies/${DEMO_ORG}/${doc.id}/` }).catch(() => undefined);
    await db.recursiveDelete(doc.ref);
  }
  // Everything under the account's folder: studies and staged uploads.
  await bucket.deleteFiles({ prefix: `studies/${DEMO_ORG}/${uid}/` }).catch(() => undefined);
  return studies.size;
}
