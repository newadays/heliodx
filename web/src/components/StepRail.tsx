/** Step rail (SPEC §2.2): done steps link back; current and future are plain. */
import { Fragment } from "react";
import { Link } from "react-router-dom";

import { DotCheck } from "./Icon";

export interface RailStep {
  key: string;
  label: string;
  state: "done" | "cur" | "todo";
  to?: string;
}

export function StepRail({ steps }: { steps: RailStep[] }) {
  return (
    <nav aria-label="Progress" className="rail">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 ? <span className="rule" aria-hidden="true" /> : null}
          {s.state === "done" && s.to ? (
            <Link className="step done" to={s.to}>
              <span className="dot">
                <DotCheck />
              </span>
              {s.label}
              <span className="sr-only"> (done)</span>
            </Link>
          ) : (
            <div className={`step ${s.state === "todo" ? "" : s.state}`} aria-current={s.state === "cur" ? "step" : undefined}>
              <span className="dot">{s.state === "done" ? <DotCheck /> : i + 1}</span>
              {s.label}
            </div>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
