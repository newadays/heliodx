/**
 * E2 · The evaluation runner. Runs the task library (`eval/tasks`) through the
 * real stage code against one system at a time and grades every task.
 *
 *   npm run eval -- build-tasks                       # eval/tasks from data/out/eval/films.json
 *   npm run eval -- build-tasks --tb                  # eval/tasks/tb from data/out/eval/tb-films.json (E16)
 *   npm run eval -- build-notes                       # patient-note tasks from HelioDX drafts (GPU)
 *   npm run eval -- run --system helio|medgemma [--family triage] [--limit 3] [--split held-out] [--dataset shenzhen] [--resume <runId>] [--mock]
 *   npm run eval -- publish <runId>                   # write a local run to Firestore (SEED_TARGET=project for live)
 *   npm run eval -- table <runId> [<runId>…]           # Markdown table for the README
 *   npm run eval -- export <runId>… [--bucket [name]]  # E17: the public results JSON (local copy; --bucket uploads it)
 *
 * Runs are saved to data/out/eval/runs/<runId>.json (gitignored) before
 * anything is published. SAM masks are cached per image in
 * data/out/eval/masks, so both systems measure the same lungs.
 *
 * Environment for a live run: GPU_URL (the HelioDX service, also used for
 * SAM), BASELINE_GPU_URL (the MedGemma service, for --system medgemma), and
 * application-default credentials that may invoke both (see eval/README.md).
 * EVAL_GPU_USD_PER_HOUR sets the cost per task. EVAL_RESULTS_BUCKET names the
 * bucket `export --bucket` writes to (kept out of the repository).
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { MODELS } from "../src/config";
import { generateJson } from "../src/models/client";
import { samSegment, type SegmentResponse } from "../src/models/gpu";
import { gpuAudience, gpuIdToken } from "../src/models/gpuAuth";
import type { Segmenter } from "../src/tools/segment";
import { mockGenerate, mockSegment } from "../src/eval/mock";
import { buildPublicResults } from "../src/eval/publicResults";
import { runTask, type RunDeps } from "../src/eval/runner";
import { markdownTable, summarize } from "../src/eval/summary";
import { buildTasks, buildTbTasks, noteTask, type Film, type TbFilm } from "../src/eval/tasks";
import { EVAL_FAMILIES, type EvalFamily, type EvalResult, type EvalRun, type EvalSystem, type EvalTask } from "../src/eval/types";

const REPO = resolve(__dirname, "../..");
const TASKS_DIR = join(REPO, "eval/tasks");
const PUBLIC = join(REPO, "data/out/eval/public");
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

function readTbFilms(): TbFilm[] {
  const path = join(DATA, "tb-films.json");
  if (!existsSync(path)) throw new Error("data/out/eval/tb-films.json is missing: run python3 -I data/fetch_tb_sets.py --eval");
  return (JSON.parse(readFileSync(path, "utf8")) as { films: TbFilm[] }).films;
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
    // NIH films are the JPEG copies from fetch_demo_samples.py; TB-set films the original PNGs from fetch_tb_sets.py.
    loadFilm: async (id, dataset) => readFileSync(dataset ? join(DATA, "tb", `${id}.png`) : join(DATA, "films", `${id}.jpg`)),
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

/** Errors that mean the GPU was unreachable, not that the model answered badly. */
const INFRA_ERROR = /did not answer in time|unavailable|fetch failed|ECONNRESET|socket hang up/i;

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
  if (typeof flags.dataset === "string") {
    if (flags.dataset !== "shenzhen" && flags.dataset !== "montgomery") throw new Error("--dataset shenzhen|montgomery");
    tasks = tasks.filter((t) => t.film?.dataset === flags.dataset);
  }
  if (typeof flags.limit === "string") tasks = tasks.slice(0, Number(flags.limit));
  if (!tasks.length) throw new Error("No tasks: run build-tasks first, or check --family/--split.");

  // --resume: keep what the saved run already graded; re-run tasks that hit the GPU going away.
  const resumed = typeof flags.resume === "string" ? readRun(flags.resume) : null;
  if (resumed && resumed.run.system !== system) throw new Error(`${resumed.run.id} is a ${resumed.run.system} run`);
  const done = new Map((resumed?.results ?? []).filter((r) => !(r.error && INFRA_ERROR.test(r.error))).map((r) => [r.taskId, r]));

  const d = deps(system, mock);
  const startedAt = resumed ? new Date(resumed.run.startedAt) : new Date();
  const runId = resumed?.run.id ?? `${system}${mock ? "-mock" : ""}-${startedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
  const results: EvalResult[] = [];
  const save = (): EvalRun => {
    const record: EvalRun = {
      id: runId,
      system,
      ...SYSTEMS[system],
      model: d.model,
      commit: commit(),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      gpuUsdPerHour: d.gpuUsdPerHour,
      vllm: vllmVersion(),
      published: false,
      ...summarize(results, tasks),
    };
    mkdirSync(RUNS, { recursive: true });
    writeFileSync(join(RUNS, `${runId}.json`), JSON.stringify({ run: record, results }, null, 2));
    return record;
  };
  if (done.size) console.log(`Resuming ${runId}: ${done.size} of ${tasks.length} tasks already graded.`);
  if (!mock && done.size < tasks.length) await warmUp(system);
  for (const [i, task] of tasks.entries()) {
    const kept = done.get(task.id);
    if (kept) {
      results.push(kept);
      continue;
    }
    let r = await runTask(task, d);
    // A GPU instance can vanish mid-run (Cloud Run starts a new one, ~5 min).
    // That is infrastructure, not the model: wait until healthy and run the task again.
    for (let retry = 1; !mock && r.error && INFRA_ERROR.test(r.error) && retry <= 2; retry++) {
      console.log(`[${i + 1}/${tasks.length}] ${task.id}: ${r.error.slice(0, 80)}; waiting for the GPU, retry ${retry}`);
      await warmUp(system);
      r = await runTask(task, d);
    }
    results.push(r);
    const mark = r.error ? "error" : `${Math.round(r.score * 100)}%`;
    console.log(`[${i + 1}/${tasks.length}] ${task.id}: ${mark} · ${(r.latencyMs / 1000).toFixed(1)} s${r.error ? ` · ${r.error.slice(0, 120)}` : ""}`);
    // Saved after every task, so a crash loses nothing: `run --resume <runId>` picks up here.
    save();
  }
  const record = save();
  console.log(`\nSaved data/out/eval/runs/${runId}.json\n`);
  console.log(markdownTable([record]));
  if (!d.gpuUsdPerHour) console.log("\nNote: EVAL_GPU_USD_PER_HOUR is not set, so cost per task is 0.");
}

/** The vLLM release the GPU image pins (`ARG VLLM_IMAGE=vllm/vllm-openai:v0.32.0`). */
function vllmVersion(): string | null {
  const path = join(REPO, "gpu/Dockerfile");
  if (!existsSync(path)) return null;
  return /ARG VLLM_IMAGE=\S+:v?([\w.]+)/.exec(readFileSync(path, "utf8"))?.[1] ?? null;
}

/**
 * E17 · The public results file from local runs. Always writes a local copy to
 * data/out/eval/public; `--bucket` (EVAL_RESULTS_BUCKET) or `--bucket <name>`
 * also uploads results/runs/<stamp>.json, results/latest.json and
 * results/index.json. Mock runs are never uploaded.
 */
async function exportResults(ids: string[], flags: Record<string, string | true>): Promise<void> {
  if (!ids.length) throw new Error("export <runId> [<runId>…]");
  const runs = ids.map(readRun);
  const generatedAt = new Date().toISOString();
  const data = buildPublicResults({ runs, tasks: readTasks(), vllm: vllmVersion(), generatedAt });
  const json = JSON.stringify(data, null, 2) + "\n";
  const file = `${generatedAt.slice(0, 19).replace(/[-:]/g, "")}Z.json`;
  const entry = { file, generatedAt, runIds: data.systems.flatMap((s) => s.runIds) };

  mkdirSync(join(PUBLIC, "runs"), { recursive: true });
  writeFileSync(join(PUBLIC, "runs", file), json);
  writeFileSync(join(PUBLIC, "latest.json"), json);
  const localIndex = join(PUBLIC, "index.json");
  const prior = existsSync(localIndex) ? (JSON.parse(readFileSync(localIndex, "utf8")) as { runs: (typeof entry)[] }).runs : [];
  writeFileSync(localIndex, JSON.stringify({ runs: [entry, ...prior] }, null, 2) + "\n");
  console.log(`Wrote data/out/eval/public/runs/${file} and latest.json (${data.tasks.length} tasks, ${data.systems.length} systems).`);

  if (!flags.bucket) return;
  const bucketName = typeof flags.bucket === "string" ? flags.bucket : process.env.EVAL_RESULTS_BUCKET;
  if (!bucketName) throw new Error("--bucket needs a name or EVAL_RESULTS_BUCKET");
  if (runs.some((r) => r.run.id.includes("-mock-"))) throw new Error("Mock runs are never uploaded.");
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const bucket = getStorage().bucket(bucketName);
  const put = (path: string, body: string, cacheControl: string) =>
    bucket.file(path).save(body, { resumable: false, contentType: "application/json", metadata: { cacheControl } });
  await put(`results/runs/${file}`, json, "public, max-age=31536000, immutable");
  await put("results/latest.json", json, "public, max-age=300");
  const index = bucket.file("results/index.json");
  const [exists] = await index.exists();
  const remote = exists ? (JSON.parse((await index.download())[0].toString("utf8")) as { runs: (typeof entry)[] }).runs : [];
  await put("results/index.json", JSON.stringify({ runs: [entry, ...remote] }, null, 2) + "\n", "public, max-age=300");
  console.log(`Uploaded results/runs/${file}, results/latest.json and results/index.json.`);
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
  // E16: the NLM TB sets may not be shared outside the research group, so
  // per-film TB results stay local; only the aggregate (record.tb) is published.
  const shared = results.filter((r) => r.family !== "tb");
  for (const r of shared) batch.set(ref.collection("results").doc(r.taskId), r);
  batch.set(ref, { ...record, published: true });
  await batch.commit();
  if (shared.length < results.length) console.log(`Kept ${results.length - shared.length} TB results local (aggregate only).`);
  console.log(`Published ${record.id} (${shared.length} results) to ${process.env.SEED_TARGET === "project" ? `project ${PROJECT_ID}` : "the emulator"}.`);
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
      if (flags.tb === true) {
        const tb = buildTbTasks(readTbFilms());
        rmSync(join(TASKS_DIR, "tb"), { recursive: true, force: true });
        tb.forEach(writeTask);
        const count = (split: string, label: string) => tb.filter((t) => t.split === split && t.film?.label === label).length;
        console.log(`Wrote ${tb.length} TB tasks to eval/tasks/tb (held-out ${count("held-out", "tb")} TB + ${count("held-out", "normal")} normal; tuning ${count("tuning", "tb")} + ${count("tuning", "normal")}).`);
        return;
      }
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
    case "export":
      return exportResults(pos, flags);
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
