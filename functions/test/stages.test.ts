import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { PipelineError } from "../src/pipeline/errors";
import { runIntake } from "../src/stages/intake";
import { maxPriority, priorityFloor, validEvidence } from "../src/stages/priority";
import { runTriage } from "../src/stages/triage";
import type { MaskRecord } from "../src/tools/segment";

/** A noisy greyscale JPEG, sharp enough to pass the quality checks. */
async function film(w = 1000, h = 800): Promise<Buffer> {
  const px = Buffer.alloc(w * h);
  for (let i = 0; i < px.length; i++) px[i] = 40 + ((i * 7919) % 170);
  return sharp(px, { raw: { width: w, height: h, channels: 1 } }).jpeg().toBuffer();
}

const intakeDraft = (over: Record<string, unknown> = {}) => ({
  decision: "accept",
  quality: { ok: true, issues: [] },
  looksMedical: true,
  modality: "skin",
  studyType: "Skin lesion photo",
  view: "other",
  ...over,
});
const base = { modalityHint: "xray" as const, clinicalContext: "", bucket: "b", studyPrefix: "studies/o/s", step: "quality_check" as const };

describe("priority rules", () => {
  it("takes the higher priority, floors from threshold flags, and keeps only real evidence ids", () => {
    expect(maxPriority("routine", "urgent")).toBe("urgent");
    expect(maxPriority("critical", "routine")).toBe("critical");
    expect(priorityFloor([])).toBe("routine");
    expect(priorityFloor([{ measurementId: "lung_area_asymmetry", level: "critical", value: 0.3, threshold: 0.25 }])).toBe("critical");
    expect(validEvidence(["density_ratio", "made_up", "left-lung", "density_ratio"], ["density_ratio", "left-lung"])).toEqual([
      "density_ratio",
      "left-lung",
    ]);
  });
});

describe("runIntake", () => {
  it("accepts a readable non-X-ray image without calling SAM", async () => {
    const segment = vi.fn();
    const out = await runIntake({ ...base, image: await film() }, { generate: vi.fn(async () => intakeDraft()) as never, segment });
    expect(out.retake).toBe(false);
    expect(segment).not.toHaveBeenCalled();
    expect(out.studyType).toBe("Skin lesion photo");
    expect(out.metrics.width).toBe(1000);
  });

  it("asks for a retake when the model says so, or the image is not medical", async () => {
    const img = await film();
    const retake = await runIntake({ ...base, image: img }, { generate: vi.fn(async () => intakeDraft({ decision: "retake" })) as never });
    expect(retake.retake).toBe(true);
    const notMedical = await runIntake({ ...base, image: img }, { generate: vi.fn(async () => intakeDraft({ looksMedical: false })) as never });
    expect(notMedical.retake).toBe(true);
    expect(notMedical.quality.issues).toContain("This does not look like a medical image.");
  });

  it("asks for a retake when the resolution is objectively too low, whatever the model says", async () => {
    const out = await runIntake({ ...base, image: await film(400, 300) }, { generate: vi.fn(async () => intakeDraft()) as never });
    expect(out.retake).toBe(true);
    expect(out.quality.issues).toContain("Image resolution is too low.");
  });

  it("continues without masks when SAM fails", async () => {
    const out = await runIntake(
      { ...base, image: await film() },
      {
        generate: vi.fn(async () => intakeDraft({ modality: "xray", studyType: "Chest X-ray", view: "PA" })) as never,
        segment: vi.fn(async () => {
          throw new Error("SAM down");
        }),
      },
    );
    expect(out.retake).toBe(false);
    expect(out.samError).toContain("SAM down");
    expect(out.chest).toBe(false);
  });
});

// Two rectangular lungs on a 100x100 image: CTR 0.25, symmetric, no flags.
const W = 100;
function rect(x0: number, x1: number, y0: number, y1: number): Uint8Array {
  const m = new Uint8Array(W * W);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
  return m;
}
const rec = (label: MaskRecord["label"], maskId: string): MaskRecord => ({
  label, maskId, score: 0.7, box: [0, 0, 1, 1], areaPx: 1, width: W, height: W, path: `p/${maskId}`,
});
const masks = [rec("left lung", "left-lung"), rec("right lung", "right-lung")];
const shapes: Record<string, Uint8Array> = { "left-lung": rect(60, 89, 10, 89), "right-lung": rect(10, 39, 10, 89) };
const smallLeft: Record<string, Uint8Array> = { "left-lung": rect(60, 89, 10, 45), "right-lung": rect(10, 39, 10, 89) };

async function triage(opts: { generate: unknown; shapes?: Record<string, Uint8Array>; samError?: string | null; chest?: boolean }) {
  const img = await sharp(Buffer.alloc(W * W, 120), { raw: { width: W, height: W, channels: 1 } }).jpeg().toBuffer();
  return runTriage(
    {
      image: img, masks, chest: opts.chest ?? true, samError: opts.samError ?? null, studyType: "Chest X-ray (PA)", view: "PA",
      bucket: "b", studyPrefix: "studies/o/s", step: "classifying",
    },
    {
      generate: opts.generate as never,
      loadMask: vi.fn(async (_b: string, r: MaskRecord) => (opts.shapes ?? shapes)[r.maskId]),
      saveOverlay: vi.fn(async (_b: string, prefix: string, r: MaskRecord) => `${prefix}/overlays/${r.maskId}.png`),
    },
  );
}
const triageDraft = (over: Record<string, unknown> = {}) => ({
  priority: "routine", evidence: ["cardiothoracic_ratio"], rationale: "Measurements within limits.", ...over,
});

describe("runTriage", () => {
  it("measures, renders overlays and keeps a routine priority when nothing is flagged", async () => {
    const out = await triage({ generate: vi.fn(async () => triageDraft()) });
    expect(out.priority).toBe("routine");
    expect(out.measurements.find((m) => m.id === "cardiothoracic_ratio")?.value).toBe(0.25);
    expect(Object.keys(out.overlays).sort()).toEqual(["left-lung", "right-lung"]);
    expect(out.confidence).toBe("high"); // measured, nothing flagged
  });

  it("never lets the model lower the priority below the threshold floor", async () => {
    const out = await triage({ generate: vi.fn(async () => triageDraft({ priority: "routine" })), shapes: smallLeft });
    expect(out.floor).toBe("critical"); // left field less than half the right
    expect(out.priority).toBe("critical");
    expect(out.confidence).toBe("medium"); // a threshold was crossed
  });

  it("lets the model raise the priority, and drops evidence ids that do not exist", async () => {
    const out = await triage({ generate: vi.fn(async () => triageDraft({ priority: "urgent", evidence: ["density_ratio", "invented"] })) });
    expect(out.priority).toBe("urgent");
    expect(out.evidence).toEqual(["density_ratio"]);
  });

  it("escalates to at least urgent with needsHuman when the model call fails for good", async () => {
    const out = await triage({ generate: vi.fn(async () => { throw new PipelineError("schema_invalid", "bad", "classifying"); }) });
    expect(out.priority).toBe("urgent");
    expect(out.needsHuman).toBe(true);
  });

  it("lets a transient model failure propagate so the study is requeued", async () => {
    await expect(
      triage({ generate: vi.fn(async () => { throw new PipelineError("model_unavailable", "down", "classifying"); }) }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("marks the draft degraded with low confidence when SAM failed at intake", async () => {
    const out = await triage({ generate: vi.fn(async () => triageDraft()), chest: false, samError: "SAM down" });
    expect(out.degraded).toBe(true);
    expect(out.confidence).toBe("low");
    expect(out.measurements).toEqual([]);
  });
});
