/** B11 intake's chest path against the Storage emulator: masks saved, chest confirmed, study type named. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { encodeRleForTest } from "./rleTestUtil";
import { runIntake } from "../../src/stages/intake";

let app: App;
beforeAll(() => {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  app = initializeApp({ projectId: "heliodx-rules-test-b11", storageBucket: "heliodx-b11-test" });
});
afterAll(async () => {
  await deleteApp(app);
});

describe("runIntake chest path", () => {
  it("segments the lungs, confirms a chest X-ray and names it with the view", async () => {
    const w = 1000, h = 800;
    const px = Buffer.alloc(w * h);
    for (let i = 0; i < px.length; i++) px[i] = 40 + ((i * 7919) % 170);
    const image = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).jpeg().toBuffer();
    const mask = (x0: number, x1: number) => {
      const m = new Uint8Array(w * h);
      for (let y = 80; y < 720; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
      return encodeRleForTest(m);
    };
    const segment = vi.fn(async () => ({
      width: w, height: h, ms: 3,
      detections: [
        { prompt: "left lung", score: 0.74, box: [0.55, 0.1, 0.9, 0.9], area_px: 1, rle: mask(550, 900) },
        { prompt: "right lung", score: 0.71, box: [0.1, 0.1, 0.45, 0.9], area_px: 1, rle: mask(100, 450) },
      ],
    }));
    const generate = vi.fn(async () => ({
      decision: "accept", quality: { ok: true, issues: [] }, looksMedical: true,
      modality: "xray", studyType: "Chest radiograph", view: "PA",
    }));
    const out = await runIntake(
      { image, modalityHint: "xray", clinicalContext: "", bucket: "heliodx-b11-test", studyPrefix: `studies/o/${randomUUID()}`, step: "quality_check" },
      { generate: generate as never, segment },
    );
    expect(out.chest).toBe(true);
    expect(out.studyType).toBe("Chest X-ray (PA)");
    expect(out.masks.map((m) => m.label).sort()).toEqual(["left lung", "right lung"]);
    expect(segment).toHaveBeenCalledTimes(1);
  });
});
