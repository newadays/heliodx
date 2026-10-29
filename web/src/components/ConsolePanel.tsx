/**
 * Card W9 · Agent console side panel on the worklist (SPEC §4.8): what is
 * running now, the selected case's stage timeline and totals, live.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";

import type { Study } from "@/types/study";
import { useNow, useTrace } from "~/data/hooks";
import { caseIdOf, currentStage, analysisElapsedMs, patientOf, viewStatus } from "~/data/model";
import { stageRows, traceTotals } from "~/data/timeline";
import { duration, tokens } from "~/lib/format";
import { saveJson } from "~/lib/download";
import { consolePath, studyPath } from "~/lib/paths";

import { Icon } from "./Icon";
import { StageTimeline } from "./Timeline";

const STATUS_WORDS: Record<string, string> = {
  analyzing: "analyzing",
  failed: "needs attention",
  draft_ready: "draft ready",
  in_review: "in review",
  signed: "signed",
  shared: "signed and shared",
};

export function ConsolePanel({
  studies,
  selected,
  onSelect,
  onClose,
}: {
  studies: Study[];
  selected: Study | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const now = useNow(1000);
  const trace = useTrace(selected?.id ?? null);
  const running = studies.find((s) => viewStatus(s) === "analyzing");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = selected ? stageRows(selected, trace, now) : [];
  const totals = selected ? traceTotals(selected, rows) : null;

  return (
    <aside aria-label="Agent console" className="cpanel">
      <div className="cpanel__head">
        <h2>Agent console</h2>
        <span className="chip chip-ok">
          <span className="pulse" aria-hidden="true" />
          Live
        </span>
        <div style={{ flex: "1 1 auto" }} />
        <Link className="btn btn-secondary btn-sm" to={consolePath(selected)}>
          <Icon name="external" size={14} />
          Open full console
        </Link>
        <button type="button" className="ib ib-sm cpanel__close" aria-label="Close console" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="cpanel__body">
        {running ? (
          <Link to={studyPath(running, "analyzing")} className="cpanel__running">
            <span className="pulse" aria-hidden="true" />
            <span>
              <strong>Running now:</strong> {patientOf(running).displayName} · {currentStage(running) || "Queued"} · {Math.round(analysisElapsedMs(running, now) / 1000)} s
            </span>
            <span style={{ flex: "1 1 auto" }} />
            <span className="cpanel__follow">Follow</span>
          </Link>
        ) : null}

        <label className="cpanel__case">
          <span className="label">Case</span>
          <select value={selected?.id ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {patientOf(s).displayName} · {s.source === "sample" ? "SAMPLE" : "UPLOADED"} · {caseIdOf(s)} · {STATUS_WORDS[viewStatus(s)]}
              </option>
            ))}
          </select>
        </label>

        {selected && totals ? (
          <>
            <div className="stats">
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
            </div>
            <StageTimeline study={selected} rows={rows} />
          </>
        ) : (
          <p className="muted">Pick a case to see its agent steps.</p>
        )}
      </div>

      <div className="cpanel__foot">
        <span className="muted">Model steps run on Glimmer; segmentation on SAM 3.1.</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!selected}
          onClick={() => selected && saveJson({ caseId: caseIdOf(selected), stages: rows.map(({ trace: t, ...r }) => ({ ...r, calls: t })) }, `HelioDX-${caseIdOf(selected)}-trace.json`)}
        >
          <Icon name="download" size={14} />
          Export trace
        </button>
      </div>
    </aside>
  );
}
