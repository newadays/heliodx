import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { gradeTb, tbCriteria, type TbFinding, type TbOutcome } from "../src/eval/grade";
import { MOCK_TB_DETECTING, mockGenerate, mockGenerateWith, mockSegment } from "../src/eval/mock";
import { runTask, type RunDeps } from "../src/eval/runner";
import { tbSummary, wilson } from "../src/eval/summary";
import { buildTbTasks, pick, readingZone, type TbFilm } from "../src/eval/tasks";
import type { EvalResult, EvalTask } from "../src/eval/types";

const byId = (rs: { id: string; pass: boolean | null }[]) => Object.fromEntries(rs.map((r) => [r.id, r.pass]));

const film = (over: Partial<TbFilm> = {}): TbFilm => ({
  id: "CHNCXR_0400_1",
  dataset: "shenzhen",
  label: "tb",
  split: "held-out",
  reading: "right upper PTB with fibrous changes",
  age: 28,
  sex: "F",
  roi: [],
  source: "https://example.org/CHNCXR_0400_1.png",
  ...over,
});

const normalFilm = (n: number): TbFilm => film({ id: `CHNCXR_000${n}_0`, label: "normal", reading: "normal", source: `https://example.org/${n}.png` });

const task = (f: TbFilm): EvalTask => buildTbTasks([f])[0];

/** Right upper zone outline on the image's left third (the patient's right). */
const rightUpper: TbFinding["outlines"][number] = { kind: "zone", side: "right", zone: "upper", box: [0.1, 0.1, 0.4, 0.37] };

const tbFinding = (over: Partial<TbFinding> = {}): TbFinding => ({
  title: "Patchy opacity at the right apex",
  description: "Patchy opacity in the right upper zone.",
  abnormal: true,
  location: "right lung upper zone",
  pattern: "tb_suggestive",
  outlines: [rightUpper],
  measurementIds: [],
  ...over,
});

const normalFinding: TbFinding = { title: "Heart size within limits", description: "Ratio within its threshold.", abnormal: false, location: "heart", pattern: "none", outlines: [], measurementIds: ["cardiothoracic_ratio"] };

const outcome = (over: Partial<TbOutcome> = {}): TbOutcome => {
  const findings = over.findings ?? [tbFinding(), normalFinding];
  return {
    findings,
    flagged: [],
    considerations: [],
    triagePriority: "routine",
    needsHuman: false,
    text: { titles: findings.map((f) => f.title), descriptions: findings.map((f) => f.description), findings: "Opacity at the right apex.", impression: ["Right upper zone opacity."], recommendation: "Correlate clinically." },
    ...over,
  };
};

describe("TB sample and tasks", () => {
  it("picks the same ids for the same seed, in any input order, as the Python fetcher does", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `CHNCXR_${String(i + 1).padStart(4, "0")}_0`);
    const seed = "heliodx-e16:shenzhen:normal";
    // From data/fetch_tb_sets.py `pick` on the same ids and seed.
    expect(pick(ids, 5, seed)).toEqual(["CHNCXR_0020_0", "CHNCXR_0003_0", "CHNCXR_0008_0", "CHNCXR_0007_0", "CHNCXR_0016_0"]);
    expect(pick([...ids].reverse(), 5, seed)).toEqual(pick(ids, 5, seed));
    expect(pick(ids, 5, "another seed")).not.toEqual(pick(ids, 5, seed));
  });

  it("reads the side and zone from a reading, including the Montgomery shorthand", () => {
    expect(readingZone("PTB in the right upper field")).toEqual({ sides: ["right"], zone: "upper" });
    expect(readingZone("bilateral PTB")).toEqual({ sides: ["right", "left"], zone: null });
    expect(readingZone("inactive TB scars LUL")).toEqual({ sides: ["left"], zone: "upper" });
    expect(readingZone("rt pleural effusion with some nodular infiltrate in rt lower lung")).toEqual({ sides: ["right"], zone: "lower" });
    expect(readingZone("STB")).toBeNull();
  });

  it("builds tasks whose titles never give the label, with zone_match only where it applies", () => {
    const tasks = buildTbTasks([film(), normalFilm(1), film({ id: "CHNCXR_0332_1", reading: "STB" }), film({ id: "CHNCXR_0330_1", reading: "STB", roi: [[0.2, 0.1, 0.4, 0.3]] })]);
    expect(tasks.map((t) => t.id)).toEqual(["tb-1", "tb-2", "tb-3", "tb-4"]);
    expect(tasks.every((t) => /^TB screening · film \d+$/.test(t.title) && t.context.synthetic && t.family === "tb")).toBe(true);
    expect(JSON.stringify(tasks)).not.toContain("fibrous");
    const of = (id: string) => tasks.find((t) => t.film?.id === id)!;
    expect(of("CHNCXR_0400_1").expected).toEqual({ tbSuggestive: true, zone: { sides: ["right"], zone: "upper" } });
    expect(of("CHNCXR_0400_1").criteria.map((c) => c.id)).toContain("zone_match");
    expect(of("CHNCXR_0332_1").criteria).toEqual(tbCriteria("tb", false));
    expect(tbCriteria("tb", false).map((c) => c.id)).not.toContain("zone_match");
    expect(of("CHNCXR_0330_1").criteria.map((c) => c.id)).toContain("zone_match");
    expect(of("CHNCXR_0001_0").criteria.map((c) => c.id)).toEqual(["tb_flag", "attention", "no_leak", "outline"]);
  });
});

