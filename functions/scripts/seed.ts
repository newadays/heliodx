/**
 * Seed the first organization and an admin clinician.
 *
 * Emulator (default):
 *   firebase emulators:start            # in another terminal
 *   npm run seed                        # from functions/
 *
 * Real project (deliberate, needs ADC with Firestore + Auth admin rights):
 *   SEED_TARGET=project npm run seed -- --email dr.smith@kubimedical.org
 *
 * Options (all optional):
 *   --org kubi-medical        organization id
 *   --domain kubimedical.org  email domain that maps to the org
 *   --email <work email>      admin user (default dr.smith@<domain>)
 *   --password <pw>           default from SEED_PASSWORD, else a generated one
 *   --name "A. Smith"         display name
 *   --title "Dr."
 *   --with-studies            also write three sample studies for the Home list
 *   --with-radiologists       also create three simulated radiologists
 *                             (fast / slow / silent) on the org domain
 *
 * Idempotent: re-running updates the org document and reuses the auth user.
 * Prints nothing sensitive except the generated password on first creation.
 */
import { randomBytes } from "node:crypto";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

import { createMember, type SimProfile } from "../src/lib/members";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(args: Args, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "heliodx";

function pointAtEmulators(): void {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = process.env.SEED_TARGET === "project" ? "project" : "emulator";
  if (target === "emulator") pointAtEmulators();

  const orgId = str(args, "org", "kubi-medical");
  const domain = str(args, "domain", "kubimedical.org").toLowerCase();
  const email = str(args, "email", `dr.smith@${domain}`).toLowerCase();
  const displayName = str(args, "name", "A. Smith");
  const title = str(args, "title", "Dr.");
  const providedPassword = str(args, "password", process.env.SEED_PASSWORD ?? "");

  if (!email.endsWith(`@${domain}`)) {
    throw new Error(`Admin email ${email} is not on the organization domain ${domain}.`);
  }

  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  console.log(`Seeding ${target} (${PROJECT_ID}): org ${orgId}, domain ${domain}`);

  // ---- auth user ----------------------------------------------------------
  let uid: string;
  let generatedPassword: string | null = null;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`Auth user exists: ${uid}`);
  } catch {
    const password = providedPassword || randomBytes(9).toString("base64url");
    const created = await auth.createUser({
      email,
      password,
      displayName: `${title} ${displayName}`.trim(),
      emailVerified: true,
    });
    uid = created.uid;
    generatedPassword = providedPassword ? null : password;
    console.log(`Auth user created: ${uid}`);
  }

  await auth.setCustomUserClaims(uid, { orgId, role: "admin" });

  // ---- organization -------------------------------------------------------
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await orgRef.get();
  await orgRef.set(
    {
      name: "Kubi Medical",
      legalName: "Kubi Medical Foundation",
      logoPath: null,
      domains: [domain],
      adminUid: uid,
      adminName: `${title} ${displayName}`.trim(),
      sharePolicy: { whatsapp: true, email: true, pdf: true, linkExpiryDays: 7 },
      ...(orgSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // ---- users/{uid} --------------------------------------------------------
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  await userRef.set(
    {
      uid,
      email,
      displayName,
      title,
      orgId,
      role: "admin",
      orgConfirmedAt: userSnap.exists ? (userSnap.get("orgConfirmedAt") ?? null) : null,
      ...(userSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // ---- sample studies (optional) -----------------------------------------
  if (args["with-studies"]) {
    const samples = sampleStudies(orgId, uid, `${title} ${displayName}`.trim());
    const batch = db.batch();
    for (const study of samples) batch.set(db.collection("studies").doc(study.id), study, { merge: true });
    await batch.commit();
    console.log(`Sample studies written: ${samples.map((s) => s.id).join(", ")}`);
  }

  // ---- simulated radiologists (optional) ----------------------------------
  if (args["with-radiologists"]) {
    const roster: { profile: SimProfile; name: string }[] = [
      { profile: "fast", name: "N. Okafor" },
      { profile: "slow", name: "T. Bello" },
      { profile: "silent", name: "H. Danjuma" },
    ];
    const radiologists: { id: string; name: string; profile: SimProfile; simulated: true }[] = [];
    for (const r of roster) {
      const member = await createMember(
        db,
        auth,
        orgId,
        { email: `radiologist.${r.profile}@${domain}`, displayName: r.name, title: "Dr.", role: "radiologist", simProfile: r.profile },
        "seed",
      );
      // Same password as the admin when one was given, so a person can sign
      // in as a radiologist on the emulators.
      if (providedPassword) await auth.updateUser(member.uid, { password: providedPassword });
      console.log(`Simulated radiologist (${r.profile}): ${member.email}${member.created ? "" : " (existing)"}`);
      radiologists.push({ id: member.uid, name: `Dr. ${r.name}`, profile: r.profile, simulated: true });
    }
    // B14: the roster the read timers assign from (radiology/roster.ts).
    await db.collection("organizations").doc(orgId).update({ radiologists, updatedAt: FieldValue.serverTimestamp() });
  }

  console.log("Done.");
  console.log(`  sign in as: ${email}`);
  if (generatedPassword) {
    console.log(`  password:   ${generatedPassword}   (generated; set --password to choose one)`);
  } else if (providedPassword) {
    console.log("  password:   (as provided)");
  } else {
    console.log("  password:   unchanged");
  }
}

/** Three ready studies matching design 01: today/shared, yesterday/draft, Monday/shared. */
function sampleStudies(orgId: string, clinicianUid: string, clinicianName: string) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => Timestamp.fromMillis(ms);
  const finding = (id: string, index: number, title: string, confidence: number, color: string) => ({
    id,
    index,
    title,
    description: `${title} — sample finding for the emulator.`,
    confidence,
    region: { shape: "ellipse", x: 0.3 + index * 0.1, y: 0.3, w: 0.2, h: 0.15 },
    color,
    status: "accepted",
    reviewedAt: at(now - index * 60_000),
  });
  const base = (id: string, patient: string, modality: string, studyType: string, source: string, ms: number) => ({
    id,
    orgId,
    clinicianUid,
    clinicianName,
    patient: { name: patient },
    modality,
    studyType,
    clinicalContext: "",
    source,
    image: {
      storagePath: `studies/${orgId}/${id}/original.jpg`,
      thumbPath: null,
      width: 1600,
      height: 1200,
      bytes: 250_000,
      contentType: "image/jpeg",
    },
    status: "ready",
    pipeline: { runId: `seed-${id}`, stepTimestamps: {}, model: "seed" },
    clinicianSummary: null,
    patientSummary: null,
    reviewHash: null,
    deletedAt: null,
    createdAt: at(ms - 5 * 60_000),
    updatedAt: at(ms),
  });
  return [
    {
      ...base("seed-jane", "Jane Doe", "xray", "Chest X-ray", "camera", now - 2 * 60 * 60_000),
      findings: [
        finding("f1", 0, "Right lower lobe opacity", 91, "#F5B400"),
        finding("f2", 1, "Blunted costophrenic angle", 78, "#4A90E2"),
        finding("f3", 2, "Cardiomegaly", 84, "#34C759"),
      ],
      shares: [{ id: "sh1", channel: "whatsapp", target: "+2348030000000", sentAt: at(now - 60 * 60_000) }],
    },
    {
      ...base("seed-john", "John Doe", "xray", "Knee X-ray", "gallery", now - day),
      findings: [finding("f1", 0, "Joint space narrowing", 88, "#F5B400")],
      shares: [],
    },
    {
      ...base("seed-fred", "Fred Smith", "skin", "Skin photo", "camera", now - 4 * day),
      findings: [
        finding("f1", 0, "Asymmetric pigmented lesion", 72, "#F5B400"),
        finding("f2", 1, "Irregular border", 69, "#4A90E2"),
      ],
      shares: [{ id: "sh1", channel: "pdf", target: "", sentAt: at(now - 4 * day + 60_000) }],
    },
  ];
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
