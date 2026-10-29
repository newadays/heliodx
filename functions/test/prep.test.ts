import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { confidenceFor, margin, strengthOf } from "../src/lib/strength";
import { assertsCondition, stripConditionSentences } from "../src/lib/vocabulary";
import { HEART_REGION, runPrep } from "../src/stages/prep";
import type { Measurement } from "../src/tools/measure";
import type { MaskRecord } from "../src/tools/segment";

const m = (id: Measurement["id"], value: number): Measurement => ({ id, value, maskIds: ["left-lung", "right-lung"] });

describe("strength", () => {
  it("is strong far from the threshold either way, weak near it", () => {
    expect(strengthOf([m("cardiothoracic_ratio", 0.44)], [0.72, 0.69])).toBe("strong"); // 20% inside 0.55
    expect(strengthOf([m("cardiothoracic_ratio", 0.53)], [0.72, 0.69])).toBe("weak"); // 3.6% inside
    expect(strengthOf([m("cardiothoracic_ratio", 0.66)], [0.72, 0.69])).toBe("strong"); // 20% past
    expect(strengthOf([m("lung_area_asymmetry", 0.16)], [0.72])).toBe("moderate"); // 6.7% past 0.15
  });

  it("treats density as two-sided around 1", () => {
    expect(margin(m("density_ratio", 1.0))).toBeCloseTo(1);
    expect(strengthOf([m("density_ratio", 1.24)], [0.7])).toBe("weak");
  });

  it("caps outline-only findings at moderate and lowers any finding citing a weak mask", () => {
    expect(strengthOf([], [0.72])).toBe("moderate");
    expect(strengthOf([], [0.55])).toBe("weak");
    expect(strengthOf([m("cardiothoracic_ratio", 0.44)], [0.55])).toBe("moderate");
    expect(strengthOf([], [])).toBe("weak");
  });

  it("maps strength to the app's confidence number", () => {
    expect([confidenceFor("strong"), confidenceFor("moderate"), confidenceFor("weak")]).toEqual([90, 70, 50]);
  });
});

describe("condition filter", () => {
  it("catches asserted conditions and allows negated ones and descriptors", () => {
    expect(assertsCondition("Findings suggestive of pneumonia in the right lower zone.")).toBe(true);
    expect(assertsCondition("Cardiomegaly.")).toBe(true);
    expect(assertsCondition("No pneumothorax.")).toBe(false);
    expect(assertsCondition("Costophrenic angles sharp without pleural effusion.")).toBe(false);
    expect(assertsCondition("Patchy opacity in the right lower zone with consolidation.")).toBe(false);
  });
  it("drops only the offending sentences", () => {
    expect(stripConditionSentences("Lungs are clear. Appearance consistent with tuberculosis. No pneumothorax.")).toBe(
      "Lungs are clear. No pneumothorax.",
    );
  });
});

const W = 100;
const rec = (label: MaskRecord["label"], maskId: string, box: MaskRecord["box"], score: number): MaskRecord => ({
  label, maskId, score, box, areaPx: 1, width: W, height: W, path: `p/${maskId}`,
});
const masks = [rec("left lung", "left-lung", [0.55, 0.1, 0.9, 0.9], 0.72), rec("right lung", "right-lung", [0.1, 0.1, 0.45, 0.9], 0.69)];
const measurements = [m("cardiothoracic_ratio", 0.44), m("lung_area_asymmetry", 0.11), m("cp_blunting_left", 0)];
const summary = (n: number) => ({
  findings: "Heart size within normal limits. Lung fields symmetric. Appearance of pneumonia on the right.",
  impression: ["Normal cardiac size.", "Pneumonia likely."],
  recommendation: "Clinical correlation.",
  highlights: Array.from({ length: n }, (_, i) => ({ findingIndex: i, quote: i === 0 ? "Heart size within normal limits" : "Lung fields symmetric" })),
});

async function prep(proposed: unknown[]) {
  const image = await sharp(Buffer.alloc(W * W, 120), { raw: { width: W, height: W, channels: 1 } }).jpeg().toBuffer();
  const saveOverlay = vi.fn(async (_b: string, prefix: string, r: MaskRecord) => `${prefix}/overlays/${r.maskId}.png`);
  const out = await runPrep(
    {
      image, studyType: "Chest X-ray (PA)", clinicalContext: "", masks, measurements, flags: [],
      heartBox: [0.4, 0.6, 0.6, 0.85], overlays: { "left-lung": "o/left-lung.png", "right-lung": "o/right-lung.png" },
      bucket: "b", studyPrefix: "studies/o/s", step: "detecting",
    },
    { generate: vi.fn(async () => ({ proposed, clinicianSummary: summary(proposed.length) })) as never, saveOverlay },
  );
  return { out, saveOverlay };
}

describe("runPrep", () => {
  it("grounds each observation: real evidence, strength in code, region and overlay from SAM", async () => {
    const { out, saveOverlay } = await prep([
      { title: "Heart size within normal limits", description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none" },
      { title: "Lung fields symmetric", description: "Areas within 11%.", evidence: ["lung_area_asymmetry", "left-lung", "right-lung"], region: "left-lung" },
    ]);
    const [heart, lungs] = out.findings;
    expect(heart.strength).toBe("strong");
    expect(heart.confidence).toBe(90);
    expect(heart.region).toEqual({ shape: "ellipse", x: 0.4, y: 0.6, w: 0.2, h: 0.25 }); // derived heart region
    expect(heart.overlayPath).toBe(`studies/o/s/overlays/${HEART_REGION}.png`);
    expect(saveOverlay).toHaveBeenCalledTimes(1);
    expect(lungs.evidence).toEqual({ measurementIds: ["lung_area_asymmetry"], maskIds: ["left-lung", "right-lung"] });
    expect(lungs.region?.x).toBe(0.55);
    expect(lungs.overlayPath).toBe("o/left-lung.png");
  });

  it("drops observations with no real evidence or that assert a condition, and filters the summary", async () => {
    const { out } = await prep([
      { title: "Heart size within normal limits", description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none" },
      { title: "Right lower zone pneumonia", description: "Consolidation.", evidence: ["right-lung"], region: "right-lung" },
      { title: "Something", description: "Invented.", evidence: ["made_up_id"], region: "none" },
    ]);
    expect(out.findings.map((f) => f.title)).toEqual(["Heart size within normal limits"]);
    expect(out.dropped).toEqual({ conditions: 1, noEvidence: 1 });
    expect(out.clinicianSummary.findings).not.toMatch(/pneumonia/i);
    expect(out.clinicianSummary.impression).toEqual(["Normal cardiac size."]);
    expect(out.clinicianSummary.highlights.map((h) => h.findingId)).toEqual(["f1"]);
  });

  it("fails visibly when nothing survives, rather than returning an empty draft", async () => {
    await expect(prep([{ title: "X", description: "Y", evidence: ["nope"], region: "none" }])).rejects.toMatchObject({ code: "schema_invalid" });
  });
});
