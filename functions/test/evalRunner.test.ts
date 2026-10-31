import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { mockGenerate, mockSegment } from "../src/eval/mock";
import { runTask, type RunDeps } from "../src/eval/runner";
import { buildTasks, noteTask, type Film } from "../src/eval/tasks";
import type { EvalTask } from "../src/eval/types";

/** A smooth greyscale "film" with texture, sharp enough to pass the quality checks at 1024 px. */
async function film(): Promise<Buffer> {
  const w = 1024;
  const px = Buffer.alloc(w * w);
  for (let i = 0; i < px.length; i++) px[i] = 40 + ((i * 7919) % 170);
  return sharp(px, { raw: { width: w, height: w, channels: 1 } }).jpeg().toBuffer();
}

const films: Film[] = ["No Finding", "Cardiomegaly", "Pneumothorax", "Effusion", "No Finding"].map((label, i) => ({
  id: `nih-test-${i}`,
  nihLabel: label,
  age: 40 + i,
  sex: i % 2 ? "F" : "M",
  demo: i < 2,
  source: { dataset: "d", split: "test", rowIdx: i, nih: "https://example.org/nih" },
}));

const deps = async (): Promise<RunDeps> => {
  const buf = await film();
  return { system: "helio", model: "mock", generate: mockGenerate, segment: mockSegment, loadFilm: async () => buf, gpuUsdPerHour: 3.6 };
};
const byId = (tasks: EvalTask[], id: string) => tasks.find((t) => t.id === id)!;

describe("task library", () => {
  it("builds intake variants for the first films, triage and prep for every film, and two non-medical images", () => {
    const tasks = buildTasks(films);
    const count = (f: string) => tasks.filter((t) => t.family === f).length;
    expect([count("intake"), count("triage"), count("prep")]).toEqual([4 * 3 + 2, 5, 5]);
    expect(byId(tasks, "triage-3").expected.lane).toBe("critical");
    expect(byId(tasks, "prep-1").expected.polarity).toBe("normal");
    expect(tasks.every((t) => !/pneumothorax|effusion|cardiomegaly/i.test(t.title))).toBe(true);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });
});

describe("runTask (mock model and SAM)", () => {
  const tasks = buildTasks(films);

  it("grades intake variants from how they were built", async () => {
    const d = await deps();
    const clean = await runTask(byId(tasks, "intake-clean-1"), d);
    expect(clean.error).toBeNull();
    expect(clean.score).toBe(1);
    const blur = await runTask(byId(tasks, "intake-blur-1"), d);
    expect(blur.criteria.map((c) => c.pass)).toEqual([true, true]);
    const low = await runTask(byId(tasks, "intake-lowres-1"), d);
    expect(low.score).toBe(1);
    // The fixture model always says "medical", so this one fails by design.
    const photo = await runTask(byId(tasks, "intake-nonmedical-1"), d);
    expect(photo.criteria.find((c) => c.id === "not_medical")?.pass).toBe(false);
  });

  it("runs triage and prep through the real stages with in-memory masks", async () => {
    const d = await deps();
    const triage = await runTask(byId(tasks, "triage-1"), d);
    expect(triage.error).toBeNull();
    expect(triage.output.priority).toBe("routine");
    expect(triage.criteria.find((c) => c.id === "lane")?.pass).toBe(true);
    const prep = await runTask(byId(tasks, "prep-1"), d);
    expect(prep.error).toBeNull();
    expect(prep.criteria.find((c) => c.id === "drafted")?.pass).toBe(true);
    expect(prep.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("writes and grades a patient note from signed text", async () => {
    const task = noteTask(1, null, {
      studyType: "Chest X-ray (PA)",
      findings: "Heart size within limits.",
      impression: ["No acute abnormality on the measured regions."],
      recommendation: "Correlate clinically. Repeat the film if symptoms persist.",
    });
    const r = await runTask(task, await deps());
    expect(r.error).toBeNull();
    expect(r.criteria.find((c) => c.id === "steps")?.pass).toBe(true);
    expect((r.output.nextSteps as string[]).length).toBe(2);
  });

  it("records a crash as a failed task, not a missing one", async () => {
    const d = await deps();
    const r = await runTask(byId(tasks, "triage-1"), { ...d, loadFilm: async () => Promise.reject(new Error("no film")) });
    expect(r.error).toContain("no film");
    expect(r.score).toBe(0);
  });
});
