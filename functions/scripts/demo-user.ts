/**
 * Demo accounts for the judges (admin tool, card F11).
 *
 *   npm run demo-user -- add --email judge@example.org [--name "Demo Clinician"] [--title Dr.] [--seed]
 *   npm run demo-user -- reset --email judge@example.org     # delete the account's own studies (its uploads)
 *   npm run demo-user -- remove --email judge@example.org
 *   npm run demo-user -- seed-samples [--reset]               # the workspace's shared sample studies
 *
 * `add` creates the account in the synthetic demo organization and prints a
 * password-setup link (shown once; set the password, then hand the sign-in to
 * the judges privately, never in the repo). `remove` deletes the account and
 * its uploads. Sample studies are shared by every demo account (§4.11):
 * `seed-samples` (or `add --seed`) seeds them when the workspace has none —
 * Sample Patients 1 and 2 ready to review, 4 signed and shared; the deployed
 * pipeline and autopilot do the work — and `--reset` replaces them. Emulator by default; SEED_TARGET=project targets the
 * real project with your Application Default Credentials.
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { addDemoUser, clearDemoStudies, clearWorkspaceSamples, ensureDemoOrganization, removeDemoUser } from "../src/lib/demoAccounts";
import { seedWorkspaceSamples } from "../src/lib/demoSeed";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "heliodx";
const BUCKET = process.env.SAMPLES_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.SEED_TARGET !== "project") {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  }
  const command = process.argv[2];
  const email = arg("email");
  if (!(command === "seed-samples" || (email && ["add", "remove", "reset"].includes(command)))) {
    console.error('Usage: npm run demo-user -- add|reset|remove --email <email> [--name "Demo Clinician"] [--title Dr.] [--seed]\n       npm run demo-user -- seed-samples [--reset]');
    process.exit(2);
  }
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
  const db = getFirestore();

  if (command === "seed-samples") {
    await ensureDemoOrganization(db);
    const replace = process.argv.includes("--reset");
    const cleared = replace ? await clearWorkspaceSamples(db, getStorage().bucket()) : 0;
    const ids = await seedWorkspaceSamples(db, getStorage().bucket(), { force: replace });
    console.log(ids.length ? `${replace ? `Cleared ${cleared} and seeded` : "Seeded"} ${ids.length} sample studies; they appear as the pipeline drafts them.` : "The workspace already has its sample studies.");
    return;
  }
  if (!email) return;

  if (command === "add") {
    const account = await addDemoUser(db, getAuth(), { email, displayName: arg("name"), title: arg("title") });
    console.log(`${account.created ? "Created" : "Updated"} demo account ${account.email} (${account.uid}).`);
    if (account.resetLink) {
      console.log("Password-setup link (open it once to set the password):");
      console.log(account.resetLink);
    } else {
      console.log("Existing account: no new password link. Use Forgot password to change it.");
    }
    if (process.argv.includes("--seed")) {
      const ids = await seedWorkspaceSamples(db, getStorage().bucket());
      console.log(ids.length ? `Seeded ${ids.length} sample studies for the workspace.` : "The workspace already has its sample studies.");
    }
  } else if (command === "reset") {
    const account = await addDemoUser(db, getAuth(), { email });
    const cleared = await clearDemoStudies(db, getStorage().bucket(), account.uid);
    console.log(`Cleared ${cleared} of ${email}'s own studies. Sample studies are shared: use seed-samples --reset to replace them.`);
  } else {
    const removed = await removeDemoUser(db, getAuth(), getStorage().bucket(), email);
    console.log(`Removed demo account ${email} (${removed.uid}) and ${removed.studies} studies.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
