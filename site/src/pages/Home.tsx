import { Link } from "react-router-dom";

import type { PublicResults, PublicSystemId, PublicTbSummary } from "@/functions/src/eval/publicSchema";
import { intervalBar, pct, secs, SHORT_NAME, SYSTEM_ORDER, usd } from "../format";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function Home({ data }: { data: PublicResults }) {
  const systems = SYSTEM_ORDER.filter((id) => data.systems.some((s) => s.id === id));
  const commits = [...new Set(data.systems.flatMap((s) => s.commits))];
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Evaluation · HelioDX vs MedGemma 27B</p>
        <h1 className="display">Eval results</h1>
        <p className="lede">
          {data.tasks.length} tasks on public chest X-rays, run through the same agent pipeline with HelioDX (Muse Glimmer 30B + SAM 3.1) and with MedGemma 27B on the
          same GPU and the same prompts. Every criterion is checked in code. Published {date(data.generatedAt)} from commit{commits.length > 1 ? "s" : ""}{" "}
          <code>{commits.join(", ")}</code>.
        </p>
        <p className="hero-links">
          <Link className="btn" to="/tasks">
            Browse the {data.tasks.length} tasks
          </Link>
          <Link className="btn btn-quiet" to="/methods">
            How it was graded
          </Link>
        </p>
      </section>

      {data.tb ? <TbSection tb={data.tb} systems={systems} /> : null}

      <section className="section" aria-labelledby="families">
        <h2 id="families" className="h2">
          By family
        </h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="families">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col" className="num">
                  Tasks
                </th>
                {systems.map((s) => (
                  <th key={s} scope="col" className="num">
                    {SHORT_NAME[s]}
                  </th>
                ))}
                <th scope="col" className="num">
                  Median time, H / M
                </th>
                <th scope="col" className="num">
                  Cost per task, H / M
                </th>
              </tr>
            </thead>
            <tbody>
              {data.families.map((f) => {
                const h = f.perSystem.helio?.summary;
                const m = f.perSystem.medgemma?.summary;
                return (
                  <tr key={f.id}>
                    <th scope="row">
                      <Link to={`/tasks?family=${f.id}`}>{f.label}</Link>
                    </th>
                    <td className="num">{(h ?? m)?.tasks ?? "–"}</td>
                    {systems.map((s) => (
                      <td key={s} className="num score-cell">
                        {pct(f.perSystem[s]?.summary.meanScore)}
                      </td>
                    ))}
                    <td className="num">
                      {h ? secs(h.medianLatencyMs) : "–"} / {m ? secs(m.medianLatencyMs) : "–"}
                    </td>
                    <td className="num">
                      {h ? usd(h.costPerTaskUsd) : "–"} / {m ? usd(m.costPerTaskUsd) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">Mean score: the share of a task's criteria passed, averaged over the family. Each family comes from the newest run that has it.</p>
      </section>

      {data.triage ? (
        <section className="section" aria-labelledby="triage">
          <h2 id="triage" className="h2">
            Triage
          </h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="triage">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">System</th>
                  <th scope="col" className="num">
                    Critical sent critical
                  </th>
                  <th scope="col" className="num">
                    Abnormal sent urgent or higher
                  </th>
                  <th scope="col" className="num">
                    Normal over-triaged
                  </th>
                </tr>
              </thead>
              <tbody>
                {systems.map((s) => {
                  const t = data.triage?.[s];
                  return t ? (
                    <tr key={s}>
                      <th scope="row">{SHORT_NAME[s]}</th>
                      <td className="num">{pct(t.criticalRecall)}</td>
                      <td className="num">{pct(t.abnormalRecall)}</td>
                      <td className="num">{pct(t.overTriage)}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
          <p className="note">Lower is better for over-triage. NIH labels carry no size, so an effusion is expected urgent, never critical.</p>
        </section>
      ) : null}

      <section className="section" aria-labelledby="hardware">
        <h2 id="hardware" className="h2">
          Hardware and models
        </h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="hardware">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">Model</th>
                <th scope="col">Precision</th>
                <th scope="col">GPU</th>
                <th scope="col" className="num">
                  Tasks run
                </th>
                <th scope="col" className="num">
                  Errors
                </th>
                <th scope="col" className="num">
                  GPU cost
                </th>
              </tr>
            </thead>
            <tbody>
              {data.systems.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.label}</th>
                  <td>
                    <code>{s.model}</code>
                  </td>
                  <td>{s.precision}</td>
                  <td>
                    {s.gpu}
                    {s.vllm ? `, vLLM ${s.vllm}` : ""}
                  </td>
                  <td className="num">{s.tasks}</td>
                  <td className="num">{s.errors}</td>
                  <td className="num">${s.costUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Both systems use the same SAM 3.1 lung outlines and the same code measurements, so the language model is the only difference.</p>
      </section>
    </>
  );
}

function TbSection({ tb, systems }: { tb: NonNullable<PublicResults["tb"]>; systems: PublicSystemId[] }) {
  return (
    <section className="section" aria-labelledby="tb">
      <h2 id="tb" className="h2">
        TB screening
      </h2>
      <p className="lede-sm">
        {tb.dataset.name}: {tb.dataset.tb} TB and {tb.dataset.normal} normal films. Does each system raise the TB-suggestive pattern for the clinician on TB films, and stay
        quiet on normal ones? Bars show the 95% interval.
      </p>
      <div className="tiles">
        {systems.map((s) => {
          const t = tb.perSystem[s];
          if (!t) return null;
          return (
            <article key={s} className="tile" aria-label={`${SHORT_NAME[s]}, TB screening`}>
              <h3 className="tile-name">{SHORT_NAME[s]}</h3>
              <Measure label="Sensitivity" value={t.combined.sensitivity} ci={t.combined.sensitivityCi} />
              <Measure label="Specificity" value={t.combined.specificity} ci={t.combined.specificityCi} />
              <dl className="kv">
                <div>
                  <dt>Films graded</dt>
                  <dd>{t.combined.n}</dd>
                </div>
                <div>
                  <dt>TB sent urgent or higher</dt>
                  <dd>{pct(t.combined.floorRate)}</dd>
                </div>
                <div>
                  <dt>Outline in the read zone</dt>
                  <dd>{pct(t.combined.zoneMatchRate)}</dd>
                </div>
                <div>
                  <dt>TB never named</dt>
                  <dd>{pct(t.combined.noLeakRate)}</dd>
                </div>
              </dl>
              <SplitLine label="Held-out" t={t.heldOut} />
              <SplitLine label="Tuning" t={t.tuning} />
            </article>
          );
        })}
      </div>
      <p className="note">
        Films that errored are left out of n and shown on their task pages. Labels are film-level; zones are thirds of the chest. A screening set from one or two sites; the
        numbers do not transfer to another population.
      </p>
    </section>
  );
}

function SplitLine({ label, t }: { label: string; t: PublicTbSummary | null }) {
  if (!t) return null;
  return (
    <p className="split">
      <span className="label">{label}</span> n {t.n} · sensitivity {pct(t.sensitivity)} · specificity {pct(t.specificity)}
    </p>
  );
}

function Measure({ label, value, ci }: { label: string; value: number | null; ci: [number, number] | null }) {
  const bar = intervalBar(value, ci);
  return (
    <div className="measure">
      <div className="measure-head">
        <span className="label">{label}</span>
        <span className="score">{pct(value)}</span>
      </div>
      {bar ? (
        <div className="bar" role="img" aria-label={`${label} ${pct(value)}, 95% interval ${pct(ci![0])} to ${pct(ci![1])}`}>
          <span className="bar-ci" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
          {bar.point !== null ? <span className="bar-pt" style={{ left: `${bar.point}%` }} /> : null}
        </div>
      ) : null}
      {ci ? (
        <p className="ci">
          95% interval {pct(ci[0])}–{pct(ci[1])}
        </p>
      ) : null}
    </div>
  );
}
