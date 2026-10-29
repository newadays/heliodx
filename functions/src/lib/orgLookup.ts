/**
 * Matching a clinician's work email to an organization.
 *
 * The pure helpers here are unit-tested; `findOrganizationByDomain` is the
 * one Firestore read, kept thin so the callable stays testable.
 */
import type { Firestore } from "firebase-admin/firestore";

export interface OrganizationSummary {
  id: string;
  name: string;
  legalName: string;
  logoPath: string | null;
  adminName: string;
  sharePolicy: { whatsapp: boolean; email: boolean; pdf: boolean; linkExpiryDays: number };
}

/** "A.Smith@KubiMedical.org" → "kubimedical.org"; null when malformed. */
export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/**
 * A readable default display name from the local part of a work email, used
 * only when the Auth record carries no name:
 *   "a.smith" → "A. Smith", "bola_okafor" → "Bola Okafor", "jdoe" → "Jdoe".
 */
/**
 * Whether a caller may be bound to an organization by email domain alone.
 * The email must be verified: otherwise anyone could register an unverified
 * address at an organization's domain (through the public Auth API, even with
 * no sign-up screen) and join it. Invited and seeded accounts are created
 * verified, so they are unaffected.
 */
export function mayBindByDomain(token: { email?: unknown; email_verified?: unknown }): boolean {
  return typeof token.email === "string" && token.email_verified === true;
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local
    .split(/[._\-+]+/)
    .map((p) => p.replace(/\d+/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return "Clinician";
  return parts
    .map((p) => (p.length === 1 ? `${p.toUpperCase()}.` : p[0].toUpperCase() + p.slice(1).toLowerCase()))
    .join(" ");
}

/** Shape stored in Firestore; only the fields the lookup needs. */
interface OrganizationDoc {
  name?: string;
  legalName?: string;
  logoPath?: string | null;
  adminName?: string;
  domains?: string[];
  sharePolicy?: Partial<OrganizationSummary["sharePolicy"]>;
}

export function toSummary(id: string, data: OrganizationDoc): OrganizationSummary {
  const policy = data.sharePolicy ?? {};
  return {
    id,
    name: data.name ?? id,
    legalName: data.legalName ?? data.name ?? id,
    logoPath: data.logoPath ?? null,
    adminName: data.adminName ?? "",
    sharePolicy: {
      whatsapp: policy.whatsapp ?? true,
      email: policy.email ?? true,
      pdf: policy.pdf ?? true,
      linkExpiryDays: policy.linkExpiryDays ?? 7,
    },
  };
}

/**
 * The organization whose `domains` array contains `domain`, or null. Domains
 * are stored lowercase and are unique across organizations (seed + admin
 * tooling enforce it), so the first hit is the only hit.
 */
export async function findOrganizationByDomain(
  db: Firestore,
  domain: string,
): Promise<OrganizationSummary | null> {
  const snap = await db
    .collection("organizations")
    .where("domains", "array-contains", domain)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toSummary(d.id, d.data() as OrganizationDoc);
}
