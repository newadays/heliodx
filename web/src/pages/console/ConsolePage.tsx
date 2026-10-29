/**
 * Agent console page (design/agent-console SPEC §3): the run manifest's agents
 * and tools, a run selector with status, seven statistics and the trace
 * table whose rows expand in place (Summary · Tool calls · Prompt · Raw
 * output · Timing). Links: `/console/:caseId`, `?run=`, `?step=<stage>`,
 * `?tool=<name>` (filters the table to steps that called that tool).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { Study, TraceEntry } from "@/types/study";
import { callsByTool, manifestModels, runIdOf, runStatusOf, type RunStatus } from "@/utils/consoleRun";
import { useAuth } from "~/auth/AuthContext";
import { AppShell } from "~/components/AppShell";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { RunStatTiles } from "~/components/RunStatTiles";
import { useLiveTrace, useNow, useStorageUrl, useStudies } from "~/data/hooks";
import { analysisElapsedMs, arrivedAt, caseIdOf, currentStage, defaultStep, indicationOf, patientOf, studyLabel, viewStatus } from "~/data/model";
import { runExport, runStats, stageRows, type StageRow } from "~/data/timeline";
import { duration, hhmmss, tokens } from "~/lib/format";
import { saveJson } from "~/lib/download";
import { SourceTag } from "~/components/Source";
import { studyPath } from "~/lib/paths";

import { AgentsTools } from "./AgentsTools";
import { stageDetail } from "./stageDetail";

import "./console.css";

const RUN_CHIP: Record<RunStatus, { cls: string; label: string }> = {
  running: { cls: "chip-neutral", label: "Running" },
  awaiting_review: { cls: "chip-neutral", label: "Awaiting review" },
  signed: { cls: "chip-ink", label: "Signed" },
  shared: { cls: "chip-ink", label: "Shared" },
  failed: { cls: "chip-warn", label: "Failed" },
};

const RUN_WORD: Record<RunStatus, string> = { running: "running", awaiting_review: "in review", signed: "signed", shared: "shared", failed: "failed" };

const PANEL_KEY = (uid: string) => `hx.console.agentsPanel.${uid}`;

function readCollapsed(uid: string): boolean {
  try {
    const v = localStorage.getItem(PANEL_KEY(uid));
    if (v === "collapsed") return true;
    if (v === "expanded") return false;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return typeof window !== "undefined" && window.innerWidth < 1280;
}

function Thumb({ path }: { path: string }) {
  const url = useStorageUrl(path);
  return url ? <img className="tr-thumb" src={url} alt="Overlay" /> : <span className="tr-thumb" aria-hidden="true" />;
}

function Args({ args }: { args: Record<string, unknown> }) {
  const text = JSON.stringify(args);
  if (text.length <= 100) return <code className="calls__args">{text}</code>;
  return (
    <details className="calls__more">
      <summary>
        <code className="calls__args">{text.slice(0, 100)}…</code>
      </summary>
      <code className="calls__args">{text}</code>
    </details>
  );
}

/** Every tool and check call in order: tool, arguments, duration, result. */
function Calls({ calls, empty, recovered = {} }: { calls: TraceEntry[]; empty: string; recovered?: Record<string, "retried" | "overridden"> }) {
  if (!calls.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="calls">
      {calls.map((t, i) => (
        <li key={t.id} className={t.ok || recovered[t.id] ? "" : "fail"}>
          <span className="mono muted">{i + 1}</span>
          <div className="calls__main">
            <span className="calls__top">
              <span className="mono calls__name">{t.name}</span>
              {t.kind === "check" || !t.ok ? (
                <span className={`chip ${t.ok || recovered[t.id] ? "chip-neutral" : "chip-warn"}`}>{t.ok ? "ok" : recovered[t.id] ? `failed · ${recovered[t.id]}` : "failed"}</span>
              ) : null}
            </span>
            {t.args && Object.keys(t.args).length ? <Args args={t.args} /> : null}
            {t.result ? <span className="calls__result">{t.result}</span> : null}
          </div>
          <div className="calls__side">
            {t.overlayPath ? <Thumb path={t.overlayPath} /> : null}
            <span className="mono muted">{t.ms !== undefined ? duration(t.ms) : "—"}</span>
            {t.promptTokens || t.outputTokens ? <span className="mono muted">{tokens((t.promptTokens ?? 0) + (t.outputTokens ?? 0))} tok</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Tab = "summary" | "calls" | "prompt" | "raw" | "timing";

function Expanded({ row, study, onCopy }: { row: StageRow; study: Study; onCopy: () => void }) {
  // A failed step opens where the failure is: its calls, or its model calls
  // (Timing) when a model call failed and no tool or check did.
  const toolFailed = row.calls.some((c) => !c.ok && !row.recovered[c.id]);
  const [tab, setTab] = useState<Tab>(toolFailed ? "calls" : row.state === "failed" ? "timing" : "summary");
  const d = stageDetail(row, study);
  const models = row.trace.filter((t) => t.kind === "model");
  const withDetail = models.filter((t) => t.detail);
  const perTool = Object.entries(row.calls.reduce<Record<string, number>>((m, c) => ({ ...m, [c.name]: (m[c.name] ?? 0) + 1 }), {}));
  const label: Record<Tab, string> = { summary: "Summary", calls: `Tool calls · ${row.calls.length}`, prompt: "Prompt", raw: "Raw output", timing: "Timing" };
  return (
    <div className="tr-detail" id={`detail-${row.key}`}>
      <div className="ptabs" role="tablist" aria-label="Trace views">
        {(["summary", "calls", "prompt", "raw", "timing"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ptab ${tab === t ? "cur" : ""}`} onClick={() => setTab(t)}>
            {label[t]}
          </button>
        ))}
      </div>
      {tab === "summary" ? (
        <div className="tr-cols">
          <div>
            <span className="label">Inputs</span>
            <ul>{d.inputs.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div>
            <span className="label">{d.output.title}</span>
            {d.output.ordered ? <ol>{d.output.lines.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul>{d.output.lines.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </div>
          <div>
            <span className="label">Tool calls</span>
            <ul>
              {perTool.length ? perTool.map(([name, n]) => (
                <li key={name}>
                  <code>{name}</code> ×{n}
                </li>
              )) : <li className="muted">None for this step</li>}
            </ul>
            <p className="tr-checks">
              Checks: {row.checksPassed} passed · <span className={row.checksFailed ? "inline-error" : ""}>{row.checksFailed} failed</span>
            </p>
            {d.overlays.length ? (
              <div className="tr-thumbs">
                {d.overlays.map((p) => (
                  <Thumb key={p} path={p} />
                ))}
              </div>
            ) : null}
          </div>
          {d.measurements.length ? (
            <div>
              <span className="label">Measurements</span>
              <ul>{d.measurements.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === "calls" ? <Calls calls={row.calls} recovered={row.recovered} empty="This step called no tools." /> : null}
      {tab === "prompt" || tab === "raw" ? (
        withDetail.length ? (
          withDetail.map((t) => (
            <div key={t.id} className="tr-text">
              <span className="label">
                {t.name} · {t.args && "step" in t.args ? String(t.args.step) : row.title}
              </span>
              <pre>{tab === "prompt" ? t.detail?.prompt : t.detail?.raw}</pre>
            </div>
          ))
        ) : (
          <p className="muted">{models.length ? "Prompts and raw answers are kept for demo cases only." : "This step made no model call."}</p>
        )
      ) : null}
      {tab === "timing" ? (
        <>
          <p className="muted">
            Step {row.ms !== null ? duration(row.ms) : "—"}
            {row.tokens ? ` · ${tokens(row.tokens)} tokens` : ""} · {models.length} model call{models.length === 1 ? "" : "s"}
          </p>
          <Calls calls={models} empty="This step made no model call." />
        </>
      ) : null}
      <div className="tr-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCopy}>
          <Icon name="copy" size={14} />
          Copy trace link
        </button>
      </div>
    </div>
  );
}

export default function ConsolePage() {
  const { caseId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const now = useNow(1000);
  const { data: studies, loading } = useStudies(200);
  const sorted = useMemo(() => [...studies].sort((a, b) => (arrivedAt(b) ?? 0) - (arrivedAt(a) ?? 0)), [studies]);
  const runParam = params.get("run");
  const selected =
    (runParam ? sorted.find((s) => runIdOf(s) === runParam) : null) ??
    sorted.find((s) => caseIdOf(s) === caseId) ??
    (caseId ? null : sorted.find((s) => viewStatus(s) === "analyzing") ?? sorted[0] ?? null);
  const { trace, live } = useLiveTrace(selected?.id ?? null);
  const steps = selected ? stageRows(selected, trace, now) : [];
  const stats = selected ? runStats(selected, steps, now) : null;
  const counts = callsByTool(steps);
  const deep = params.get("step");
  const tool = params.get("tool");
  const [open, setOpen] = useState<Set<string>>(() => new Set(deep ? [deep] : []));
  const scrolled = useRef(false);
  const running = sorted.filter((s) => viewStatus(s) === "analyzing");

  const uid = user?.uid ?? "anon";
  const [collapsed, setCollapsed] = useState(() => readCollapsed(uid));
  const togglePanel = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(PANEL_KEY(uid), c ? "expanded" : "collapsed");
      } catch {
        /* per-viewer convenience only */
      }
      return !c;
    });

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // Another run: start with its rows closed (a ?step= link reopens one below).
  const shownId = useRef(selected?.id);
  useEffect(() => {
    if (shownId.current === selected?.id) return;
    shownId.current = selected?.id;
    setOpen(new Set());
    scrolled.current = false;
  }, [selected?.id]);

  useEffect(() => {
    if (!deep || scrolled.current || !steps.length) return;
    scrolled.current = true;
    setOpen((o) => new Set(o).add(deep));
    requestAnimationFrame(() => document.getElementById(`row-${deep}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [deep, steps.length]);

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const copyLink = async (key: string) => {
    const url = `${window.location.origin}/console/${selected ? caseIdOf(selected) : ""}?step=${key}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: "Trace link copied" });
    } catch {
      toast({ message: url });
    }
  };

  const exportJson = () => {
    if (!selected || !stats) return;
    saveJson(runExport(selected, steps, stats), `HelioDX-${caseIdOf(selected)}-trace.json`);
    toast({ message: "Export ready" });
  };

  const shown = tool ? steps.filter((s) => s.calls.some((c) => c.name === tool)) : steps;
  const p = selected ? patientOf(selected) : null;
  const chip = stats ? RUN_CHIP[stats.status] : null;
  const firstRunning = running[0];

  return (
    <AppShell crumbs={[{ label: "Worklist", to: "/worklist" }, { label: "Agent console" }]}>
      <div className={`cons ${collapsed ? "cons--rail" : ""}`}>
        <AgentsTools steps={steps} counts={counts} filter={tool} onFilter={(t) => setParam("tool", t)} collapsed={collapsed} onToggle={togglePanel} />

        <main className="cons__main">
          {selected && p && chip && stats ? (
            <>
              <h1 className="sr-only">
                Agent console · {caseIdOf(selected)}
              </h1>
              <div className="cons__head">
                <div className="cons__title">
                  <div className="cons__run">
                    <label className="cons__runsel">
                      <span className="label">Run</span>
                      <select aria-label="Select a run" value={selected.id} onChange={(e) => {
                        const next = sorted.find((s) => s.id === e.target.value);
                        if (next) navigate(`/console/${caseIdOf(next)}`);
                      }}>
                        {sorted.map((s) => (
                          <option key={s.id} value={s.id}>
                            {runIdOf(s)} · {patientOf(s).displayName} · {RUN_WORD[runStatusOf(s)]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className={`chip ${chip.cls}`}>
                      {stats.status === "running" ? <span className="pulse" aria-hidden="true" /> : null}
                      {chip.label}
                    </span>
                    {firstRunning ? (
                      <Link className="cons__running" to={studyPath(firstRunning, "analyzing")}>
                        <span className="pulse" aria-hidden="true" />
                        {running.length} running · {patientOf(firstRunning).displayName} · {currentStage(firstRunning) || "Queued"} · {Math.round(analysisElapsedMs(firstRunning, now) / 1000)} s
                      </Link>
                    ) : null}
                  </div>
                  <p className="muted cons__meta">
                    {p.displayName} <SourceTag study={selected} /> <span className="mono">{caseIdOf(selected)}</span> · {[studyLabel(selected), p.ageSex, indicationOf(selected)].filter(Boolean).join(" · ")} · arrived{" "}
                    <span className="mono">{hhmmss(arrivedAt(selected))}</span> · {selected.clinicianName}
                    {selected.source === "sample" ? " (simulated)" : ""}
                  </p>
                </div>
                <div className="cons__actions">
                  <button type="button" className="btn btn-secondary" onClick={exportJson}>
                    <Icon name="download" />
                    Export JSON
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => navigate(studyPath(selected, defaultStep(selected)))}>
                    Open in app
                  </button>
                </div>
              </div>
              {live === "reconnecting" ? (
                <p className="cons__reconnect muted" role="status">
                  Reconnecting… what is shown stays as it was.
                </p>
              ) : null}

              <RunStatTiles stats={stats} variant="page" />

              {tool ? (
                <div className="cons__filter">
                  <span>
                    Steps that called <code>{tool}</code> · {shown.length}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParam("tool", null)}>
                    <Icon name="close" size={14} />
                    Clear filter
                  </button>
                </div>
              ) : null}

              <div className="ct-scroll">
                <div className="card ct" role="table" aria-label="Trace">
                  <div className="tr label" role="row">
                    <span role="columnheader">Step</span>
                    <span role="columnheader">Started</span>
                    <span role="columnheader">Agent</span>
                    <span role="columnheader">Duration</span>
                    <span role="columnheader">Tokens</span>
                    <span role="columnheader">Summary</span>
                    <span role="columnheader">
                      <span className="sr-only">Expand</span>
                    </span>
                  </div>
                  {shown.map((r) => {
                    const isOpen = open.has(r.key);
                    const pending = r.state === "pending";
                    const failed = r.state === "failed" || r.checksFailed > 0;
                    return (
                      <div key={`${selected.id}-${r.key}`} id={`row-${r.key}`} role="rowgroup">
                        <div className={`tr ${isOpen ? "open" : ""} ${pending ? "pending" : ""}`} role="row">
                          <span role="cell" className="tr-step">
                            {r.state === "running" ? <span className="pulse" aria-hidden="true" /> : <span className={`cdot ${r.kind === "clinician" ? "human" : ""} ${failed || r.state === "critical" ? "warn" : ""}`} aria-hidden="true" />}
                            <strong>{r.title}</strong>
                          </span>
                          <span role="cell" className="mono muted">
                            {r.at ? hhmmss(r.at) : "—"}
                          </span>
                          <span role="cell" className="tr-tags">
                            <span className="tag">{r.agent}</span>
                            {r.models.map((m) => (
                              <span key={m} className="tag tag-model">
                                {m}
                              </span>
                            ))}
                          </span>
                          <span role="cell" className={`mono ${r.ms === null ? "muted" : ""}`}>
                            {r.kind === "clinician" || r.ms === null ? "—" : r.state === "running" ? `running · ${duration(r.ms)}` : duration(r.ms)}
                          </span>
                          <span role="cell" className={`mono ${r.tokens ? "" : "muted"}`}>
                            {r.tokens ? tokens(r.tokens) : "—"}
                          </span>
                          <span role="cell" className={r.state === "failed" ? "inline-error" : "tr-sum"}>
                            {failed ? <span className="chip chip-warn tr-failed">Failed</span> : null}
                            {r.state === "running" ? <span className="tr-skel" aria-hidden="true" /> : r.summary}
                          </span>
                          <span role="cell">
                            <button type="button" className="ib ib-flat" aria-expanded={isOpen} aria-controls={`detail-${r.key}`} aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.title}`} disabled={pending} onClick={() => toggle(r.key)}>
                              <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
                            </button>
                          </span>
                        </div>
                        {isOpen ? <Expanded row={r} study={selected} onCopy={() => void copyLink(r.key)} /> : null}
                      </div>
                    );
                  })}
                  {tool && !shown.length ? <p className="muted tr-none">No step in this run called {tool}.</p> : null}
                </div>
              </div>
              <p className="muted cons__foot">Model steps run on {manifestModels().join(" and ")}; prompts and raw answers are kept for demo cases only.</p>
            </>
          ) : (
            <div className="cons__empty">
              <h1>{loading ? "Loading cases…" : caseId ? "Case not found" : "No cases yet"}</h1>
              {!loading ? <p className="muted">{caseId ? "It may have been removed, or it belongs to another account." : "Add a study from the worklist and its agent steps appear here as they run."}</p> : null}
              {!loading ? (
                <Link className="btn btn-secondary" to="/worklist">
                  Back to worklist
                </Link>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
