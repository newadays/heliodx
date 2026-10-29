/**
 * Agent console statistics (design/agent-console SPEC §2, §3.4): the page
 * shows all seven tiles, the side panel the first four, from the same
 * RunStats so the two surfaces always agree.
 */
import { clock, seconds, thin, type RunStats } from "@/utils/consoleRun";

export function RunStatTiles({ stats, variant }: { stats: RunStats; variant: "panel" | "page" }) {
  const checks = (
    <div className={`stat ${stats.checksFailed ? "stat--bad" : "stat--good"}`}>
      <b>{stats.checksFailed}</b>
      <span>Checks failed · {stats.checksPassed} passed</span>
    </div>
  );
  const arrival = stats.arrivalToSharedMs ?? stats.arrivalToNowMs;
  return (
    <div className={`stats ${variant === "page" ? "stats-page" : ""}`}>
      <div className="stat">
        <b>{stats.toolCalls}</b>
        <span>Tool calls</span>
      </div>
      <div className="stat">
        <b>{thin(stats.agentTokens)}</b>
        <span>Agent tokens</span>
      </div>
      <div className="stat">
        <b>{seconds(stats.agentTimeMs)}</b>
        <span>Agent time</span>
      </div>
      {variant === "panel" ? checks : null}
      {variant === "page" ? (
        <>
          <div className="stat">
            <b>{stats.observations}</b>
            <span>Observations</span>
          </div>
          {checks}
          <div className="stat">
            <b>{stats.clinicianSteps}</b>
            <span>Clinician steps</span>
          </div>
          <div className="stat">
            <b>{arrival !== null ? clock(arrival) : "—"}</b>
            <span>{stats.arrivalToSharedMs !== null ? "Arrival to shared" : "Arrival to now"}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