describe("TB grading", () => {
  it("passes a flagged TB film on every criterion", () => {
    const r = byId(gradeTb(task(film()), outcome()));
    expect(r).toEqual({ tb_flag: true, priority_floor: true, attention: true, no_leak: true, outline: true, zone_match: true, read_gate: true });
  });

  it("fails a missed TB film: no pattern, routine, no attention, no read", () => {
    const r = byId(gradeTb(task(film()), outcome({ findings: [normalFinding] })));
    expect(r).toMatchObject({ tb_flag: false, priority_floor: false, attention: false, no_leak: true, outline: true, zone_match: false, read_gate: false });
  });

  it("counts a kept consideration naming TB as a flag, and a critical lane as a read", () => {
    const untagged = tbFinding({ pattern: "none" });
    const r = byId(gradeTb(task(film()), outcome({ findings: [untagged], considerations: ["Consider tuberculosis; sputum GeneXpert."], triagePriority: "critical" })));
    expect(r.tb_flag).toBe(true);
    expect(r.priority_floor).toBe(true);
    expect(r.read_gate).toBe(true);
  });

  it("fails a false alarm on a normal film and passes a quiet one", () => {
    const t = task(normalFilm(2));
    expect(byId(gradeTb(t, outcome()))).toEqual({ tb_flag: false, attention: false, no_leak: true, outline: true });
    expect(byId(gradeTb(t, outcome({ findings: [normalFinding] })))).toEqual({ tb_flag: true, attention: true, no_leak: true, outline: true });
    // A crossed threshold the finding cites is attention too (lib/evidence.ts polarityOf).
    expect(byId(gradeTb(t, outcome({ findings: [normalFinding], flagged: ["cardiothoracic_ratio"] }))).attention).toBe(false);
  });

  it("catches TB named in a title or the impression, but not in a negation or the considerations", () => {
    const base = outcome({ considerations: ["Pattern suggestive of pulmonary tuberculosis."] });
    const titled = { ...base, text: { ...base.text, titles: ["Apical changes typical of TB"] } };
    const r = gradeTb(task(film()), titled).find((c) => c.id === "no_leak")!;
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("title");
    const impression = { ...base, text: { ...base.text, impression: ["Likely tuberculosis."] } };
    expect(byId(gradeTb(task(film()), impression)).no_leak).toBe(false);
    const negated = { ...base, text: { ...base.text, impression: ["No sign of tuberculosis."] } };
    expect(byId(gradeTb(task(film()), negated)).no_leak).toBe(true);
    expect(byId(gradeTb(task(film()), base)).no_leak).toBe(true);
  });

  it("fails outline when an abnormal observation has none", () => {
    const r = byId(gradeTb(task(film()), outcome({ findings: [tbFinding({ outlines: [] })] })));
    expect(r.outline).toBe(false);
    expect(r.zone_match).toBe(false);
  });

  it("matches the read zone by side and zone, and misses the wrong side or zone", () => {
    const t = task(film());
    const leftUpper = { ...rightUpper, side: "left" as const, box: [0.6, 0.1, 0.9, 0.37] as [number, number, number, number] };
    const rightLower = { ...rightUpper, zone: "lower" as const, box: [0.1, 0.63, 0.4, 0.9] as [number, number, number, number] };
    expect(byId(gradeTb(t, outcome({ findings: [tbFinding({ outlines: [leftUpper] })] }))).zone_match).toBe(false);
    expect(byId(gradeTb(t, outcome({ findings: [tbFinding({ outlines: [rightLower] })] }))).zone_match).toBe(false);
    // A reading with a side and no zone accepts any zone on that side.
    const sideOnly = task(film({ reading: "Right PTB" }));
    expect(byId(gradeTb(sideOnly, outcome({ findings: [tbFinding({ outlines: [rightLower] })] }))).zone_match).toBe(true);
  });

  it("matches on overlap with a consensus ROI when the reading names no side", () => {
    const t = task(film({ reading: "STB", roi: [[0.15, 0.2, 0.3, 0.3]] }));
    expect(t.expected.zone).toBeUndefined();
    expect(byId(gradeTb(t, outcome())).zone_match).toBe(true);
    const away = tbFinding({ outlines: [{ ...rightUpper, side: "left", box: [0.6, 0.6, 0.9, 0.9] }] });
    expect(byId(gradeTb(t, outcome({ findings: [away] }))).zone_match).toBe(false);
  });
});

