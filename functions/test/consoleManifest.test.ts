import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CoordinatorPlanSchema } from "../src/coordinator/plan";
import { CONSOLE_AGENTS, CONSOLE_TOOLS, isModelCall, manifestModels } from "../src/lib/consoleManifest";
import { STEP_NAME } from "../src/radiology/reads";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Every name the backend writes to a trace: literal `name: "…"` near a trace write, and the measurement tools. */
function tracedNames(): string[] {
  const names = new Set<string>();
  for (const file of sources(join(__dirname, "../src"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(traceEvent\(\{|kind: "(?:tool|check|model)")[\s\S]{0,240}?name: "([a-z_]+)"/g)) names.add(m[2]);
    for (const m of src.matchAll(/tool: "([a-z_]+)"/g)) names.add(m[1]);
  }
  // The coordinator traces its actions by name (`name: a.action`).
  for (const action of CoordinatorPlanSchema.shape.actions.element.shape.action.options) names.add(action);
  // B14: the read steps are traced by name (`name: STEP_NAME[step]`).
  for (const n of Object.values(STEP_NAME)) names.add(n);
  return [...names].filter((n) => !isModelCall(n));
}

describe("console manifest", () => {
  it("lists every tool or check the backend traces, so the console can describe and count it", () => {
    const listed = new Set(CONSOLE_TOOLS.map((t) => t.name));
    const traced = tracedNames();
    expect(traced.length).toBeGreaterThan(10);
    expect(traced.filter((n) => !listed.has(n))).toEqual([]);
  });

  it("has unique names, owners that exist and agents in order", () => {
    expect(new Set(CONSOLE_TOOLS.map((t) => t.name)).size).toBe(CONSOLE_TOOLS.length);
    const owners = new Set<string>([...CONSOLE_AGENTS.map((a) => a.id), "clinician", "system"]);
    expect(CONSOLE_TOOLS.filter((t) => !owners.has(t.owner))).toEqual([]);
    expect(CONSOLE_AGENTS.map((a) => a.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(manifestModels()).toEqual(["Muse Wonder", "Glimmer", "SAM 3.1"]);
  });
});
