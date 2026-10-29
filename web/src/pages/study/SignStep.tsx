/**
 * Card W6 · Sign (SPEC §4.5, §5.6): the report drafted in the background
 * from the decisions (B23), one attestation, inline signing with a toast,
 * read-only once signed. No dialogs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Study } from "@/types/study";
import { reportText } from "@/utils/reportText";
import { clinicianName, useAuth } from "~/auth/AuthContext";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { regenerateReport, saveReport, signStudy, type SignNeed } from "~/data/actions";
import { isSigned, patientOf, studyLabel, type FindingView, caseIdOf } from "~/data/model";
import { hhmm } from "~/lib/format";
import { isTyping } from "~/lib/keys";

const NEED_TEXT: Record<SignNeed, string> = {
  decide_every_finding: "Decide every finding first (accept, edit or reject).",
  close_radiologist_read: "Close the radiologist read first.",
  write_impression: "Write an impression.",
  write_recommendation: "Write a recommendation.",
  refresh_summary: "The report is still updating from your latest decisions.",
  confirm_impression: "Confirm the impression and recommendation are your own.",
};

/** Report lines: the frozen report once signed, else the accepted / edited findings in order. */
function reportLines(study: Study, findings: FindingView[]): { n: number; text: string; edited: boolean }[] {
  if (study.report) {
    return study.report.findings
      .filter((f) => f.status !== "rejected")
      .map((f) => {
        const view = findings.find((v) => v.id === f.id);
        return { n: view?.n ?? 0, text: f.text, edited: f.status === "edited" };
      });
  }
  return findings.filter((f) => f.decision === "accepted" || f.decision === "edited").map((f) => ({ n: f.n, text: f.sentence, edited: f.decision === "edited" }));
}

