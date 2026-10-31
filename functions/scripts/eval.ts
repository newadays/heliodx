/**
 * E2 · The evaluation runner. Runs the task library (`eval/tasks`) through the
 * real stage code against one system at a time and grades every task.
 *
 *   npm run eval -- build-tasks                       # eval/tasks from data/out/eval/films.json
 *   npm run eval -- build-notes                       # patient-note tasks from HelioDX drafts (GPU)
 *   npm run eval -- run --system helio|medgemma [--family triage] [--limit 3] [--split held-out] [--mock]
 *   npm run eval -- publish <runId>                   # write a local run to Firestore (SEED_TARGET=project for live)
 *   npm run eval -- table <runId> [<runId>…]           # Markdown table for the README
 *
 * Runs are saved to data/out/eval/runs/<runId>.json (gitignored) before
 * anything is published. SAM masks are cached per image in
 * data/out/eval/masks, so both systems measure the same lungs.
 *
 * Environment for a live run: GPU_URL (the HelioDX service, also used for
 * SAM), BASELINE_GPU_URL (the MedGemma service, for --system medgemma), and
 * application-default credentials that may invoke both (see eval/README.md).
 * EVAL_GPU_USD_PER_HOUR sets the cost per task.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { MODELS } from "../src/config";
import { generateJson } from "../src/models/client";
import { samSegment, type SegmentResponse } from "../src/models/gpu";
import { gpuAudience, gpuIdToken } from "../src/models/gpuAuth";
import type { Segmenter } from "../src/tools/segment";
import { mockGenerate, mockSegment } from "../src/eval/mock";
import { runTask, type RunDeps } from "../src/eval/runner";
import { markdownTable, summarize } from "../src/eval/summary";
import { buildTasks, noteTask, type Film } from "../src/eval/tasks";
import { EVAL_FAMILIES, type EvalFamily, type EvalResult, type EvalRun, type EvalSystem, type EvalTask } from "../src/eval/types";

const REPO = resolve(__dirname, "../..");
const TASKS_DIR = join(REPO, "eval/tasks");
const DATA = join(REPO, "data/out/eval");
const RUNS = join(DATA, "runs");
const MASKS = join(DATA, "masks");
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "heliodx";
const NOTE_TASKS = 10;

/** What each system is, for the run record and the page. */
const SYSTEMS: Record<EvalSystem, Pick<EvalRun, "label" | "model" | "precision" | "gpu">> = {
  helio: { label: "HelioDX · Muse Glimmer 30B + SAM 3.1", model: MODELS.clinical, precision: "FP8 (per tensor)", gpu: "1× NVIDIA RTX PRO 6000" },
  medgemma: { label: "MedGemma 27B (+ SAM 3.1 masks)", model: MODELS.baseline, precision: "bf16", gpu: "1× NVIDIA RTX PRO 6000" },
};

function args(argv: string[]): { cmd: string; pos: string[]; flags: Record<string, string | true> } {
  const [cmd = "help", ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { cmd, pos, flags };
}

function readFilms(): Film[] {
  const path = join(DATA, "films.json");
  if (!existsSync(path)) throw new Error("data/out/eval/films.json is missing: run python3 -I data/fetch_demo_samples.py --eval");
  return (JSON.parse(readFileSync(path, "utf8")) as { films: Film[] }).films;
}

function readTasks(): EvalTask[] {
  if (!existsSync(TASKS_DIR)) return [];
  return EVAL_FAMILIES.flatMap((f) => {
    const dir = join(TASKS_DIR, f);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as EvalTask);
  });
}

function writeTask(t: EvalTask): void {
  const dir = join(TASKS_DIR, t.family);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${t.id}.json`), JSON.stringify(t, null, 2) + "\n");
}

/** SAM through the main GPU, cached on disk by image hash: one segmentation per image for every system. */
function cachedSegment(mock: boolean): Segmenter {
  if (mock) return mockSegment;
  mkdirSync(MASKS, { recursive: true });
  return async (image, prompts, step, threshold) => {
    const key = createHash("sha256").update(image).update(prompts.join("|")).update(String(threshold)).digest("hex").slice(0, 24);
    const path = join(MASKS, `${key}.json`);
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as SegmentResponse;
    const res = await samSegment(image, prompts, step, threshold);
    writeFileSync(path, JSON.stringify(res));
    return res;
  };
}

function deps(system: EvalSystem, mock: boolean): RunDeps {
  if (!mock) {
    if (!process.env.GPU_URL) throw new Error("Set GPU_URL to the HelioDX GPU service (SAM runs there for both systems).");
    if (system === "medgemma" && !process.env.BASELINE_GPU_URL) throw new Error("Set BASELINE_GPU_URL to the MedGemma service.");
  }
  // The one place the baseline route is chosen; app code never names it (see test/routes.test.ts).
  const route = system === "helio" ? "clinical" : "clinical_baseline";
  const generate = mock ? mockGenerate : (((input: Parameters<typeof generateJson>[0]) => generateJson({ ...input, route })) as typeof generateJson);
  return {
    system,
    model: mock ? "mock" : SYSTEMS[system].model,
    generate,
    segment: cachedSegment(mock),
    loadFilm: async (id) => readFileSync(join(DATA, "films", `${id}.jpg`)),
    gpuUsdPerHour: Number(process.env.EVAL_GPU_USD_PER_HOUR ?? 0),
  };
}

/** Waits until a GPU service answers /health: a cold start (about 5 min) must not be graded as a model failure. */
async function waitHealthy(name: string, url: string, timeoutMs = 15 * 60_000): Promise<void> {
  const root = gpuAudience(url);
  const deadline = Date.now() + timeoutMs;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${root}/health`, { headers: { authorization: `Bearer ${await gpuIdToken(root)}` }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return;
    } catch {
      // Still starting.
    }
    if (Date.now() > deadline) throw new Error(`${name} did not become healthy in ${timeoutMs / 60_000} min`);
    if (i === 0) console.log(`Waiting for ${name} to start…`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function warmUp(system: EvalSystem): Promise<void> {
  const waits = [waitHealthy("the HelioDX GPU", process.env.GPU_URL!)];
  if (system === "medgemma") waits.push(waitHealthy("the MedGemma GPU", process.env.BASELINE_GPU_URL!));
  await Promise.all(waits);
}

function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim();
  } catch {
    return "unknown";
  }
}

