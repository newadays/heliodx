import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { STUDY_STATUSES } from "../src/study/stateMachine";

describe("status list parity", () => {
  it("matches the shared types/study.ts STUDY_STATUSES exactly, in order", () => {
    const src = readFileSync(resolve(__dirname, "..", "..", "types", "study.ts"), "utf8");
    const block = /export const STUDY_STATUSES = \[([\s\S]*?)\] as const;/.exec(src)?.[1] ?? "";
    const appStatuses = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(appStatuses).toEqual([...STUDY_STATUSES]);
  });
});