export function SignPanel({
  study,
  findings,
  onFocus,
  onBack,
  onSigned,
}: {
  study: Study;
  findings: FindingView[];
  onFocus: (n: number | null) => void;
  onBack: () => void;
  onSigned: () => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const signed = isSigned(study);
  const [attested, setAttested] = useState(false);
  const [signing, setSigning] = useState(false);
  const [needs, setNeeds] = useState<SignNeed[]>([]);
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const summary = signed ? study.report?.summary : study.clinicianSummary;
  const [impression, setImpression] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const staleSince = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const lines = reportLines(study, findings);
  const p = patientOf(study);
  const stale = !signed && !!study.clinicianSummary && !study.clinicianSummary.editedByClinician && study.clinicianSummary.generatedFromReviewHash !== study.reviewHash;
  if (stale && staleSince.current === null) staleSince.current = Date.now();
  if (!stale) staleSince.current = null;
  // The background draft gave up (model didn't answer, e.g. the GPU was
  // starting): say so and offer a retry instead of "Updating…" forever.
  const draftFailed = stale && !!study.reportDraft?.failedAt && !study.reportDraft?.forHash;
  // The private GPU scaled to zero during the review and is starting (~5 min);
  // the background drafter waits for it and writes the report by itself.
  const [gpuQueued, setGpuQueued] = useState(false);
  const gpuStarting = stale && !draftFailed && (!!study.reportDraft?.warming || gpuQueued);
  const stuck = draftFailed || gpuStarting || (stale && staleSince.current !== null && now - staleSince.current > 20_000);
  const name = study.signed?.name ?? clinicianName(profile, study.clinicianName);
  const noteState = !signed ? "after" : study.patientSummary ? "ready" : "drafting";

  useEffect(() => {
    if (!stale) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [stale]);

  // The background draft waits for a finished review; continuing with some
  // findings undecided asks for the draft here instead.
  const asked = useRef(false);
  const undecided = findings.some((f) => f.decision === "pending");
  useEffect(() => {
    if (!stale || !undecided || asked.current) return;
    asked.current = true;
    regenerateReport(study.id).catch(() => {
      asked.current = false;
    });
  }, [stale, undecided, study.id]);

  useEffect(() => {
    if (!stale) setGpuQueued(false);
  }, [stale]);

  // Editing opens at the top of the report; take the clinician there.
  useEffect(() => {
    if (editing) document.getElementById("sg-impression")?.focus();
  }, [editing]);

  const updatingRef = useRef(false);
  const update = useCallback(async () => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setUpdating(true);
    try {
      const out = await regenerateReport(study.id);
      if (out.queued) {
        setGpuQueued(true);
        toast({ message: "The private GPU is starting (about 5 min). The report will update by itself, or write the impression yourself to sign now." });
        return;
      }
      setNeeds((n) => n.filter((x) => x !== "refresh_summary"));
      toast({ message: "Report updated from your decisions" });
    } catch (error) {
      console.error("[sign] report update failed", error);
      toast({ message: "The model didn't answer in time — it may be starting up. Try again in a minute.", action: { label: "Retry", onClick: () => void update() } });
    } finally {
      updatingRef.current = false;
      setUpdating(false);
    }
  }, [study.id, toast]);

  const sign = useCallback(async () => {
    if (!attested || signing || signed) return;
    setSigning(true);
    setNeeds([]);
    try {
      const out = await signStudy(study.id, true);
      if (!out.ok) {
        setNeeds(out.needs);
        // Refused only because the report is behind the decisions: redraft now
        // rather than waiting for the clinician to find "Update now".
        if (out.needs.includes("refresh_summary")) void update();
        return;
      }
      toast({ message: `Report signed · ${hhmm(Date.parse(out.signedAt) || Date.now())}` });
      onSigned();
    } catch {
      toast({ message: "Couldn't sign. Check your connection and try again.", action: { label: "Retry", onClick: () => void sign() } });
    } finally {
      setSigning(false);
    }
  }, [attested, signing, signed, study.id, toast, onSigned, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isTyping(e.target)) {
        e.preventDefault();
        void sign();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sign]);

  // A refused sign leaves its needs on screen; once the report catches up
  // with the decisions, the "still updating" one no longer applies.
  const draftedFrom = study.clinicianSummary?.generatedFromReviewHash;
  useEffect(() => {
    if (!stale) setNeeds((n) => (n.includes("refresh_summary") ? n.filter((x) => x !== "refresh_summary") : n));
  }, [stale, draftedFrom]);


  const startEdit = () => {
    setImpression((summary?.impression ?? []).join("\n"));
    setRecommendation(summary?.recommendation ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!study.clinicianSummary) return;
    try {
      await saveReport(study.id, study.clinicianSummary, {
        findings: study.clinicianSummary.findings,
        impression: impression.split("\n").map((s) => s.trim()).filter(Boolean),
        recommendation: recommendation.trim(),
      });
      setEditing(false);
      toast({ message: "Report updated. Your wording is recorded as yours." });
    } catch {
      toast({ message: "Couldn't save the report." });
    }
  };

  const copy = async () => {
    const text = reportText({
      studyType: studyLabel(study),
      findings: lines.map((l) => `${l.n}. ${l.text}`).join("\n"),
      impression: summary?.impression ?? [],
      recommendation: summary?.recommendation ?? "",
      reviewedBy: name,
      aiDrafted: true,
      ...(study.signed ? { signature: { by: study.signed.name, date: study.report?.signedAt ?? "", hash: study.signed.reportHash } } : {}),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: "Copied" });
    } catch {
      toast({ message: "Couldn't copy. Select the text and copy it instead." });
    }
  };

  return (
    <>
      <div className="panel__body">
        <div className="sg-tabs">
          <nav aria-label="Report views" className="sg-tabs__nav">
            <span className="tab cur" aria-current="page">
              Clinician report
            </span>
            {noteState === "after" ? (
              <span className="tab" aria-disabled="true">
                Patient note <span className="chip chip-neutral">Drafts after you sign</span>
              </span>
            ) : (
              <button type="button" className="tab" onClick={onSigned}>
                Patient note{" "}
                {noteState === "ready" ? (
                  <span className="chip chip-ok">Draft ready</span>
                ) : (
                  <span className="chip chip-neutral">
                    <span className="pulse" aria-hidden="true" />
                    Drafting…
                  </span>
                )}
              </button>
            )}
          </nav>
          <div className="sg-tabs__tools">
            {!signed && !editing && study.clinicianSummary ? (
              <button type="button" className="btn btn-ghost" onClick={startEdit}>
                <Icon name="edit" />
                Edit
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
              <Icon name="copy" />
              Copy
            </button>
          </div>
        </div>

        <article className="card sg-report">
          <div className="sg-report__head">
            <h1 className="sg-report__title">
              {studyLabel(study)} · {p.displayName}
              {p.ageSex ? `, ${p.ageSex}` : ""} · <span className="mono">{caseIdOf(study)}</span>
            </h1>
            <span className="muted">
              Drafted from your {lines.length} accepted finding{lines.length === 1 ? "" : "s"}
            </span>
          </div>

          {stale ? (
            <div className="sg-updating" role="status">
              {draftFailed && !updating ? (
                <>
                  <Icon name="info" size={14} />
                  Couldn't redraft the report from your latest decisions.
                </>
              ) : gpuStarting ? (
                <>
                  <span className="pulse" aria-hidden="true" />
                  Starting the private GPU (about 5 min). The report updates by itself.
                </>
              ) : (
                <>
                  <span className="pulse" aria-hidden="true" />
                  Updating report…
                </>
              )}
              {stuck && !gpuStarting ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={updating} onClick={() => void update()}>
                  {updating ? "Updating…" : "Update now"}
                </button>
              ) : null}
              {stuck && !editing ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
                  Write it yourself
                </button>
              ) : null}
            </div>
          ) : null}

          <section className="sg-sec">
            <span className="label">Findings</span>
            <ol className="sg-findings">
              {lines.map((l) => (
                <li key={`${l.n}-${l.text}`} className="fl" onMouseEnter={() => onFocus(l.n)} onMouseLeave={() => onFocus(null)}>
                  <span className="num" style={{ width: 22, height: 22 }}>
                    {l.n}
                  </span>
                  <span>
                    {l.text} {l.edited ? <span className="chip chip-neutral">Edited by you</span> : null}
                  </span>
                </li>
              ))}
              {!lines.length ? <li className="muted">No findings were accepted.</li> : null}
            </ol>
          </section>

          <section className="sg-sec">
            <label className="label" htmlFor="sg-impression">
              Impression
            </label>
            {editing ? (
              <textarea id="sg-impression" rows={4} value={impression} onChange={(e) => setImpression(e.target.value)} aria-describedby="sg-impression-hint" />
            ) : (
              <ol className="sg-impression">{(summary?.impression ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
            )}
            {editing ? (
              <span id="sg-impression-hint" className="muted sg-hint">
                One statement per line.
              </span>
            ) : null}
          </section>

          <section className="sg-sec">
            <label className="label" htmlFor="sg-rec">
              Recommendation
            </label>
            {editing ? (
              <textarea id="sg-rec" rows={3} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} />
            ) : (
              <p className="sg-prose">{summary?.recommendation || <span className="muted">Not drafted yet.</span>}</p>
            )}
          </section>

          {editing ? (
            <div className="sg-edit-actions">
              <button type="button" className="btn btn-primary" onClick={() => void saveEdit()}>
                Save report
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : null}

          <div className="sg-info">
            <Icon name="info" size={14} />
            AI-drafted for clinician review. Not a diagnosis — verify against the image before signing.
          </div>
        </article>

        {needs.length ? (
          <div className="card sg-needs" role="alert">
            <strong>Before you can sign</strong>
            <ul>
              {needs.map((n) => (
                <li key={n}>
                  {NEED_TEXT[n] ?? n}
                  {n === "refresh_summary" && !gpuStarting ? (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={updating} onClick={() => void update()}>
                      {updating ? "Updating…" : "Update now"}
                    </button>
                  ) : null}
                  {n === "refresh_summary" && gpuStarting ? <span className="muted"> The private GPU is starting (about 5 min).</span> : null}
                  {n === "refresh_summary" && !editing ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
                      Write the impression yourself and sign now
                    </button>
                  ) : null}
                  {n === "decide_every_finding" ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
                      Back to findings
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <footer className="panel__foot">
        {signed ? (
          <>
            <span className="muted hint">
              Signed by {name}. The report is locked; the patient note is written from it.
            </span>
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={onSigned}>
                Continue to patient note
                <Icon name="chevronRight" />
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="sg-attest">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
              I have reviewed the image and the findings. The impression and recommendation are my own.
            </label>
            <div className="sg-sign">
              <div className="actions">
                <button type="button" className="btn btn-ghost" onClick={onBack}>
                  Back to findings
                </button>
                <button type="button" className="btn btn-primary" disabled={!attested || signing || editing} aria-describedby="sg-sign-hint" onClick={() => void sign()}>
                  {signing ? <span className="spinner" aria-hidden="true" /> : <Icon name="lock" />}
                  {signing ? "Signing…" : `Sign as ${name}`}
                </button>
              </div>
              <span id="sg-sign-hint" className="muted sg-hint">
                {attested
                  ? "Signing locks the report and records the time and a hash. The patient note is written from the signed version."
                  : "Tick the confirmation to sign."}
              </span>
            </div>
          </>
        )}
      </footer>
    </>
  );
}
