import { Link, useNavigate } from "react-router-dom";

import type { EvalFamily } from "@/functions/src/eval/types";
import type { PublicResults, PublicSystemId, PublicTask } from "@/functions/src/eval/publicSchema";
import { criterionText } from "../criteria";
import { familyLabel, filterTasks, gradingText, nextTask, passedCount, pct, readFilter, secs, SHORT_NAME, SYSTEM_ORDER, withParam } from "../format";

/** What the agents are asked to do, per family (the deliverable a task grades). */
const BRIEF: Record<EvalFamily, { task: string; deliverable: string; grader: string; dataset: string }> = {
  intake: {
    task: "Check the image before anything else runs: is it a usable chest X-ray, which modality and view, and should it be retaken?",
    deliverable: "Accept or send back for a retake with the reason; modality and view; both lungs found by SAM 3.1.",
    grader: "gradeIntake",
    dataset: "NIH ChestX-ray14 (a film, or a blurred or down-sampled copy of it), or a non-medical picture",
  },
  triage: {
    task: "Place the case in a lane (routine, urgent or critical) from the film and the code's measurements, citing the evidence.",
    deliverable: "A lane, a short rationale and the measurement or outline ids it rests on.",
    grader: "gradeTriage",
    dataset: "NIH ChestX-ray14",
  },
  prep: {
    task: "Draft the observations a clinician reviews: what is seen, where, with evidence, and a short impression.",
    deliverable: "Observations with evidence ids and an abnormal flag, a findings paragraph, an impression and a recommendation.",
    grader: "gradePrep",
    dataset: "NIH ChestX-ray14",
  },
  note: {
    task: "Rewrite a signed report for the patient in plain language, adding nothing the clinician did not sign.",
    deliverable: "A short note and one next step per signed recommendation sentence.",
    grader: "gradeNote",
    dataset: "Signed reports drafted on NIH ChestX-ray14 films",
  },
  tb: {
    task: "Run intake, triage and prep on a film from a public TB screening set; on films the set labels TB the agents should flag a pattern of concern so the film is read first, without naming any disease.",
    deliverable: "Observations with zone outlines and a pattern-of-concern tag, and the lane after the pattern lift.",
    grader: "gradeTb",
    dataset: "Shenzhen or Montgomery County chest X-ray set (U.S. National Library of Medicine)",
  },
};

const CALLOUT = "Every criterion is checked by code against the task's expected values; where the app filters the model's text, the model's output before the filters is what is graded.";

const TABS = ["overview", "task", "inputs", "grader", "runs", "provenance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", task: "Task", inputs: "Inputs", grader: "Grader", runs: "Runs", provenance: "Provenance" };

