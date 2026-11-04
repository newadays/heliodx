import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { confidenceFor, margin, strengthOf } from "../src/lib/strength";
import { assertsCondition, stripConditionSentences } from "../src/lib/vocabulary";
import { traceCapture, type CapturedEvent } from "../src/lib/trace";
import { HEART_REGION, prepDiagnosisHits, runPrep } from "../src/stages/prep";
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
    {
      generate: vi.fn(async () => ({
        // B25 fields default to a pertinent normal.
        proposed: proposed.map((p) => ({ abnormal: false, location: "none", pattern: "none", ...(p as object) })),
        clinicianSummary: summary(proposed.length),
      })) as never,
      saveOverlay,
    },
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

  it("B25: draws an abnormal observation on the zone it names, with its own overlay", async () => {
    const { out, saveOverlay } = await prep([
      { title: "Patchy opacity in the right upper zone", description: "Patchy opacity at the right apex.", evidence: ["right-lung"], region: "right-lung", abnormal: true, location: "right lung upper zone" },
      { title: "Heart size within normal limits", description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none" },
    ]);
    const [opacity, heart] = out.findings;
    expect(opacity.abnormal).toBe(true);
    expect(opacity.location).toBe("right lung upper zone");
    // Right lung box x 0.1–0.45; chest height 0.1–0.9, so the upper third is 0.1–0.367.
    expect(opacity.outlines).toEqual([{ kind: "zone", side: "right", zone: "upper", box: [0.1, 0.1, 0.45, 0.367] }]);
    expect(opacity.region).toEqual({ shape: "ellipse", x: 0.1, y: 0.1, w: 0.35, h: 0.267 });
    expect(opacity.overlayPath).toBe("studies/o/s/overlays/zone-f1.png");
    expect(heart.abnormal).toBe(false);
    expect(heart.outlines).toEqual([]);
    expect(saveOverlay).toHaveBeenCalledTimes(2); // the zone and the heart region
  });

  it("B25: traces a locate_zone row per abnormal observation, none for normals", async () => {
    const events: CapturedEvent[] = [];
    await traceCapture("prep", (e) => events.push(e), () =>
      prep([
        { title: "Patchy opacity", description: "Right apex.", evidence: ["right-lung"], region: "right-lung", abnormal: true, location: "right lung upper zone" },
        { title: "Hazy area", description: "Somewhere.", evidence: ["left-lung"], region: "left-lung", abnormal: true, location: "somewhere" },
        { title: "Heart size within normal limits", description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none" },
      ]),
    );
    const rows = events.filter((e) => e.name === "locate_zone");
    expect(rows.map((e) => [e.ok, e.result])).toEqual([
      [true, "right lung upper zone · zone outline"],
      [false, "location not readable · cited region kept"],
    ]);
  });

  it("B25: an abnormal observation with an unreadable location keeps its cited region", async () => {
    const { out } = await prep([
      { title: "Hazy opacity", description: "Hazy opacity.", evidence: ["left-lung"], region: "left-lung", abnormal: true, location: "somewhere" },
    ]);
    expect(out.findings[0].outlines).toEqual([]);
    expect(out.findings[0].region?.x).toBe(0.55);
    expect(out.findings[0].overlayPath).toBe("o/left-lung.png");
  });

  it("B26: tags an abnormal pattern of concern and drops a title that names a disease", async () => {
    const { out } = await prep([
      { title: "Patchy opacity in the right upper zone", description: "Right apex.", evidence: ["right-lung"], region: "right-lung", abnormal: true, location: "right upper zone", pattern: "pattern_of_concern" },
      { title: "Tuberculosis in the right apex", description: "Cavity.", evidence: ["right-lung"], region: "right-lung", abnormal: true, location: "right upper zone", pattern: "tb_suggestive" },
      { title: "Heart size within normal limits", description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none", pattern: "pattern_of_concern" },
    ]);
    expect(out.findings.map((f) => [f.title, f.pattern])).toEqual([
      ["Patchy opacity in the right upper zone", "pattern_of_concern"],
      ["Heart size within normal limits", "none"], // a pattern counts only on an abnormal observation
    ]);
    expect(out.dropped.conditions).toBe(1);
    expect(out.clinicianSummary).not.toHaveProperty("considerations");
    expect(JSON.stringify(out.clinicianSummary)).not.toMatch(/pneumonia|tuberculosis/i);
  });

  it("compliance: asks again once when the answer names a disease, and keeps the clean second answer", async () => {
    const image = await sharp(Buffer.alloc(W * W, 120), { raw: { width: W, height: W, channels: 1 } }).jpeg().toBuffer();
    const clean = { findings: "Heart size within normal limits.", impression: ["Normal cardiac size."], recommendation: "Clinical correlation.", highlights: [] };
    const answer = (title: string) => ({
      proposed: [{ title, description: "CTR 0.44.", evidence: ["cardiothoracic_ratio"], region: "none", abnormal: false, location: "none", pattern: "none" }],
      clinicianSummary: clean,
    });
    const run = (second: string) => {
      const generate = vi.fn().mockResolvedValueOnce(answer("Findings consistent with heart failure")).mockResolvedValueOnce(answer(second));
      const events: CapturedEvent[] = [];
      const done = traceCapture("prep", (e) => events.push(e), () =>
        runPrep(
          { image, studyType: "Chest X-ray (PA)", clinicalContext: "", masks, measurements, flags: [], heartBox: null, overlays: {}, bucket: "b", studyPrefix: "s", step: "detecting" },
          { generate: generate as never, saveOverlay: vi.fn() as never },
        ),
      );
      return { generate, events, done };
    };
    const fixed = run("Heart size within normal limits");
    const out = await fixed.done;
    const generate = fixed.generate;
    expect(fixed.events.find((e) => e.name === "no_diagnosis")).toMatchObject({ ok: true, result: "passed after one re-ask" });
    const failed = run("Cardiomegaly");
    await failed.done.catch(() => null); // nothing survives the filter: the stage fails visibly
    expect(failed.events.find((e) => e.name === "no_diagnosis")).toMatchObject({ ok: false });
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls[1][0] as { prompt: string }).prompt).toContain("Your previous answer named a disease");
    expect(out.findings.map((f) => f.title)).toEqual(["Heart size within normal limits"]);
    expect(out.dropped.conditions).toBe(0);
  });

  it("compliance: lists every model text that breaks the rule", () => {
    const hits = prepDiagnosisHits({
      proposed: [{ title: "Opacity", description: "Likely infective." }],
      clinicianSummary: { findings: "No pneumothorax.", impression: ["Pneumonia."], recommendation: "Not a diagnosis." },
    });
    expect(hits).toEqual(["description 1: likely infective", "impression 1: pneumonia"]);
  });

  it("fails visibly when nothing survives, rather than returning an empty draft", async () => {
    await expect(prep([{ title: "X", description: "Y", evidence: ["nope"], region: "none" }])).rejects.toMatchObject({ code: "schema_invalid" });
  });
});
