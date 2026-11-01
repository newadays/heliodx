import { describe, expect, it, vi } from "vitest";

import type { EvalRun } from "@/functions/src/eval/types";

import { pickFamilyRuns, sortKey } from "./evals";

// The pure helpers only; no Firebase app in unit tests.
vi.mock("~/firebase", () => ({ db: {} }));

const run = (id: string, families: string[], published = true): EvalRun =>
  ({ id, published, summary: Object.fromEntries(families.map((f) => [f, { tasks: 1 }])) }) as unknown as EvalRun;

describe("sortKey", () => {
  it("orders families, then films by number, with TB tasks last", () => {
    const ids = ["tb-10", "prep-2", "tb-2", "intake-blur-1", "intake-clean-1", "note-1", "tb-1", "intake-nonmedical-1"];
    expect([...ids].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual([
      "intake-clean-1",
      "intake-blur-1",
      "intake-nonmedical-1",
      "prep-2",
      "note-1",
      "tb-1",
      "tb-2",
      "tb-10",
    ]);
  });
});

describe("pickFamilyRuns", () => {
  it("keeps the latest published run per family, so a TB-only run does not hide the others", () => {
    const picked = pickFamilyRuns([run("tb-new", ["tb"]), run("draft", ["intake", "tb"], false), run("full", ["intake", "triage", "prep", "note"])]);
    expect(Object.fromEntries(Object.entries(picked).map(([f, r]) => [f, r!.id]))).toEqual({ tb: "tb-new", intake: "full", triage: "full", prep: "full", note: "full" });
  });
});
