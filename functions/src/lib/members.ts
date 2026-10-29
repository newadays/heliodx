/**
 * Creating organization members (invite-only onboarding), used by the
 * `scripts/invite.ts` CLI: the Auth user, users document and claims.
 */
import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { domainOf } from "./orgLookup";

/** Roles carried in the `role` custom claim. */
export const MEMBER_ROLES = ["clinician", "radiologist", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Unknown or missing roles fall back to the least-privileged one. */
export function parseRole(value: unknown): MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value) ? (value as MemberRole) : "clinician";
}

/** Response profile of a simulated radiologist (seeded for demos; B14 drives the timers). */
export type SimProfile = "fast" | "slow" | "silent";

export interface InviteInput {
  email: string;
  displayName: string;
  title?: string | null;
  role?: MemberRole;
  /** Seed only: marks the member as a simulated radiologist. */
  simProfile?: SimProfile;
}

/** The invite keeps the domain invariant: members' emails belong to the organization. */
export function inviteAllowed(email: string, orgDomains: string[]): { ok: true; email: string } | { ok: false; reason: string } {
  const normalized = email.trim().toLowerCase();
  const domain = domainOf(normalized);
  if (!domain) return { ok: false, reason: "invalid_email" };
  if (!orgDomains.map((d) => d.toLowerCase()).includes(domain)) return { ok: false, reason: "domain_not_in_org" };
  return { ok: true, email: normalized };
}

export interface CreatedMember {
  uid: string;
  email: string;
  created: boolean;
  /** Password-setup link for the new member; null when the user already existed. */
  resetLink: string | null;
}

export async function createMember(
  db: Firestore,
  auth: Auth,
  orgId: string,
  input: InviteInput,
  invitedBy: string,
): Promise<CreatedMember> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const title = input.title?.trim() || null;
  const role = input.role ?? "clinician";

  let uid: string;
  let created = false;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } catch {
    const user = await auth.createUser({
      email,
      emailVerified: true,
      displayName: title ? `${title} ${displayName}` : displayName,
      disabled: false,
    });
    uid = user.uid;
    created = true;
  }

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const existingOrg = snap.exists ? (snap.get("orgId") as string | null) : null;
  if (existingOrg && existingOrg !== orgId) {
    throw new Error("already_member_elsewhere");
  }

  await userRef.set(
    {
      uid,
      email,
      displayName: snap.exists ? (snap.get("displayName") ?? displayName) : displayName,
      title: snap.exists ? (snap.get("title") ?? title) : title,
      orgId,
      role,
      orgConfirmedAt: snap.exists ? (snap.get("orgConfirmedAt") ?? null) : null,
      invitedBy,
      ...(input.simProfile ? { simulated: true, simProfile: input.simProfile } : {}),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await auth.setCustomUserClaims(uid, { orgId, role });

  const resetLink = created ? await auth.generatePasswordResetLink(email) : null;
  return { uid, email, created, resetLink };
}
