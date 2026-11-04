import type { PublicResults } from "@/functions/src/eval/publicSchema";

const REPO = "https://github.com/newadays/heliodx/tree/develop";

export function Methods({ data }: { data: PublicResults }) {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Evaluation</p>
        <h1 className="display">Methods</h1>
        <p className="lede">What is held equal between the two systems, how each task is graded, and what the numbers do not show.</p>
      </section>

      <section className="section" aria-labelledby="equal">
        <h2 id="equal" className="h2">
          Held equal, and what differs
        </h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="equal">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">Model</th>
                <th scope="col">Precision</th>
                <th scope="col">Hardware</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="plain prose">
          <li>Same prompts, same JSON schemas and re-ask policy, same task files.</li>
          <li>Same SAM 3.1 lung outlines and the same code measurements for both, from the HelioDX GPU, so the language model is the only difference.</li>
          <li>Glimmer runs in FP8; MedGemma in its published bf16 weights. Glimmer is 30B parameters, MedGemma 27B.</li>
        </ul>
      </section>

      <section className="section" aria-labelledby="pipeline">
        <h2 id="pipeline" className="h2">
          The pipeline each task runs
        </h2>
        <ol className="plain prose numbered">
          <li>Intake checks the image and finds both lungs with SAM 3.1.</li>
          <li>Code measures heart size, lung asymmetry, angle blunting and density from the outlines.</li>
          <li>Triage places the case in a lane, citing measurements.</li>
          <li>Prep drafts observations with evidence, zone outlines and an impression; the app removes condition names and uncited claims.</li>
          <li>After a clinician signs, the patient note rewrites the signed text in plain language.</li>
        </ol>
        <p>
          The eval imports the app's own stage code (<a href={`${REPO}/functions/src/eval`}>functions/src/eval</a>); prompts are in{" "}
          <a href={`${REPO}/functions/src/models/prompts.ts`}>models/prompts.ts</a>.
        </p>
      </section>

      <section className="section" aria-labelledby="grading">
        <h2 id="grading" className="h2">
          Grading
        </h2>
        <p className="prose">
          Every criterion is checked in code (<a href={`${REPO}/functions/src/eval/grade.ts`}>grade.ts</a>) against values fixed before the run. A task's score is the fraction of
          its criteria passed. Where the app filters the model's text, the model's answer before the filters is graded, so a filter cannot hide a miss. Screening-clinic sensitivity and
          specificity come with 95% Wilson intervals over the films that ran without error.
        </p>
      </section>

      <section className="section" aria-labelledby="limits">
        <h2 id="limits" className="h2">
          Limits, stated plainly
        </h2>
        <ul className="plain prose bullets">
          {data.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="attribution">
        <h2 id="attribution" className="h2">
          Data, terms and attribution
        </h2>
        <div className="prose">
          {data.attribution.map((a) => (
            <p key={a}>{a.replace(/\*/g, "")}</p>
          ))}
          {data.tb ? (
            <>
              <p className="label">Shenzhen and Montgomery set terms (verbatim)</p>
              <blockquote className="quote">{data.tb.dataset.terms}</blockquote>
              <p className="muted">
                No film, file name, clinical reading, age, sex or marked region from these sets is published here. Each task is listed by its library number and its film-level
                label only.
              </p>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
