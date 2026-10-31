/**
 * E15 · The public evaluation page: the task library run on HelioDX and on a
 * MedGemma baseline, graded per task by its own rubric. No sign-in. Each task
 * opens an inline view of both runs (criteria, output, latency), since the
 * agent console needs an account.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EVAL_FAMILIES, FAMILY_LABEL, type EvalFamily, type EvalResult, type EvalRun, type EvalSystem } from "@/functions/src/eval/types";
import { ENV_CHIP } from "~/components/AppShell";
import { Icon } from "~/components/Icon";
import { SYSTEMS, useEvalRuns, type EvalData } from "~/data/evals";

import "./evals.css";

const SHORT: Record<EvalSystem, string> = { helio: "HelioDX", medgemma: "MedGemma" };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (v: number) => (v > 0 ? `$${v.toFixed(3)}` : "–");

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function overall(results: EvalResult[]) {
  const criteria = results.flatMap((r) => r.criteria).filter((c) => c.pass !== null);
  return {
    mean: results.reduce((n, r) => n + r.score, 0) / (results.length || 1),
    passRate: criteria.filter((c) => c.pass).length / (criteria.length || 1),
    latency: median(results.map((r) => r.latencyMs)),
    cost: results.reduce((n, r) => n + r.costUsd, 0) / (results.length || 1),
  };
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="hx-header">
        <Link to="/" className="hx-header__logo" aria-label="HelioDX home">
          <img src="/heliodx-lockup.png" alt="HelioDX" />
        </Link>
        <span className="chip chip-env">{ENV_CHIP}</span>
        <div style={{ flex: "1 1 auto" }} />
        <nav aria-label="Primary" className="ev-nav">
          <Link to="/">Home</Link>
          <Link to="/worklist">Log in</Link>
        </nav>
      </header>
      <main className="ev-main">{children}</main>
      <footer className="ev-footer muted">
        <p>Research prototype, not for clinical use. Scores come from code checks on each task&apos;s own rubric; see eval/README.md in the repository for the method and its limits.</p>
        <p>
          Films: NIH Clinical Center ChestX-ray14 (Wang et al., CVPR 2017); indications are synthetic. MedGemma is used under the Health AI Developer
          Foundations terms of use and is not for clinical use.
        </p>
      </footer>
    </div>
  );
}

export default function EvalsPage() {
  const { taskId } = useParams();
  const { data, loading, error, retry } = useEvalRuns();

  useEffect(() => {
    document.title = taskId ? `${taskId} · Evals · HelioDX` : "Evals · HelioDX";
  }, [taskId]);

  let body: React.ReactNode;
  if (loading) {
    body = <p className="muted" aria-busy="true">Loading the evaluation…</p>;
  } else if (error) {
    body = (
      <div className="card ev-state">
        <p>Couldn&apos;t load the evaluation.</p>
        <button type="button" className="btn btn-secondary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  } else if (!data || !data.tasks.length) {
    body = (
      <div className="card ev-state">
        <p>No published run yet.</p>
        <p className="muted">Results appear here once a run of the task library is published.</p>
      </div>
    );
  } else if (taskId) {
    body = <TaskView data={data} taskId={taskId} />;
  } else {
    body = <Library data={data} />;
  }
  return <PublicShell>{body}</PublicShell>;
}

function Library({ data }: { data: EvalData }) {
  const [family, setFamily] = useState<EvalFamily | "all">("all");
  const [q, setQ] = useState("");
  const systems = SYSTEMS.filter((s) => data.runs[s]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data.tasks.length };
    for (const f of EVAL_FAMILIES) c[f] = data.tasks.filter((t) => firstResult(t.bySystem)?.family === f).length;
    return c;
  }, [data]);

  const shown = data.tasks.filter((t) => {
    const r = firstResult(t.bySystem);
    if (!r) return false;
    if (family !== "all" && r.family !== family) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [r.title, r.taskId, ...r.tags, ...systems.map((s) => data.runs[s]?.model ?? "")].some((x) => x.toLowerCase().includes(needle));
  });

  return (
    <>
      <div className="ev-title">
        <h1>Task library</h1>
        <p className="muted">The tasks we use to evaluate the agents, run on HelioDX and on a MedGemma baseline with the same GPU, prompts and measurements.</p>
      </div>

      <section className="ev-systems" aria-label="Results per system">
        {systems.map((s) => (
          <SystemSummary key={s} run={data.runs[s]!} results={data.tasks.map((t) => t.bySystem[s]).filter((r): r is EvalResult => !!r)} />
        ))}
      </section>

      <div className="ev-filters">
        <nav className="ev-tabs" aria-label="Task family">
          {(["all", ...EVAL_FAMILIES] as const).map((f) =>
            counts[f] || f === "all" ? (
              <button key={f} type="button" className={`tab ${family === f ? "cur" : ""}`} aria-pressed={family === f} onClick={() => setFamily(f)}>
                {f === "all" ? "All" : FAMILY_LABEL[f]} <span className="count">{counts[f]}</span>
              </button>
            ) : null,
          )}
        </nav>
        <label className="ev-search">
          <span className="sr-only">Search tasks</span>
          <input type="search" placeholder="Search by title, id or model" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="ev-gridhead">
        <span className="muted">
          {shown.length} task{shown.length === 1 ? "" : "s"}
        </span>
        <span className="muted">Scores use each task&apos;s own rubric</span>
      </div>
      {shown.length ? (
        <ul className="ev-grid">
          {shown.map((t) => (
            <TaskCard key={t.taskId} bySystem={t.bySystem} systems={systems} />
          ))}
        </ul>
      ) : (
        <p className="muted">No task matches.</p>
      )}
    </>
  );
}

function firstResult(bySystem: Partial<Record<EvalSystem, EvalResult>>): EvalResult | undefined {
  return SYSTEMS.map((s) => bySystem[s]).find(Boolean);
}

function SystemSummary({ run, results }: { run: EvalRun; results: EvalResult[] }) {
  const o = overall(results);
  return (
    <div className="card ev-system">
      <div className="ev-system__head">
        <h2>{run.label}</h2>
        <p className="muted">
          {run.precision} · {run.gpu} · run {new Date(run.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · commit{" "}
          <span className="mono">{run.commit}</span>
        </p>
      </div>
      <div className="stats stats-page">
        <div className="stat">
          <b>{pct(o.mean)}</b>
          <span>Mean score</span>
        </div>
        <div className="stat">
          <b>{pct(o.passRate)}</b>
          <span>Criteria passed</span>
        </div>
        <div className="stat">
          <b>{secs(o.latency)}</b>
          <span>Median latency per task</span>
        </div>
        <div className="stat">
          <b>{usd(o.cost)}</b>
          <span>GPU cost per task</span>
        </div>
      </div>
      {run.triage ? (
        <p className="ev-system__triage muted">
          Triage: critical sent critical {run.triage.criticalRecall === null ? "–" : pct(run.triage.criticalRecall)} · abnormal sent urgent or higher{" "}
          {run.triage.abnormalRecall === null ? "–" : pct(run.triage.abnormalRecall)} · normal over-triaged {run.triage.overTriage === null ? "–" : pct(run.triage.overTriage)}
        </p>
      ) : null}
    </div>
  );
}

function TaskCard({ bySystem, systems }: { bySystem: Partial<Record<EvalSystem, EvalResult>>; systems: EvalSystem[] }) {
  const r = firstResult(bySystem)!;
  return (
    <li className="card ev-card">
      <p className="ev-eyebrow">
        {FAMILY_LABEL[r.family]} · {r.criteria.length} criteria
      </p>
      <h3>
        <Link to={`/evals/${encodeURIComponent(r.taskId)}`}>{r.title}</Link>
      </h3>
      <div className="ev-tags">
        {r.tags.map((t) => (
          <span key={t} className="chip chip-neutral">
            {t}
          </span>
        ))}
        <span className="chip chip-neutral">Deterministic</span>
      </div>
      <ul className="ev-scores">
        {systems.map((s) => {
          const res = bySystem[s];
          return (
            <li key={s}>
              <span>{SHORT[s]}</span>
              <span className="ev-score mono">{res ? (res.error ? "error" : pct(res.score)) : "–"}</span>
              <Link to={`/evals/${encodeURIComponent(r.taskId)}`} aria-label={`${SHORT[s]} run of ${r.title}`} className="ev-arrow">
                <Icon name="chevronRight" />
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function TaskView({ data, taskId }: { data: EvalData; taskId: string }) {
  const entry = data.tasks.find((t) => t.taskId === taskId);
  const systems = SYSTEMS.filter((s) => data.runs[s]);
  if (!entry) {
    return (
      <div className="card ev-state">
        <p>No task {taskId} in the published runs.</p>
        <Link className="btn btn-secondary" to="/evals">
          Back to the task library
        </Link>
      </div>
    );
  }
  const r = firstResult(entry.bySystem)!;
  return (
    <>
      <Link to="/evals" className="ev-back">
        <Icon name="chevronRight" /> Task library
      </Link>
      <div className="ev-title">
        <p className="ev-eyebrow">
          {FAMILY_LABEL[r.family]} · {r.criteria.length} criteria · {r.split}
        </p>
        <h1>{r.title}</h1>
        <div className="ev-tags">
          {r.tags.map((t) => (
            <span key={t} className="chip chip-neutral">
              {t}
            </span>
          ))}
          <span className="chip chip-neutral mono">{r.taskId}</span>
        </div>
      </div>

      <section className="card ev-table-wrap" aria-label="Criteria">
        <div className="ev-table" style={{ gridTemplateColumns: `minmax(200px,1.2fr) repeat(${systems.length}, minmax(180px,1fr))` }}>
          <div className="ev-th">Criterion</div>
          {systems.map((s) => (
            <div key={s} className="ev-th">
              {SHORT[s]} · {entry.bySystem[s] ? pct(entry.bySystem[s]!.score) : "–"}
            </div>
          ))}
          {r.criteria.map((c) => (
            <Row key={c.id} label={c.label} cells={systems.map((s) => entry.bySystem[s]?.criteria.find((x) => x.id === c.id))} />
          ))}
        </div>
      </section>

      <section className="ev-outputs" aria-label="Outputs">
        {systems.map((s) => {
          const res = entry.bySystem[s];
          return (
            <div key={s} className="card ev-output">
              <h2>{data.runs[s]!.label}</h2>
              {res ? (
                <>
                  <dl className="ev-meta">
                    <div>
                      <dt>Latency</dt>
                      <dd className="mono">{secs(res.latencyMs)}</dd>
                    </div>
                    <div>
                      <dt>Model calls</dt>
                      <dd className="mono">{res.modelCalls}</dd>
                    </div>
                    <div>
                      <dt>Tokens in / out</dt>
                      <dd className="mono">
                        {res.tokensIn.toLocaleString("en-GB")} / {res.tokensOut.toLocaleString("en-GB")}
                      </dd>
                    </div>
                    <div>
                      <dt>GPU cost</dt>
                      <dd className="mono">{usd(res.costUsd)}</dd>
                    </div>
                  </dl>
                  {res.error ? <p className="ev-error">Run failed: {res.error}</p> : <Output result={res} />}
                </>
              ) : (
                <p className="muted">Not run on this system.</p>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

function Row({ label, cells }: { label: string; cells: (EvalResult["criteria"][number] | undefined)[] }) {
  return (
    <>
      <div className="ev-td">{label}</div>
      {cells.map((c, i) => (
        <div key={i} className="ev-td">
          {c ? (
            <>
              <span className={`chip ${c.pass === null ? "chip-neutral" : c.pass ? "chip-ok" : "chip-warn"}`}>{c.pass === null ? "Not graded" : c.pass ? "Pass" : "Fail"}</span>
              <span className="muted ev-detail">{c.detail}</span>
            </>
          ) : (
            <span className="muted">–</span>
          )}
        </div>
      ))}
    </>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** The system's output, per family, as the app would show it. */
