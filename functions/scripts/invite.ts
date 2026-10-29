/**
 * Invite a clinician to an organization from the command line (admin tool).
 *
 *   npm run invite -- --org kubi-medical --email b.okafor@kubimedical.org --name "B. Okafor" [--title Dr.] [--role clinician|radiologist|admin]
 *
 * Emulator by default; SEED_TARGET=project targets the real project with your
 * Application Default Credentials. Prints the password-setup link to hand to
 * the new member (it is the only time it is shown).
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { createMember, inviteAllowed, parseRole } from "../src/lib/members";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "heliodx";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.SEED_TARGET !== "project") {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  }
  const orgId = arg("org");
  const email = arg("email");
  const displayName = arg("name");
  const title = arg("title") ?? null;
  const role = parseRole(arg("role"));
  if (!orgId || !email || !displayName) {
    console.error("Usage: npm run invite -- --org <orgId> --email <email> --name <display name> [--title Dr.] [--role clinician|radiologist|admin]");
    process.exit(2);
  }

  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  const org = await db.collection("organizations").doc(orgId).get();
  if (!org.exists) throw new Error(`Organization ${orgId} not found. Run the seed first.`);
  const allowed = inviteAllowed(email, (org.get("domains") as string[]) ?? []);
  if (!allowed.ok) throw new Error(`Refusing: ${allowed.reason} (org domains: ${(org.get("domains") as string[]).join(", ")})`);

  const member = await createMember(db, getAuth(), orgId, { email: allowed.email, displayName, title, role }, "cli");
  console.log(`${member.created ? "Created" : "Updated"} ${member.email} (${member.uid}) as ${role} of ${orgId}.`);
  if (member.resetLink) {
    console.log("Password-setup link (share once, then it is gone):");
    console.log(member.resetLink);
  } else {
    console.log("Existing account: no new password link. They can use Forgot password.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
