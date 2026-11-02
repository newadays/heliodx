import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ATTRIBUTION, LIMITS, README_QUOTES, buildPublicResults, errorClass, expectedText, type LocalRun } from "../src/eval/publicResults";
import { PublicResultsSchema } from "../src/eval/publicSchema";
import { summarize } from "../src/eval/summary";
import { buildTbTasks, type TbFilm } from "../src/eval/tasks";
import type { EvalResult, EvalRun, EvalSystem, EvalTask } from "../src/eval/types";

const film = (n: number, label: "tb" | "normal", split: TbFilm["split"]): TbFilm => ({
  id: `CHNCXR_0${400 + n}_${label === "tb" ? 1 : 0}`,
  dataset: "shenzhen",
  label,
  split,
  reading: label === "tb" ? "right upper PTB with fibrous changes" : "normal",
  age: 41,
  sex: "M",
  roi: label === "tb" ? [[0.12, 0.15, 0.33, 0.31]] : [],
  source: `https://data.example.org/CXR_png/CHNCXR_0${400 + n}.png`,
});

const tbTasks = buildTbTasks([film(1, "tb", "held-out"), film(2, "normal", "held-out"), film(3, "tb", "tuning"), film(4, "normal", "tuning")]);

const triageTask: EvalTask = {
  id: "triage-3",
  title: "Triage film 3",
  family: "triage",
  tags: ["NIH label: Pneumothorax"],
  split: "held-out",
  film: { id: "nih-test-174", nihLabel: "Pneumothorax", rowIdx: 174, source: "https://nihcc.app.box.com/v/ChestXray-NIHCC" },
  context: { age: 65, sex: "M", indication: "Sudden breathlessness.", synthetic: true },
  expected: { lane: "critical" },
  criteria: [{ id: "lane", label: "Lane is critical", method: "deterministic" }],
};

const tasks = [triageTask, ...tbTasks];

function result(task: EvalTask, system: EvalSystem, pass: boolean, error: string | null = null): EvalResult {
  return {
    taskId: task.id,
    family: task.family,
    title: task.title,
    tags: task.tags,
    split: task.split,
    system,
    model: system,
    score: pass ? 1 : 0,
    criteria: task.criteria.map((c) => ({ ...c, pass: error ? null : pass, detail: "Model said: right upper PTB, CHNCXR_0401_1" })),
    output: { rationale: "Patchy opacity suggests tuberculosis at the right apex.", film: task.film?.id },
    latencyMs: 30_000,
    modelMs: 25_000,
    modelCalls: 3,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.04,
    error,
  };
}

function localRun(system: EvalSystem, startedAt: string, results: EvalResult[], runTasks: EvalTask[]): LocalRun {
  const run: EvalRun = {
    id: `${system}-${startedAt.replace(/[-:T.Z]/g, "")}`,
    system,
    label: system === "helio" ? "HelioDX · Muse Glimmer 30B + SAM 3.1" : "MedGemma 27B (+ SAM 3.1 masks)",
    model: system,
    precision: system === "helio" ? "FP8 (per tensor)" : "bf16",
    gpu: "1× NVIDIA RTX PRO 6000",
    commit: "abc1234",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 45 * 60_000).toISOString(),
    gpuUsdPerHour: 4.5,
    published: false,
    vllm: "0.32.0",
    ...summarize(results, runTasks),
  };
  return { run, results };
}

const runs: LocalRun[] = [
  localRun("helio", "2026-11-01T15:00:00.000Z", [result(triageTask, "helio", true)], [triageTask]),
  localRun("helio", "2026-11-02T20:00:00.000Z", tbTasks.map((t, i) => result(t, "helio", i % 2 === 0)), tbTasks),
  localRun("medgemma", "2026-11-01T16:00:00.000Z", [result(triageTask, "medgemma", false)], [triageTask]),
  localRun(
    "medgemma",
    "2026-11-02T21:00:00.000Z",
    tbTasks.map((t, i) => result(t, "medgemma", true, i === 3 ? "Model output failed validation: output truncated (length) 'right upper PTB'" : null)),
    tbTasks,
  ),
];

