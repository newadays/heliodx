import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { PublicResults, PublicTask } from "@/functions/src/eval/publicSchema";
import { familyCounts, familyLabel, filterTasks, gradingText, passedCount, pct, readFilter, SHORT_NAME, SYSTEM_ORDER, withParam } from "../format";

export function Tasks({ data, search }: { data: PublicResults; search: string }) {
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  // The search box keeps its own text, so typing never waits on a navigation; the URL follows.
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const filter = { ...readFilter(params), q };
  const list = filterTasks(data.tasks, filter, data.systems);
  const families = familyCounts(data.tasks);
  const hasAgent = data.tasks.some((t) => t.criteria.some((c) => c.method === "agent"));
  const set = (key: string, value: string | null) => navigate({ search: withParam(search, key, value) }, { replace: key === "q" });

  return (
    <>
      <section className="hero hero-row">
        <div>
          <p className="eyebrow">Evaluation</p>
          <h1 className="display">Task library</h1>
          <p className="lede">The tasks we use to evaluate the agents, run on HelioDX and on a MedGemma 27B baseline.</p>
        </div>
        <div className="count-tile" aria-label={`${data.tasks.length} tasks`}>
          <span className="count">{data.tasks.length}</span>
          <span className="label">Tasks</span>
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Families">
        <button type="button" role="tab" aria-selected={!filter.family} className="tab" onClick={() => set("family", null)}>
          All families <span className="tab-count">{data.tasks.length}</span>
        </button>
        {families.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter.family === f.id} className="tab" onClick={() => set("family", f.id)}>
            {f.label} <span className="tab-count">{f.count}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <label className="field">
          <span className="label">Find a task</span>
          <input type="search" value={q} placeholder="Title, id or model" onChange={(e) => {
              setQ(e.target.value);
              set("q", e.target.value || null);
            }} />
        </label>
        <label className="field">
          <span className="label">Grading</span>
          <select value={filter.grading} onChange={(e) => set("grading", e.target.value === "all" ? null : e.target.value)}>
            <option value="all">All grading methods</option>
            <option value="deterministic">Deterministic</option>
            {hasAgent ? <option value="agent">Agent graded</option> : null}
          </select>
        </label>
      </div>

      <div className="list-head">
        <p aria-live="polite">
          <strong>{list.length}</strong> {list.length === 1 ? "task" : "tasks"}
        </p>
        <p className="muted">Scores use each task's own rubric</p>
      </div>

      {list.length ? (
        <ul className="grid">
          {list.map((t) => (
            <li key={t.id}>
              <TaskCard task={t} search={params.toString()} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="state">No task matches. Clear the search or pick another family.</p>
      )}
    </>
  );
}

function TaskCard({ task, search }: { task: PublicTask; search: string }) {
  const href = `/tasks/${task.id}${search ? `?${search}` : ""}`;
  return (
    <article className="card">
      <div className="card-top">
        <span className="eyebrow">{familyLabel(task.family)}</span>
        <span className="eyebrow muted">{task.criteria.length} criteria</span>
      </div>
      <h2 className="card-title">
        <Link to={href}>{task.title}</Link>
      </h2>
      <ul className="chips" aria-label="Tags">
        {task.tags.map((tag) => (
          <li key={tag} className="chip">
            {tag}
          </li>
        ))}
        <li className="chip chip-outline">{gradingText(task)}</li>
      </ul>
      <div className="card-runs">
        {SYSTEM_ORDER.map((s) => {
          const run = task.perSystem[s];
          if (!run) return null;
          const n = passedCount(task, s);
          return (
            <Link key={s} to={`${href}${href.includes("?") ? "&" : "?"}system=${s}`} className="run-row" aria-label={`${SHORT_NAME[s]}: ${pct(run.score, 0)}, open the task`}>
              <span className="run-name">{SHORT_NAME[s]}</span>
              <span className="run-score">{pct(run.score, 0)}</span>
              <span className="run-meta">{run.error ? run.error : n ? `${n.passed} of ${n.total}` : ""}</span>
              <svg className="arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          );
        })}
      </div>
    </article>
  );
}