function Output({ result }: { result: EvalResult }) {
  const o = result.output;
  switch (result.family) {
    case "intake":
      return (
        <dl className="ev-kv">
          <dt>Decision</dt>
          <dd>{o.retake ? "Retake" : "Accepted"}</dd>
          <dt>Modality · view</dt>
          <dd>
            {str(o.modality)} · {str(o.view)}
          </dd>
          <dt>Both lungs found</dt>
          <dd>{o.chest ? "Yes" : "No"}</dd>
          {list(o.issues).length ? (
            <>
              <dt>Blocking</dt>
              <dd>{list(o.issues).join(" ")}</dd>
            </>
          ) : null}
          {list(o.warnings).length ? (
            <>
              <dt>Warnings</dt>
              <dd>{list(o.warnings).join(" ")}</dd>
            </>
          ) : null}
        </dl>
      );
    case "triage":
      return (
        <dl className="ev-kv">
          <dt>Lane</dt>
          <dd>
            {str(o.priority)} <span className="muted">(measurements alone: {str(o.floor)})</span>
          </dd>
          <dt>Rationale</dt>
          <dd>{str(o.rationale) || "–"}</dd>
          <dt>Cited</dt>
          <dd className="mono">{list(o.cited).join(", ") || "–"}</dd>
          <dt>Measurements</dt>
          <dd className="mono">
            {list(o.measurements)
              .map((m) => `${(m as { id: string }).id} ${(m as { value: number }).value}`)
              .join(" · ")}
          </dd>
        </dl>
      );
    case "prep": {
      const summary = (o.summary ?? {}) as { findings?: string; impression?: string[]; recommendation?: string };
      return (
        <>
          <ol className="ev-findings">
            {list(o.findings).map((f, i) => (
              <li key={i}>
                <strong>{(f as { title: string }).title}</strong> {(f as { description: string }).description}
              </li>
            ))}
          </ol>
          <dl className="ev-kv">
            <dt>Impression</dt>
            <dd>{(summary.impression ?? []).join(" ")}</dd>
            <dt>Recommendation</dt>
            <dd>{summary.recommendation ?? "–"}</dd>
          </dl>
        </>
      );
    }
    case "note":
      return (
        <>
          <p className="ev-note">{str(o.body)}</p>
          <ol className="ev-findings">
            {list(o.nextSteps).map((s, i) => (
              <li key={i}>{String(s)}</li>
            ))}
          </ol>
          <p className="muted">Reading grade {String(o.readingGrade ?? "–")}</p>
        </>
      );
  }
}
