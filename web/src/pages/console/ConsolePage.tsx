/**
 * Card W10 · Agent console, full page (SPEC §4.9): live cases with search and
 * filters, the selected case's totals and a trace table whose rows expand in
 * place (Summary · Prompt · Raw output · Timing). Deep link `?step=<stage>`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { Study, TraceEntry } from "@/types/study";
import { formatCost } from "@/utils/caseTimeline";
import { AppShell } from "~/components/AppShell";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { useNow, useStorageUrl, useStudies, useTrace } from "~/data/hooks";
import { analysisElapsedMs, arrivedAt, caseIdOf, CHANNEL_LABEL, currentStage, defaultStep, findingsOf, indicationOf, lastShare, patientOf, studyLabel, viewStatus, type ViewStatus } from "~/data/model";
import { stageRows, traceTotals, type StageRow } from "~/data/timeline";
import { duration, hhmm, hhmmss, mss, tokens } from "~/lib/format";
import { saveJson } from "~/lib/download";
import { SourceTag } from "~/components/Source";
import { studyPath } from "~/lib/paths";

import { stageDetail } from "./stageDetail";

import "./console.css";

type Filter = "all" | "running" | "ready" | "signed";
const FILTERS: { key: Filter; label: string; match: (s: ViewStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "running", label: "Running", match: (s) => s === "analyzing" || s === "failed" },
  { key: "ready", label: "Ready", match: (s) => s === "draft_ready" || s === "in_review" },
  { key: "signed", label: "Signed", match: (s) => s === "signed" || s === "shared" },
];

const STATUS_CHIP: Record<ViewStatus, { cls: string; label: string }> = {
  analyzing: { cls: "chip-neutral", label: "Analyzing" },
  failed: { cls: "chip-warn", label: "Needs attention" },
  draft_ready: { cls: "chip-ok", label: "Draft ready" },
  in_review: { cls: "chip-ok", label: "In review" },
  signed: { cls: "chip-ink", label: "Signed" },
  shared: { cls: "chip-ink", label: "Shared" },
};

function caseLine(s: Study, now: number): { text: string; running: boolean; human: boolean } {
  const vs = viewStatus(s);
  if (vs === "analyzing") return { text: `Running · ${currentStage(s) || "Queued"} · ${Math.round(analysisElapsedMs(s, now) / 1000)} s`, running: true, human: false };
  if (vs === "failed") return { text: "Analysis didn't complete", running: false, human: false };
  if (vs === "draft_ready" || vs === "in_review") return { text: `${STATUS_CHIP[vs].label} · ${findingsOf(s).length} findings`, running: false, human: false };
  const share = lastShare(s);
  return { text: share ? `Shared · ${CHANNEL_LABEL[share.channel]} · ${hhmm(arrivedAt({ createdAt: share.sentAt }) ?? null)}` : "Signed", running: false, human: true };
}

function Thumb({ path }: { path: string }) {
  const url = useStorageUrl(path);
  return url ? <img className="tr-thumb" src={url} alt="Overlay" /> : <span className="tr-thumb" aria-hidden="true" />;
}

function Calls({ calls }: { calls: TraceEntry[] }) {
  if (!calls.length) return <p className="muted">No model or tool calls were recorded for this step.</p>;
  return (
    <ol className="calls">
      {calls.map((t, i) => (
        <li key={t.id} className={t.ok ? "" : "fail"}>
          <span className="mono muted">{i + 1}</span>
          <div className="calls__main">
            <span className="mono calls__name">{t.name}</span>
            {t.args ? <code className="calls__args">{JSON.stringify(t.args)}</code> : null}
            <span className="calls__result">{t.result}</span>
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

type Tab = "summary" | "prompt" | "raw" | "timing";

function Expanded({ row, study, onCopy }: { row: StageRow; study: Study; onCopy: () => void }) {
  const [tab, setTab] = useState<Tab>("summary");
  const d = stageDetail(row, study);
  const models = row.trace.filter((t) => t.kind === "model");
  const withDetail = models.filter((t) => t.detail);
  return (
    <div className="tr-detail" id={`detail-${row.key}`}>
      <div className="ptabs" role="tablist" aria-label="Trace views">
        {(["summary", "prompt", "raw", "timing"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ptab ${tab === t ? "cur" : ""}`} onClick={() => setTab(t)}>
            {t === "summary" ? "Summary" : t === "prompt" ? "Prompt" : t === "raw" ? "Raw output" : "Timing"}
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
            <span className="label">Measurements and overlays</span>
            <ul>{d.measurements.length ? d.measurements.map((x, i) => <li key={i}>{x}</li>) : <li className="muted">None for this step</li>}</ul>
            {d.overlays.length ? (
              <div className="tr-thumbs">
                {d.overlays.map((p) => (
                  <Thumb key={p} path={p} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
      {tab === "timing" ? <Calls calls={row.trace} /> : null}
      <div className="tr-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCopy}>
          <Icon name="copy" size={14} />
          Copy trace link
        </button>
        <span className="muted">Replay is coming later; it will never touch a signed case.</span>
      </div>
    </div>
  );
}

export default function ConsolePage() {
  const { caseId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(1000);
  const { data: studies, loading } = useStudies(200);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const sorted = useMemo(() => [...studies].sort((a, b) => (arrivedAt(b) ?? 0) - (arrivedAt(a) ?? 0)), [studies]);
  const selected = sorted.find((s) => caseIdOf(s) === caseId) ?? (caseId ? null : sorted.find((s) => viewStatus(s) === "analyzing") ?? sorted[0] ?? null);
  const trace = useTrace(selected?.id ?? null);
  const rows = selected ? stageRows(selected, trace, now) : [];
  const totals = selected ? traceTotals(selected, rows) : null;
  const deep = params.get("step");
  const [open, setOpen] = useState<Set<string>>(() => new Set(deep ? [deep] : []));
  const scrolled = useRef(false);
  const running = studies.filter((s) => viewStatus(s) === "analyzing").length;

  useEffect(() => {
    if (!deep || scrolled.current || !rows.length) return;
    scrolled.current = true;
    setOpen((o) => new Set(o).add(deep));
    requestAnimationFrame(() => document.getElementById(`row-${deep}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [deep, rows.length]);

  const q = query.trim().toLowerCase();
  const list = sorted.filter((s) => {
    if (!FILTERS.find((f) => f.key === filter)!.match(viewStatus(s))) return false;
    if (!q) return true;
    return [patientOf(s).displayName, caseIdOf(s), currentStage(s), viewStatus(s)].join(" ").toLowerCase().includes(q);
  });

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
      toast({ message: "Copied" });
    } catch {
      toast({ message: url });
    }
  };

  const exportJson = () => {
    if (!selected || !totals) return;
    saveJson(
      {
        caseId: caseIdOf(selected),
        // §4.11: the export carries the source; an upload's original file name is never exported.
        source: selected.source,
        patient: patientOf(selected).displayName,
        study: studyLabel(selected),
        status: viewStatus(selected),
        totals,
        stages: rows.map(({ trace: calls, ...r }) => ({ ...r, calls })),
      },
      `HelioDX-${caseIdOf(selected)}-trace.json`,
    );
    toast({ message: "Export ready" });
  };

  const p = selected ? patientOf(selected) : null;
  const chip = selected ? STATUS_CHIP[viewStatus(selected)] : null;

  return (
    <AppShell crumbs={[{ label: "Worklist", to: "/worklist" }, { label: "Agent console" }]}>
      <div className="cons">
        <aside aria-label="Cases" className="cons__cases">
          <div className="cons__cases-head">
            <h2>Cases</h2>
            {running ? (
              <span className="chip chip-ok">
                <span className="pulse" aria-hidden="true" />
                {running} running
              </span>
            ) : null}
          </div>
          <label className="cons__search">
            <span className="label">Search</span>
            <input type="search" placeholder="Patient, case ID or step" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="fchips" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={`fchip ${filter === f.key ? "on" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                {f.key === "all" ? ` ${studies.length}` : ""}
              </button>
            ))}
          </div>
          <nav className="cons__list" aria-label="Case list">
            {list.map((s) => {
              const line = caseLine(s, now);
              const sel = selected?.id === s.id;
              return (
                <Link key={s.id} to={`/console/${caseIdOf(s)}`} className={`case ${sel ? "sel" : ""}`} aria-current={sel ? "true" : undefined}>
                  <span className="case__top">
                    <strong>{patientOf(s).displayName}</strong>
                    <SourceTag study={s} />
                    <span className="mono muted">{caseIdOf(s)}</span>
                  </span>
                  <span className="case__line">
                    {line.running ? <span className="pulse" aria-hidden="true" /> : <span className={`cdot ${line.human ? "human" : ""}`} aria-hidden="true" />}
                    {line.text}
                  </span>
                </Link>
              );
            })}
            {!loading && !list.length ? <p className="muted">No cases match.</p> : null}
          </nav>
          <div style={{ flex: "1 1 auto" }} />
          <p className="muted cons__note">Every step records its agent, model, duration and tokens. Clinician actions are logged beside them so a case reads as one timeline.</p>
        </aside>

        <main className="cons__main">
          {selected && p && chip && totals ? (
            <>
              <div className="cons__head">
                <div className="cons__title">
                  <div className="cons__name">
                    <h1>{p.displayName}</h1>
                    <SourceTag study={selected} />
                    <span className="mono muted">{caseIdOf(selected)}</span>
                    <span className={`chip ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <p className="muted">
                    {[studyLabel(selected), p.ageSex, indicationOf(selected)].filter(Boolean).join(" · ")} · arrived <span className="mono">{hhmmss(arrivedAt(selected))}</span> · clinician {selected.clinicianName}
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

              <div className="stats stats-page">
                <div className="stat">
                  <b>{duration(totals.agentTimeMs)}</b>
                  <span>Agent time</span>
                </div>
                <div className="stat">
                  <b>{tokens(totals.tokens)}</b>
                  <span>Tokens</span>
                </div>
                <div className="stat">
                  <b>{totals.modelSteps}</b>
                  <span>Model steps</span>
                </div>
                <div className="stat">
                  <b>{totals.clinicianSteps}</b>
                  <span>Clinician steps</span>
                </div>
                <div className="stat">
                  <b>{totals.arrivalToSharedMs !== null ? mss(totals.arrivalToSharedMs) : "—"}</b>
                  <span>Arrival to shared</span>
                </div>
              </div>

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
                  {rows.map((r) => {
                    const isOpen = open.has(r.key);
                    const pending = r.state === "pending";
                    return (
                      <div key={r.key} id={`row-${r.key}`} role="rowgroup">
                        <div className={`tr ${isOpen ? "open" : ""} ${pending ? "pending" : ""}`} role="row">
                          <span role="cell" className="tr-step">
                            {r.state === "running" ? <span className="pulse" aria-hidden="true" /> : <span className={`cdot ${r.kind === "clinician" ? "human" : ""} ${r.state === "failed" || r.state === "critical" ? "warn" : ""}`} aria-hidden="true" />}
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
                            {r.kind === "clinician" || r.ms === null ? "—" : duration(r.ms)}
                          </span>
                          <span role="cell" className={`mono ${r.tokens ? "" : "muted"}`}>
                            {r.tokens ? tokens(r.tokens) : "—"}
                          </span>
                          <span role="cell" className={r.state === "failed" ? "inline-error" : "tr-sum"}>
                            {r.line}
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
                </div>
              </div>
              <p className="muted cons__foot">{formatCost(totals.agentTimeMs, totals.tokens) ? `Model steps run on Glimmer; segmentation on SAM 3.1.` : ""}</p>
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