export function TaskPage({ data, id, search }: { data: PublicResults; id: string; search: string }) {
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    return (
      <section className="state">
        <h1 className="display-sm">No task {id}</h1>
        <p>
          <Link to="/tasks">All tasks</Link>
        </p>
      </section>
    );
  }
  const available = SYSTEM_ORDER.filter((s) => task.perSystem[s]);
  const system: PublicSystemId = available.includes(params.get("system") as PublicSystemId) ? (params.get("system") as PublicSystemId) : available[0];
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview";
  const show = params.get("show") === "passed" || params.get("show") === "failed" ? params.get("show")! : "all";
  const set = (key: string, value: string | null) => navigate({ search: withParam(search, key, value) }, { replace: true });

  // "Next" follows the list the visitor came from (its family, search and grading filters).
  const listParams = new URLSearchParams(params);
  for (const k of ["system", "tab", "show"]) listParams.delete(k);
  const listSearch = listParams.toString();
  const next = nextTask(filterTasks(data.tasks, readFilter(listParams), data.systems), task.id);
  const run = task.perSystem[system];
  const n = passedCount(task, system);
  const brief = BRIEF[task.family];
  const criteria = task.criteria.filter((c) => {
    const pass = run?.criteria[c.id];
    return show === "all" || (show === "passed" ? pass === true : pass !== true);
  });

  return (
    <>
      <nav className="crumbs" aria-label="Task navigation">
        <Link to={`/tasks${listSearch ? `?${listSearch}` : ""}`}>
          <span aria-hidden="true">← </span>All tasks
        </Link>
        {next ? (
          <Link to={`/tasks/${next.id}${listSearch ? `?${listSearch}` : ""}`}>
            Next<span aria-hidden="true"> →</span>
          </Link>
        ) : null}
      </nav>

      <header className="task-head">
        <p className="eyebrow">{familyLabel(task.family)}</p>
        <h1 className="display">{task.title}</h1>
        <ul className="chips" aria-label="Tags">
          {task.tags.map((tag) => (
            <li key={tag} className="chip">
              {tag}
            </li>
          ))}
          <li className="chip chip-outline">{gradingText(task)}</li>
        </ul>
        <p className="ids">
          {run?.runId ?? "–"}/{task.id}
        </p>
      </header>

      <section className="band" aria-label="Recorded run">
        <div className="band-cell">
          <label className="band-label" htmlFor="system">
            Model run
          </label>
          <select id="system" className="band-select" value={system} onChange={(e) => set("system", e.target.value)}>
            {available.map((s) => (
              <option key={s} value={s}>
                {data.systems.find((x) => x.id === s)?.label ?? SHORT_NAME[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="band-cell">
          <span className="band-label">Recorded score</span>
          <span className="band-score">{pct(run?.score, 1)}</span>
          <span className="band-note">Task-specific rubric{n ? ` · ${n.passed} of ${n.total} criteria` : ""}</span>
        </div>
        <div className="band-cell">
          <span className="band-label">Evaluation</span>
          <span className="band-value">{gradingText(task)}</span>
          <span className="band-note">{run?.error ? `Run stopped: ${run.error}` : `Ran in ${run ? secs(run.latencyMs) : "–"}`}</span>
        </div>
      </section>

      <p className="callout">{CALLOUT}</p>

      <details className="disclosure">
        <summary>Read the task instructions and deliverables</summary>
        <dl className="kv kv-wide">
          <div>
            <dt>Task</dt>
            <dd>{brief.task}</dd>
          </div>
          <div>
            <dt>Deliverable</dt>
            <dd>{brief.deliverable}</dd>
          </div>
          <div>
            <dt>Inputs</dt>
            <dd>{inputsText(task)}</dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>{task.expected ?? "No single expected value; see the criteria."}</dd>
          </div>
        </dl>
      </details>

      <section className="section-tight" aria-labelledby="how">
        <h2 id="how" className="h3">
          How was it graded?
        </h2>
        <p>
          {gradingText(task)}. The score is the fraction of criteria passed; every criterion has weight one. A run that stops with an error fails every criterion, so it scores
          0 rather than vanishing.
        </p>
      </section>

      <div className="two-col">
        <section className="panel" aria-labelledby="files">
          <h2 id="files" className="h3">
            Task files
          </h2>
          <div className="tabs tabs-sm" role="tablist" aria-label="Task files">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls="tab-panel" className="tab" onClick={() => set("tab", t === "overview" ? null : t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="doc">
            <TabBody tab={tab} task={task} data={data} />
          </div>
        </section>

        <section className="panel" aria-labelledby="criteria">
          <div className="panel-head">
            <h2 id="criteria" className="h3">
              Grading criteria
            </h2>
            <label className="field field-inline">
              <span className="sr-only">Show criteria</span>
              <select value={show} onChange={(e) => set("show", e.target.value === "all" ? null : e.target.value)}>
                <option value="all">All criteria</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
          <p className="muted">
            {n ? `${n.passed} of ${n.total} criteria passed` : ""} · {SHORT_NAME[system]}
          </p>
          <ol className="criteria">
            {criteria.map((c) => {
              const index = task.criteria.indexOf(c) + 1;
              const pass = run?.criteria[c.id];
              const text = criterionText(task.family, c.id);
              return (
                <li key={c.id} className="criterion">
                  <div className="criterion-top">
                    <span className="mono muted">C-{String(index).padStart(3, "0")}</span>
                    <span className={`verdict ${pass === true ? "pass" : pass === false ? "fail" : ""}`}>{pass === true ? "Pass" : pass === false ? "Fail" : "Not graded"}</span>
                  </div>
                  <h3 className="criterion-title">{c.label}</h3>
                  {text ? (
                    <>
                      <p className="label">Earns credit</p>
                      <p>{text.earns}</p>
                      <p className="label">Does not earn credit</p>
                      <p>{text.doesNot}</p>
                      {text.alternatives ? (
                        <>
                          <p className="label">Accepted alternatives</p>
                          <p>{text.alternatives}</p>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {!criteria.length ? <p className="muted">No criteria in this view.</p> : null}
        </section>
      </div>
    </>
  );
}

function inputsText(task: PublicTask): string {
  const parts = [BRIEF[task.family].dataset];
  if (task.inputs.variant && task.inputs.variant !== "clean") parts.push(`variant: ${task.inputs.variant === "lowres" ? "down-sampled" : task.inputs.variant === "blur" ? "blurred" : "non-medical picture"}`);
  if (task.inputs.indication) parts.push(`synthetic indication: "${task.inputs.indication}"`);
  return parts.join("; ");
}

function TabBody({ tab, task, data }: { tab: Tab; task: PublicTask; data: PublicResults }) {
  const brief = BRIEF[task.family];
  const family = data.families.find((f) => f.id === task.family);
  switch (tab) {
    case "overview":
      return (
        <>
          <h3 className="doc-title">{task.title}</h3>
          <p>{brief.task}</p>
          <dl className="kv">
            <div>
              <dt>Family</dt>
              <dd>{familyLabel(task.family)}</dd>
            </div>
            <div>
              <dt>Grading</dt>
              <dd>{gradingText(task)}</dd>
            </div>
            <div>
              <dt>Split</dt>
              <dd>{task.split === "held-out" ? "Held-out" : "Tuning"}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{brief.dataset}</dd>
            </div>
            <div>
              <dt>Criteria</dt>
              <dd>{task.criteria.length}</dd>
            </div>
          </dl>
        </>
      );
    case "task":
      return (
        <>
          <p>{brief.task}</p>
          <p className="label">Deliverable</p>
          <p>{brief.deliverable}</p>
          <p className="label">Expected</p>
          <p>{task.expected ?? "No single expected value; see the criteria."}</p>
        </>
      );
    case "inputs":
      return (
        <>
          <p>{inputsText(task)}.</p>
          <p className="muted">Images are not published here; film ids and clinical readings are left out on purpose. Every indication is synthetic.</p>
        </>
      );
    case "grader":
      return (
        <>
          <p>
            <code>{brief.grader}</code> in <code>functions/src/eval/grade.ts</code>, one verdict per criterion:
          </p>
          <ul className="plain">
            {task.criteria.map((c) => (
              <li key={c.id}>
                <code>{c.id}</code> · {c.method === "deterministic" ? "code" : c.method}
              </li>
            ))}
          </ul>
        </>
      );
    case "runs":
      return (
        <dl className="kv">
          {SYSTEM_ORDER.map((s) => {
            const r = task.perSystem[s];
            return r ? (
              <div key={s}>
                <dt>{SHORT_NAME[s]}</dt>
                <dd>
                  {pct(r.score, 1)} · {secs(r.latencyMs)}
                  {r.error ? ` · ${r.error}` : ""}
                  <br />
                  <span className="mono muted">{r.runId}</span>
                </dd>
              </div>
            ) : null;
          })}
        </dl>
      );
    case "provenance":
      return (
        <dl className="kv">
          {SYSTEM_ORDER.map((s) => {
            const f = family?.perSystem[s];
            return f ? (
              <div key={s}>
                <dt>{SHORT_NAME[s]}</dt>
                <dd>
                  Commit <code>{f.commit}</code>, run started {new Date(f.startedAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                </dd>
              </div>
            ) : null;
          })}
          <div>
            <dt>Published</dt>
            <dd>{new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{task.family === "tb" && data.tb ? data.tb.dataset.name : "NIH Clinical Center ChestX-ray14 (Wang et al., CVPR 2017)"}</dd>
          </div>
        </dl>
      );
  }
}
