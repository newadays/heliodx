/**
 * F11 · Upload the demo samples fetched by `data/fetch_demo_samples.py`.
 *
 *   npx tsx scripts/upload-samples.ts                 # local emulators
 *   SEED_TARGET=project npx tsx scripts/upload-samples.ts   # the live project (ADC)
 *
 * Writes Storage `samples/{id}.jpg`, Firestore `samples/{id}` (what the
 * picker shows: title, synthetic indication, age/sex, view, order) and
 * `sampleLabels/{id}` (the NIH label, kept for evaluations; no client can
 * read it, so the picker never gives the answer away).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "heliodx";
const BUCKET = process.env.SAMPLES_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;
if (process.env.SEED_TARGET !== "project") {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
}

interface ManifestSample {
  id: string;
  order: number;
  title: string;
  age: number;
  sex: "F" | "M";
  view: string;
  indication: string;
  nihLabel: string;
  critical: boolean;
  source: Record<string, unknown>;
}

async function main(): Promise<void> {
  const dir = resolve(__dirname, "../../data/out");
  const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as { citation: string; samples: ManifestSample[] };
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const target = process.env.SEED_TARGET === "project" ? `project ${PROJECT_ID}` : "emulators";

  for (const s of manifest.samples) {
    const storagePath = `samples/${s.id}.jpg`;
    await bucket.upload(resolve(dir, "samples", `${s.id}.jpg`), { destination: storagePath, contentType: "image/jpeg", resumable: false });
    await db.collection("samples").doc(s.id).set({
      title: s.title,
      storagePath,
      contentType: "image/jpeg",
      age: s.age,
      sex: s.sex,
      view: s.view,
      indication: s.indication,
      order: s.order,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection("sampleLabels").doc(s.id).set({ nihLabel: s.nihLabel, critical: s.critical, source: s.source, citation: manifest.citation });
    console.log(`uploaded ${s.id} (${s.title})`);
  }
  console.log(`${manifest.samples.length} samples → ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
