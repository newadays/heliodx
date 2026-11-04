import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { intakeCriteria, noteCriteria, prepCriteria, tbCriteria, triageCriteria } from "@/functions/src/eval/grade";
import type { PublicResults, PublicTask } from "@/functions/src/eval/publicSchema";
import { CRITERIA } from "./criteria";
import { loadResults, resultsUrl } from "./data";
import { familyCounts, filterTasks, intervalBar, nextTask, passedCount, readFilter, withParam } from "./format";

const task = (id: string, family: PublicTask["family"], over: Partial<PublicTask> = {}): PublicTask => ({
  id,
  family,
  title: `Task ${id}`,
  split: "held-out",
  tags: [],
  criteria: [
    { id: "a", label: "A", method: "deterministic" },
    { id: "b", label: "B", method: "deterministic" },
  ],
  inputs: { indication: null, variant: null },
  expected: null,
  perSystem: { helio: { runId: "helio-1", score: 0.5, criteria: { a: true, b: false }, latencyMs: 1000, error: null } },
  ...over,
});

const tasks = [task("triage-1", "triage"), task("triage-2", "triage", { tags: ["NIH label: Pneumothorax"] }), task("tb-1", "tb"), task("tb-2", "tb")];

const results: PublicResults = {
  version: 1,
  generatedAt: "2026-11-02T20:00:00.000Z",
  systems: [
    { id: "helio", label: "HelioDX · Muse Glimmer 30B + SAM 3.1", model: "glimmer", precision: "FP8", gpu: "1× GPU", vllm: "0.32.0", runIds: ["helio-1"], commits: ["abc1234"], tasks: 4, errors: 0, costUsd: 1, wallMinutes: 10 },
  ],
  families: [],
  triage: null,
  tb: null,
  tasks,
  limits: [],
  attribution: [],
};

describe("results file", () => {
  it("reads latest.json, or runs/<file> next to it, and never an odd ?run value", () => {
    const base = "https://example.org/results/latest.json";
    expect(resultsUrl(base, "")).toBe(base);
    expect(resultsUrl(base, "?run=20261102T200000Z.json")).toBe("https://example.org/results/runs/20261102T200000Z.json");
    expect(resultsUrl(base, "?run=../../secret")).toBe(base);
    expect(resultsUrl(undefined, "")).toBeNull();
  });

  it("loads a valid file, and reports a missing or mismatched one", async () => {
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    expect((await loadResults("x", ok(results))).status).toBe("ready");
    expect((await loadResults("x", ok({ version: 2 }))).status).toBe("invalid");
    expect((await loadResults("x", (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).status).toBe("missing");
    expect((await loadResults("x", (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).status).toBe("missing");
    expect((await loadResults(null)).status).toBe("missing");
  });
});

describe("interval bar", () => {
  it("places the interval and the point on a 0–100 track", () => {
    expect(intervalBar(0.188, [0.089, 0.353])).toEqual({ left: 8.9, width: 26.4, point: 18.8 });
    expect(intervalBar(1, [0.845, 1])?.point).toBe(100);
    expect(intervalBar(null, [0.2, 0.2])).toEqual({ left: 20, width: 0.5, point: null });
    expect(intervalBar(0.5, null)).toBeNull();
  });
});

describe("task list", () => {
  it("counts families and filters by family, search and grading", () => {
    expect(familyCounts(tasks)).toEqual([
      { id: "triage", label: "Triage", count: 2 },
      { id: "tb", label: "Screening clinic", count: 2 },
    ]);
    const f = (search: string) => filterTasks(tasks, readFilter(new URLSearchParams(search)), results.systems).map((t) => t.id);
    expect(f("family=tb")).toEqual(["tb-1", "tb-2"]);
    expect(f("q=pneumo")).toEqual(["triage-2"]);
    expect(f("q=glimmer")).toHaveLength(4);
    expect(f("grading=agent")).toEqual([]);
    expect(f("family=nonsense")).toHaveLength(4);
  });

  it("finds the next task in the filtered list, and edits one query key", () => {
    expect(nextTask(tasks, "triage-2")?.id).toBe("tb-1");
    expect(nextTask(tasks, "tb-2")).toBeNull();
    expect(withParam("?family=tb&q=x", "q", null)).toBe("?family=tb");
    expect(withParam("", "family", null)).toBe("");
    expect(withParam("?family=tb", "system", "medgemma")).toBe("?family=tb&system=medgemma");
  });

  it("counts passed criteria per system", () => {
    expect(passedCount(tasks[0], "helio")).toEqual({ passed: 1, total: 2 });
    expect(passedCount(tasks[0], "medgemma")).toBeNull();
  });
});

describe("criteria texts", () => {
  it("cover every criterion the graders emit, family by family", () => {
    const emitted = [
      ...(["clean", "blur", "lowres", "nonmedical"] as const).flatMap((v) => intakeCriteria(v).map((c) => `intake:${c.id}`)),
      ...(["routine", "urgent", "critical"] as const).flatMap((l) => triageCriteria(l).map((c) => `triage:${c.id}`)),
      ...(["normal", "attention"] as const).flatMap((p) => prepCriteria(p).map((c) => `prep:${c.id}`)),
      ...noteCriteria().map((c) => `note:${c.id}`),
      ...[...tbCriteria("tb", true), ...tbCriteria("normal")].map((c) => `tb:${c.id}`),
    ];
    for (const key of new Set(emitted)) expect(CRITERIA[key], key).toBeDefined();
    expect(Object.keys(CRITERIA).sort()).toEqual([...new Set(emitted)].sort());
  });
});

describe("guard", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
    });

  it("has no alert, confirm, prompt, window.open, storage, Firebase or stray hue", () => {
    for (const f of files(__dirname)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(alert|confirm|prompt)\(|window\.open|localStorage|firebase|Muse Spark/);
      if (f.endsWith(".css")) expect(src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g), f).toBeNull();
    }
  });
});
