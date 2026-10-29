/** The stage timeline used by the console side panel (SPEC §4.8). */
import { Link } from "react-router-dom";

import type { Study } from "@/types/study";
import { formatCost } from "@/utils/caseTimeline";
import type { StageRow } from "~/data/timeline";
import { hhmmss } from "~/lib/format";
import { consolePath } from "~/lib/paths";

export function StageTimeline({ study, rows }: { study: Study; rows: StageRow[] }) {
  const shown = rows.filter((r) => r.state !== "pending");
  return (
    <ol className="ev-list">
      {shown.map((r, i) => (
        <li key={r.key} className={`ev ${r.kind === "clinician" ? "human" : ""} ${i === shown.length - 1 ? "last" : ""} ${r.state}`}>
          <span className="ev__d" aria-hidden="true">
            <span />
            <i />
          </span>
          <div className="ev__b">
            <div className="ev__head">
              <strong>{r.title}</strong>
              <span className="mono muted ev__time">{r.at ? hhmmss(r.at) : "—"}</span>
              <span className="tag">{r.agent}</span>
              {r.models.map((m) => (
                <span key={m} className="tag tag-model">
                  {m}
                </span>
              ))}
              {r.state === "running" ? <span className="pulse" aria-label="running" /> : null}
              <span style={{ flex: "1 1 auto" }} />
              <span className="mono muted ev__time">{formatCost(r.ms, r.tokens)}</span>
            </div>
            <p className={r.state === "failed" ? "inline-error" : "ev__line"}>{r.line}</p>
            {r.kind === "model" && r.trace.length ? (
              <Link to={consolePath(study, r.key)} className="ev__link">
                Open trace
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