async function run(flags: Record<string, string | true>): Promise<void> {
  const system = flags.system as EvalSystem;
  if (system !== "helio" && system !== "medgemma") throw new Error("--system helio|medgemma");
  const mock = flags.mock === true;
  let tasks = readTasks();
  if (typeof flags.family === "string") tasks = tasks.filter((t) => t.family === (flags.family as EvalFamily));
  if (typeof flags.split === "string") tasks = tasks.filter((t) => t.split === flags.split);
  if (typeof flags.limit === "string") tasks = tasks.slice(0, Number(flags.limit));
  if (!tasks.length) throw new Error("No tasks: run build-tasks first, or check --family/--split.");

  const d = deps(system, mock);
  if (!mock) await warmUp(system);
  const startedAt = new Date();
  const runId = `${system}${mock ? "-mock" : ""}-${startedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
  const results: EvalResult[] = [];
  for (const [i, task] of tasks.entries()) {
    const r = await runTask(task, d);
    results.push(r);
    const mark = r.error ? "error" : `${Math.round(r.score * 100)}%`;
    console.log(`[${i + 1}/${tasks.length}] ${task.id}: ${mark} · ${(r.latencyMs / 1000).toFixed(1)} s${r.error ? ` · ${r.error.slice(0, 120)}` : ""}`);
  }
  const record: EvalRun = {
    id: runId,
    system,
    ...SYSTEMS[system],
    model: d.model,
    commit: commit(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    gpuUsdPerHour: d.gpuUsdPerHour,
    published: false,
    ...summarize(results, tasks),
  };
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(join(RUNS, `${runId}.json`), JSON.stringify({ run: record, results }, null, 2));
  console.log(`\nSaved data/out/eval/runs/${runId}.json\n`);
  console.log(markdownTable([record]));
  if (!d.gpuUsdPerHour) console.log("\nNote: EVAL_GPU_USD_PER_HOUR is not set, so cost per task is 0.");
}

function readRun(id: string): { run: EvalRun; results: EvalResult[] } {
  const path = join(RUNS, `${id}.json`);
  if (!existsSync(path)) throw new Error(`No local run ${id} in data/out/eval/runs`);
  return JSON.parse(readFileSync(path, "utf8")) as { run: EvalRun; results: EvalResult[] };
}

async function publish(id: string): Promise<void> {
  const { run: record, results } = readRun(id);
  if (record.id.includes("-mock-") && process.env.SEED_TARGET === "project") throw new Error("Mock runs are never published to the live project.");
  if (process.env.SEED_TARGET !== "project") process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  const ref = db.collection("evalRuns").doc(record.id);
  const batch = db.batch();
  for (const r of results) batch.set(ref.collection("results").doc(r.taskId), r);
  batch.set(ref, { ...record, published: true });
  await batch.commit();
  console.log(`Published ${record.id} (${results.length} results) to ${process.env.SEED_TARGET === "project" ? `project ${PROJECT_ID}` : "the emulator"}.`);
}

/** Patient-note tasks: HelioDX drafts on held-out films, "signed" as drafted by a simulated signer. */
async function buildNotes(flags: Record<string, string | true>): Promise<void> {
  const mock = flags.mock === true;
  const prepTasks = readTasks().filter((t) => t.family === "prep" && t.split === "held-out").slice(0, NOTE_TASKS);
  if (!prepTasks.length) throw new Error("No held-out prep tasks: run build-tasks first.");
  const d = deps("helio", mock);
  if (!mock) await warmUp("helio");
  const dir = join(TASKS_DIR, "note");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  let n = 0;
  for (const t of prepTasks) {
    const r = await runTask(t, d);
    const summary = r.output.summary as { studyType: string; findings: string; impression: string[]; recommendation: string } | undefined;
    if (r.error || !summary) {
      console.log(`skip ${t.id}: ${r.error ?? "no summary"}`);
      continue;
    }
    n++;
    writeTask(noteTask(n, t.film, { studyType: summary.studyType, findings: summary.findings, impression: summary.impression, recommendation: summary.recommendation }));
    console.log(`note-${n} from ${t.id}`);
  }
  console.log(`\nWrote ${n} patient-note tasks to eval/tasks/note. Read them before committing.`);
}

async function main(): Promise<void> {
  const { cmd, pos, flags } = args(process.argv.slice(2));
  switch (cmd) {
    case "build-tasks": {
      const tasks = buildTasks(readFilms());
      for (const f of ["intake", "triage", "prep"]) rmSync(join(TASKS_DIR, f), { recursive: true, force: true });
      tasks.forEach(writeTask);
      console.log(`Wrote ${tasks.length} tasks to eval/tasks (intake, triage, prep). Patient notes: build-notes.`);
      return;
    }
    case "build-notes":
      return buildNotes(flags);
    case "run":
      return run(flags);
    case "publish":
      if (!pos[0]) throw new Error("publish <runId>");
      return publish(pos[0]);
    case "table":
      console.log(markdownTable(pos.map((id) => readRun(id).run)));
      return;
    default:
      console.log(readFileSync(__filename, "utf8").split("*/")[0]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
