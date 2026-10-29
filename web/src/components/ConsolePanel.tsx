/**
 * Agent console side panel on the worklist (design/agent-console SPEC §2): a
 * compact projection of the console page for the selected case — what is
 * running, the first four statistics and the step timeline, live.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";

import type { Study } from "@/types/study";
import { manifestModelsNote } from "@/utils/consoleRun";
import { useLiveTrace, useNow } from "~/data/hooks";
import { analysisElapsedMs, arrivedAt, caseIdOf, currentStage, patientOf, viewStatus } from "~/data/model";
import { runExport, runStats, stageRows } from "~/data/timeline";
import { saveJson } from "~/lib/download";
import { consolePath, studyPath } from "~/lib/paths";

import { Icon } from "./Icon";
import { RunStatTiles } from "./RunStatTiles";
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
  const { trace, live } = useLiveTrace(selected?.id ?? null);
  // Newest running case first; the strip names it and counts the rest.
  const running = studies.filter((s) => viewStatus(s) === "analyzing").sort((a, b) => (arrivedAt(b) ?? 0) - (arrivedAt(a) ?? 0));
  const newest = running[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = selected ? stageRows(selected, trace, now) : [];
  const stats = selected ? runStats(selected, steps, now) : null;

  return (
    <aside aria-label="Agent console" className="cpanel">
      <div className="cpanel__head">
        <h2>Agent console</h2>
        {live === "live" ? (
          <span className="chip chip-ok">
            <span className="pulse" aria-hidden="true" />
            Live
          </span>
        ) : (
          <span className="chip chip-neutral">{live === "reconnecting" ? "Reconnecting…" : "Connected"}</span>
        )}
        <div style={{ flex: "1 1 auto" }} />
        <Link className="btn btn-secondary btn-sm" to={consolePath(selected)}>
          <Icon name="external" size={14} />
          Open full console
        </Link>
        <button type="button" className="ib ib-sm cpanel__close" aria-label="Close console" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {live === "reconnecting" ? (
        <p className="cpanel__reconnect muted" role="status">
          Reconnecting… what is shown stays as it was.
        </p>
      ) : null}

      <div className="cpanel__body">
        {newest ? (
          <Link to={studyPath(newest, "analyzing")} className="cpanel__running">
            <span className="pulse" aria-hidden="true" />
            <span>
              <strong>Running now:</strong> {patientOf(newest).displayName} · {currentStage(newest) || "Queued"} · {Math.round(analysisElapsedMs(newest, now) / 1000)} s
              {running.length > 1 ? ` · +${running.length - 1} more` : ""}
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

        {selected && stats ? (
          <>
            <RunStatTiles stats={stats} variant="panel" />
            <StageTimeline study={selected} rows={steps} />
          </>
        ) : (
          <p className="muted">Pick a case to see its agent steps.</p>
        )}
      </div>

      <div className="cpanel__foot">
        <span className="muted">{manifestModelsNote()}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!selected || !stats}
          onClick={() => selected && stats && saveJson(runExport(selected, steps, stats), `HelioDX-${caseIdOf(selected)}-trace.json`)}
        >
          <Icon name="download" size={14} />
          Export trace
        </button>
      </div>
    </aside>
  );
}
