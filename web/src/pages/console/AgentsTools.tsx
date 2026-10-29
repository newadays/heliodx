/**
 * Agent console page · Agents & tools (design/agent-console SPEC §3.2): the
 * run manifest's agents (ran / running / did not run) and tools with their
 * call counts for the selected run. Clicking a tool filters the trace table.
 * Collapses to a 48 px rail; the choice is remembered per user.
 */
import { agentStatus, CONSOLE_AGENTS, CONSOLE_TOOLS, type ConsoleStep } from "@/utils/consoleRun";
import { Icon } from "~/components/Icon";

export function AgentsTools({
  steps,
  counts,
  filter,
  onFilter,
  collapsed,
  onToggle,
}: {
  steps: ConsoleStep[];
  counts: Record<string, number>;
  filter: string | null;
  onFilter: (tool: string | null) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <aside aria-label="Agents and tools" className="atp atp--rail">
        <button type="button" className="ib" aria-expanded={false} aria-label="Show agents and tools" onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </aside>
    );
  }
  const agents = [...CONSOLE_AGENTS].sort((a, b) => a.order - b.order);
  return (
    <aside aria-label="Agents and tools" className="atp">
      <div className="atp__head">
        <h2>Agents &amp; tools</h2>
        <span className="chip chip-neutral">
          {agents.length} · {CONSOLE_TOOLS.length}
        </span>
        <span style={{ flex: "1 1 auto" }} />
        <button type="button" className="ib" aria-expanded={true} aria-label="Collapse the agents and tools panel" onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </div>

      <section className="atp__sec" aria-label="Agents">
        <div className="atp__label">
          <span className="label">Agents · {agents.length}</span>
          <span className="muted">in run order</span>
        </div>
        {agents.map((a) => {
          const st = agentStatus(a, steps);
          return (
            <div key={a.id} className="atp-agent">
              <div className="atp-agent__hd">
                <strong>{a.name}</strong>
                {a.models.map((m) => (
                  <span key={m} className="tag tag-model">
                    {m}
                  </span>
                ))}
                <span style={{ flex: "1 1 auto" }} />
                <span className={`atp-dot atp-dot--${st}`} role="img" aria-label={st === "ran" ? "Ran in this run" : st === "running" ? "Running" : "Did not run"} />
              </div>
              <p>{a.role}</p>
            </div>
          );
        })}
      </section>

      <section className="atp__sec" aria-label="Tools available">
        <div className="atp__label">
          <span className="label">Tools available · {CONSOLE_TOOLS.length}</span>
          <span className="muted">calls in this run</span>
        </div>
        <ul className="atp-tools">
          {CONSOLE_TOOLS.map((t) => {
            const n = counts[t.name] ?? 0;
            const on = filter === t.name;
            return (
              <li key={t.name} className={`atp-tool ${on ? "is-filtering" : ""}`}>
                <button type="button" className="atp-tool__btn" aria-pressed={on} onClick={() => onFilter(on ? null : t.name)}>
                  <code>
                    {t.name}
                    <span>({t.params.join(", ")})</span>
                  </code>
                  <span className="atp-tool__desc">{t.description}</span>
                </button>
                <span className="atp-tool__side">
                  {on ? (
                    <button type="button" className="chip chip-ink atp-tool__clear" aria-label={`Clear the ${t.name} filter`} onClick={() => onFilter(null)}>
                      filtering
                      <Icon name="close" size={12} />
                    </button>
                  ) : null}
                  <span className={`atp-tool__ct ${n ? "" : "is-zero"}`}>×{n}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="muted atp__note">Read from the run manifest. These are the only tools the agents can call; a step that needs anything else escalates.</p>
    </aside>
  );
}
