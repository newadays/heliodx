/** Card W4 · Analyzing (SPEC §4.3): progress, steps, findings as they stream in, and start reviewing early. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Study } from "@/types/study";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { deleteUpload, retryAnalysis } from "~/data/actions";
import { analysisElapsedMs, analysisProgress, expectedMs, gpuState, gpuWaitStart, indicationOf, isQualityRejected, studyLabel, type FindingView } from "~/data/model";
import { mss } from "~/lib/format";
import { consolePath } from "~/lib/paths";
import { MonoNumbers } from "~/lib/text";

type RowState = "done" | "running" | "todo" | "failed";

const ORDER = ["queued", "quality_check", "classifying", "detecting", "summarizing", "ready"] as const;

function rank(status: string): number {
  const i = ORDER.indexOf(status as (typeof ORDER)[number]);
  return i < 0 ? ORDER.length : i;
}

function Tick({ state }: { state: RowState }) {
  if (state === "done")
    return (
      <span className="tick done">
        <Icon name="check" size={12} />
      </span>
    );
  if (state === "running")
    return (
      <span className="tick running">
        <span className="pulse" aria-hidden="true" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="tick failed">
        <Icon name="warn" size={12} />
      </span>
    );
  return <span className="tick todo" />;
}

export function AnalyzingPanel({ study, findings, now, onStart }: { study: Study; findings: FindingView[]; now: number; onStart: () => void }) {
  const toast = useToast();
  const failed = study.status === "failed";
  const r = failed ? rank(study.pipeline?.error?.at ?? "queued") : rank(study.status);
  const state = (stepRank: number): RowState => (failed && r === stepRank ? "failed" : r > stepRank ? "done" : r === stepRank ? "running" : "todo");
  const pct = analysisProgress(study);
  const elapsed = analysisElapsedMs(study, now);
  const expected = expectedMs(study);
  const expectedTotal = study.analysis?.expectedFindings ?? 0;
  const skeletons = study.status === "detecting" || study.status === "quality_check" || study.status === "classifying" || study.status === "queued" ? Math.max(expectedTotal - findings.length, findings.length ? 1 : 2) : 0;
  const quality = study.pipeline?.quality;
  const gpu = gpuState(study);
  const waiting = gpu === "waiting";
  const waitedMs = study.pipeline?.warming?.waitedMs;

  const rows: { label: string; detail: string; state: RowState }[] = [
    ...(gpu
      ? [
          waiting
            ? {
                label: "Starting the private GPU",
                detail: `cold start after idle, usually 2–5 min · waiting ${mss(now - gpuWaitStart(study))} · continues on its own`,
                state: "running" as RowState,
              }
            : { label: "Private GPU ready", detail: waitedMs ? `started in ${mss(waitedMs)}` : "warm", state: "done" as RowState },
        ]
      : []),
    { label: "Image quality checked", detail: waiting ? "after the GPU starts" : quality && r > 1 ? (quality.ok ? "exposure and rotation within range" : quality.issues.join("; ") || "below the quality limits") : r === 0 && !waiting ? "starting the analysis" : "checking exposure and rotation", state: waiting ? "todo" : r === 0 ? "running" : state(1) },
    { label: "Study type confirmed", detail: r > 2 ? studyLabel(study) : "after the quality check", state: state(2) },
    { label: "Detecting findings", detail: findings.length ? `${findings.length} found so far` : "measuring and segmenting", state: r === 3 ? (failed ? "failed" : "running") : r > 3 ? "done" : state(3) },
    { label: "Drafting clinician report", detail: r >= 5 ? "draft ready" : "starts automatically", state: r >= 5 ? "done" : r === 4 ? "running" : failed && r === 4 ? "failed" : "todo" },
  ];

  const navigate = useNavigate();
  const rejected = isQualityRejected(study);
  const issues = study.pipeline?.quality?.issues?.length ? study.pipeline.quality.issues : [study.pipeline?.error?.message ?? "The image didn't pass the quality check."];
  const [confirmDelete, setConfirmDelete] = useState(false);

  const analyzeAnyway = async () => {
    try {
      await retryAnalysis(study.id, { analyzeAnyway: true });
      toast({ message: "Analyzing anyway. Your decision is recorded in the audit trail." });
    } catch {
      toast({ message: "Couldn't start the analysis.", action: { label: "Retry", onClick: () => void analyzeAnyway() } });
    }
  };

  const remove = async () => {
    try {
      await deleteUpload(study.id);
      navigate("/worklist");
      toast({ message: "Upload deleted" });
    } catch {
      toast({ message: "Couldn't delete the upload." });
    }
  };

  const retry = async () => {
    try {
      const started = await retryAnalysis(study.id);
      toast({ message: started ? "Analysis restarted." : "Analysis is already running." });
    } catch {
      toast({ message: "Couldn't restart the analysis.", action: { label: "Retry", onClick: () => void retry() } });
    }
  };

  return (
    <>
      <div className="panel__body">
        <div className="an-head">
          <div className="an-title">
            <h1>{rejected ? "Image rejected" : failed ? "Analysis didn't complete" : r >= 5 ? "Findings drafted" : waiting ? "Waiting for the private GPU" : "Drafting findings"}</h1>
            <div className="an-clock">
              <span className="mono">{mss(elapsed)}</span>
              <span className="muted">{r >= 5 ? "total" : waiting ? "elapsed · the first case after idle waits for the GPU" : `elapsed · usually under ${mss(expected)}`}</span>
            </div>
          </div>
          <div className={`bar an-bar ${!failed && r < 5 ? "is-live" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Analysis progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>

        <ol className="an-steps">
          {rows.map((row) => (
            <li key={row.label} className={row.state}>
              <Tick state={row.state} />
              <span className={row.state === "todo" ? "muted" : row.state === "running" ? "strong" : ""}>{row.label}</span>
              <span className="muted an-detail">{row.detail}</span>
            </li>
          ))}
        </ol>

        {rejected ? (
          <div className="card an-failed" role="alert">
            <p>
              <strong>The image didn&apos;t pass the quality check.</strong> Retrying would give the same answer.
            </p>
            <ul className="an-issues">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            {confirmDelete ? (
              <div className="actions">
                <span>Delete this upload? This can&apos;t be undone.</span>
                <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                  Delete
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={() => void analyzeAnyway()}>
                  Analyze anyway
                </button>
                {study.source === "upload" ? (
                  <>
                    <Link className="btn btn-ghost" to="/worklist?upload=1">
                      Upload a better image
                    </Link>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : failed ? (
          <div className="card an-failed" role="alert">
            <p>
              <strong>Analysis didn&apos;t complete.</strong> {study.pipeline?.error?.message ?? ""}
            </p>
            <div className="actions">
              <button type="button" className="btn btn-secondary" onClick={() => void retry()}>
                <Icon name="refresh" />
                Retry analysis
              </button>
              <Link className="btn btn-ghost" to={consolePath(study)}>
                Agent console
              </Link>
            </div>
          </div>
        ) : null}

        <div className="an-found">
          <div className="an-found__head">
            <span className="label">Findings so far</span>
            <span className="muted">New findings join the list as they are detected</span>
          </div>
          {findings.map((f) => (
            <div key={f.id} className="card an-card an-in">
              <span className="num">{f.n}</span>
              <div className="an-card__text">
                <span style={{ fontWeight: 600 }}>{f.title}</span>
                <span className="muted an-detail">
                  <MonoNumbers text={f.evidence} />
                </span>
              </div>
              <span className={`chip ${f.polarity === "attention" ? "chip-warn" : "chip-ok"}`}>{f.polarity === "attention" ? "Attention" : "Normal"}</span>
            </div>
          ))}
          {Array.from({ length: failed ? 0 : skeletons }, (_, i) => (
            <div key={`sk${i}`} className="card an-card an-skel" aria-hidden="true">
              <span className="num" style={{ background: "#E8EBEF" }} />
              <div className="an-card__text" style={{ gap: 8 }}>
                <span className="skel" style={{ width: i % 2 ? "52%" : "46%" }} />
                <span className="skel" style={{ width: i % 2 ? "28%" : "30%", height: 10 }} />
              </div>
            </div>
          ))}
        </div>

        {indicationOf(study) ? (
          <div className="card an-context">
            <span className="label">Clinical context</span>
            <p>{indicationOf(study)}</p>
          </div>
        ) : null}
      </div>
      <footer className="panel__foot">
        <span className="muted hint">You can read the findings now; decisions open when the draft is complete.</span>
        <div className="actions">
          <Link className="btn btn-ghost" to={consolePath(study)}>
            Agent console
          </Link>
          <button type="button" className="btn btn-primary" disabled={!findings.length} onClick={onStart}>
            Start reviewing
          </button>
        </div>
      </footer>
    </>
  );
}