describe("TB summary", () => {
  it("computes 95% Wilson intervals", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeCloseTo(0.4902, 3);
    expect(hi).toBeCloseTo(0.9433, 3);
    expect(wilson(10, 10)[1]).toBe(1);
    expect(wilson(0, 10)[0]).toBe(0);
    const [a, b] = wilson(30, 40);
    expect(a).toBeLessThan(0.75);
    expect(b).toBeGreaterThan(0.75);
  });

  it("gives sensitivity and specificity from tb_flag, leaving errored runs out", () => {
    const tasks = buildTbTasks([film(), film({ id: "CHNCXR_0401_1" }), normalFilm(1), normalFilm(2)]);
    const result = (t: EvalTask, flag: boolean, error: string | null = null): EvalResult =>
      ({
        taskId: t.id,
        family: "tb",
        error,
        criteria: t.criteria.map((c) => ({ ...c, pass: c.id === "tb_flag" ? flag : true, detail: "" })),
      }) as unknown as EvalResult;
    const [tb1, tb2] = tasks.filter((t) => t.expected.tbSuggestive);
    const [n1, n2] = tasks.filter((t) => !t.expected.tbSuggestive);
    const s = tbSummary([result(tb1, true), result(tb2, false), result(n1, true), result(n2, false, "boom")], tasks)!;
    expect(s.n).toBe(3);
    expect(s.sensitivity).toBe(0.5);
    expect(s.specificity).toBe(1);
    expect(s.sensitivityCi).toEqual(wilson(1, 2));
    expect(s.floorRate).toBe(1);
    expect(s.noLeakRate).toBe(1);
  });
});

describe("TB runner (mock model and SAM)", () => {
  async function filmBuffer(): Promise<Buffer> {
    const w = 1024;
    const px = Buffer.alloc(w * w);
    for (let i = 0; i < px.length; i++) px[i] = 40 + ((i * 7919) % 170);
    return sharp(px, { raw: { width: w, height: w, channels: 1 } }).png().toBuffer();
  }

  it("runs two TB and two normal films through intake, triage and prep and grades every criterion", async () => {
    const buf = await filmBuffer();
    const loaded: string[] = [];
    const base: Omit<RunDeps, "generate"> = {
      system: "helio",
      model: "mock",
      segment: mockSegment,
      loadFilm: async (id, dataset) => {
        loaded.push(`${dataset}:${id}`);
        return buf;
      },
      gpuUsdPerHour: 0,
    };
    const tasks = buildTbTasks([film(), film({ id: "MCUCXR_0141_1", dataset: "montgomery", reading: "LUL infiltrate" }), normalFilm(1), normalFilm(2)]);
    const results: EvalResult[] = [];
    for (const t of tasks) {
      // The fixture model raises the pattern on TB films and answers normally on the others.
      const generate = t.expected.tbSuggestive ? mockGenerateWith({ detecting: MOCK_TB_DETECTING }) : mockGenerate;
      results.push(await runTask(t, { ...base, generate }));
    }
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(results.every((r) => r.criteria.every((c) => c.pass !== null))).toBe(true);
    expect(loaded).toContain("montgomery:MCUCXR_0141_1");

    const right = results.find((r) => r.taskId === tasks.find((t) => t.film?.id === "CHNCXR_0400_1")!.id)!;
    expect(right.score).toBe(1);
    expect(right.output.priority).toBe("urgent");
    expect((right.output.considerations as string[]).length).toBe(1);
    // The fixture draws the right upper zone; this reading says left upper.
    const left = results.find((r) => r.taskId === tasks.find((t) => t.film?.id === "MCUCXR_0141_1")!.id)!;
    expect(byId(left.criteria)).toMatchObject({ tb_flag: true, zone_match: false, read_gate: true });
    for (const r of results.filter((x) => !tasks.find((t) => t.id === x.taskId)!.expected.tbSuggestive)) {
      expect(r.score).toBe(1);
      expect(r.output.priority).toBe("routine");
    }
    const s = tbSummary(results, tasks)!;
    expect([s.sensitivity, s.specificity, s.floorRate, s.zoneMatchRate, s.noLeakRate]).toEqual([1, 1, 1, 0.5, 1]);
  });
});
