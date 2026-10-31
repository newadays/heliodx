/**
 * E2 · `--mock`: a fixture model and a fixture SAM, so the runner and its
 * grading are tested without a GPU. The fixture model always reads a PA chest
 * X-ray, so the non-medical intake tasks are expected to fail under it.
 */
import type { generateJson } from "../models/client";
import type { SegmentResponse } from "../models/gpu";
import type { Segmenter } from "../tools/segment";

const ANSWERS: Record<string, unknown> = {
  quality_check: {
    decision: "accept",
    quality: { ok: true, issues: [] },
    looksMedical: true,
    modality: "xray",
    studyType: "Chest X-ray",
    view: "PA",
  },
  classifying: { priority: "routine", evidence: ["cardiothoracic_ratio"], rationale: "Measurements are within their limits." },
  detecting: {
    proposed: [
      { title: "Heart size within limits", description: "The cardiothoracic ratio is within its threshold.", evidence: ["cardiothoracic_ratio"], region: "none" },
      { title: "Lung fields symmetric", description: "Both lung outlines are similar in size.", evidence: ["lung_area_asymmetry"], region: "none" },
    ],
    clinicianSummary: {
      findings: "Heart size within limits. Lung fields symmetric.",
      impression: ["No acute abnormality on the measured regions."],
      recommendation: "Correlate clinically. Repeat the film if symptoms persist.",
      highlights: [],
    },
  },
  summarizing: {
    body: "Your clinician looked at your chest picture. The parts that were measured look as expected.",
    nextSteps: ["Talk with your clinician about how you feel.", "Come back for another picture if you still feel unwell."],
  },
};

export const mockGenerate = (async (input: { step: string }) => {
  const answer = ANSWERS[input.step];
  if (!answer) throw new Error(`no mock answer for step ${input.step}`);
  return structuredClone(answer);
}) as unknown as typeof generateJson;

/** Run-length mask of a rectangle (x0..x1, y0..y1 inclusive) on a w×h grid, starting with a false run. */
function rectRle(w: number, h: number, x0: number, x1: number, y0: number, y1: number): number[] {
  const counts: number[] = [];
  let on = false;
  let run = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      if (v === on) run++;
      else {
        counts.push(run);
        on = v;
        run = 1;
      }
    }
  }
  counts.push(run);
  return counts;
}

/** Two rectangular lungs on a 100×100 grid: patient's left lung on the image's right. */
export const mockSegment: Segmenter = async (_image, prompts) => {
  const W = 100;
  const lungs: Record<string, [number, number]> = { "left lung": [60, 89], "right lung": [10, 39] };
  const res: SegmentResponse = {
    width: W,
    height: W,
    ms: 1,
    detections: prompts
      .filter((p) => lungs[p])
      .map((p) => {
        const [x0, x1] = lungs[p];
        return { prompt: p, score: 0.9, box: [x0 / W, 0.1, (x1 + 1) / W, 0.9], area_px: (x1 - x0 + 1) * 80, rle: rectRle(W, W, x0, x1, 10, 89) };
      }),
  };
  return res;
};
