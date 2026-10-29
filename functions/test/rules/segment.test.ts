/**
 * B9 against the Storage emulator: masks are saved, the cache skips labels
 * already segmented, masks round-trip, overlays are written.
 */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodeRleForTest } from "./rleTestUtil";
import { saveOverlay } from "../../src/tools/overlay";
import { loadMask, segmentRegions } from "../../src/tools/segment";

let app: App;
const BUCKET = "heliodx-b9-test";

beforeAll(() => {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  // The tools use the default app, as the deployed functions do.
  app = initializeApp({ projectId: "heliodx-rules-test-b9", storageBucket: BUCKET });
});
afterAll(async () => {
  await deleteApp(app);
});

const W = 8, H = 4;
const leftMask = Uint8Array.from({ length: W * H }, (_, i) => ((i % W) >= 5 ? 1 : 0));
const fakeSam = (calls: string[][], hide: string[] = []) => async (_img: Buffer, prompts: string[]) => {
  calls.push(prompts);
  return {
    width: W, height: H, ms: 5,
    detections: [
      { prompt: "left lung", score: 0.74, box: [0.62, 0, 1, 1], area_px: 12, rle: encodeRleForTest(leftMask) },
      { prompt: "right lung", score: 0.71, box: [0, 0, 0.38, 1], area_px: 12, rle: encodeRleForTest(leftMask.map((v) => 1 - v)) },
    ].filter((d) => prompts.includes(d.prompt) && !hide.includes(d.prompt)),
  };
};

describe("segmentRegions + mask cache", () => {
  it("segments once, stores masks, reports missing labels, and serves the cache next time", async () => {
    const prefix = `studies/org/${randomUUID()}`;
    const calls: string[][] = [];
    const ctx = { bucket: BUCKET, studyPrefix: prefix, image: Buffer.from("img"), step: "classifying" as const };
    const first = await segmentRegions(ctx, ["left lung", "right lung"], fakeSam(calls, ["right lung"]));
    expect(calls).toEqual([["left lung", "right lung"]]);
    expect(first.masks.map((m) => m.label)).toEqual(["left lung"]);
    expect(first.missing).toEqual(["right lung"]);

    const second = await segmentRegions({ ...ctx, cached: first.masks }, ["left lung", "right lung"], fakeSam(calls));
    expect(calls[1]).toEqual(["right lung"]); // only the label not cached yet
    expect(second.fromCache).toEqual(["left lung"]);
    expect(second.masks.map((m) => m.label).sort()).toEqual(["left lung", "right lung"]);

    const left = first.masks.find((m) => m.label === "left lung")!;
    expect(Array.from(await loadMask(BUCKET, left))).toEqual(Array.from(leftMask));

    const overlayPath = await saveOverlay(BUCKET, prefix, left, leftMask, "#4A90E2");
    expect(overlayPath).toBe(`${prefix}/overlays/left-lung.png`);
    const [exists] = await getStorage().bucket(BUCKET).file(overlayPath).exists();
    expect(exists).toBe(true);
  });
});