const data = buildPublicResults({ runs, tasks, vllm: "0.32.0", generatedAt: "2026-11-02T22:00:00.000Z" });

function walk(value: unknown, visit: (key: string | null, v: unknown) => void, key: string | null = null): void {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

describe("buildPublicResults", () => {
  it("validates, and takes each family from the newest run that has it", () => {
    expect(PublicResultsSchema.safeParse(JSON.parse(JSON.stringify(data))).success).toBe(true);
    expect(data.families.map((f) => f.id)).toEqual(["triage", "tb"]);
    expect(data.families.find((f) => f.id === "triage")?.perSystem.helio?.runId).toBe(runs[0].run.id);
    expect(data.families.find((f) => f.id === "tb")?.perSystem.medgemma?.runId).toBe(runs[3].run.id);
    expect(data.systems.map((s) => [s.id, s.runIds.length, s.tasks, s.errors])).toEqual([
      ["helio", 2, 5, 0],
      ["medgemma", 2, 5, 1],
    ]);
  });

  it("reports TB per split and per criterion, and names the set", () => {
    const helio = data.tb!.perSystem.helio!;
    expect(data.tb!.dataset).toMatchObject({ id: "shenzhen", tb: 2, normal: 2 });
    expect(helio.combined.n).toBe(4);
    expect(helio.heldOut?.n).toBe(2);
    expect(helio.tuning?.n).toBe(2);
    expect(Object.keys(helio.criteriaRates)).toContain("tb_flag");
    expect(data.tb!.perSystem.medgemma!.combined.n).toBe(3); // the errored film is left out of n
  });

  it("keeps per-task rows anonymous: no film id, reading, age, sex, ROI, URL or model text anywhere", () => {
    const forbiddenKeys = new Set(["film", "source", "reading", "age", "sex", "roi", "output", "detail", "nihLabel", "rowIdx", "rationale"]);
    const forbiddenText = /CHNCXR|MCUCXR|nih-test|PTB|tuberculosis|example\.org|nihcc|Model said/i;
    walk(data, (key, v) => {
      if (key) expect(forbiddenKeys.has(key), `key ${key}`).toBe(false);
      // Citations name the sets and the papers; everything else is checked.
      if (typeof v === "string" && !ATTRIBUTION.includes(v) && !LIMITS.includes(v) && v !== data.tb?.dataset.citation && v !== data.tb?.dataset.terms) {
        expect(forbiddenText.test(v), v).toBe(false);
      }
    });
    const row = data.tasks.find((t) => t.family === "tb")!;
    expect(row.title).toMatch(/^TB screening · film \d+$/);
    expect(row.inputs).toEqual({ indication: "Adult with a cough for several weeks.", variant: null });
    expect(["TB film", "Normal film"]).toContain(row.expected);
  });

  it("reduces errors to a short class", () => {
    expect(errorClass("intake did not confirm a chest X-ray (lungs not found)")).toBe("Lungs not found at intake");
    expect(errorClass("Model output failed validation: output truncated (length)")).toBe("Answer cut off at the length limit");
    expect(errorClass("Model output failed validation: missing field")).toBe("Answer did not match the schema");
    expect(errorClass("GPU did not answer in time")).toBe("GPU unavailable");
    expect(errorClass("something else said by the model")).toBe("Error");
    expect(errorClass(null)).toBeNull();
  });

  it("says what each family expects in words", () => {
    expect(expectedText(triageTask)).toBe("Critical");
    expect(expectedText(tbTasks.find((t) => t.expected.tbSuggestive)!)).toBe("TB film");
    expect(expectedText({ ...triageTask, family: "intake", expected: { retake: true, blockingReason: "blurred" } })).toBe("Retake: blurred");
  });

  it("quotes limits and citations verbatim from eval/README.md", () => {
    const flat = (s: string) => s.replace(/\s+/g, " ");
    const readme = flat(readFileSync(join(__dirname, "../../eval/README.md"), "utf8").replace(/^> /gm, ""));
    for (const q of README_QUOTES) expect(readme.includes(flat(q)), q.slice(0, 60)).toBe(true);
  });
});
