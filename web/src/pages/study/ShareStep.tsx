/**
 * Card W7 · Patient note + Share (SPEC §4.6a, §5.5). The note is written from
 * the signed report automatically (B24) and checked against it; the only
 * share for now is a one-page PDF, downloaded in place. Consent is optional
 * for a PDF and recorded either way. WhatsApp and email return with §4.6b.
 * An upload's pseudonym is never used as a name: it reads "the patient".
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { PatientSummary, Study } from "@/types/study";
import { shareNeedText } from "@/utils/shareNeeds";
import { normalizePatientSummary, withEdits } from "@/utils/patientSummary";
import { tsToMillis } from "@/utils/millis";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { generatePatientNote, savePatientNote, shareStudy } from "~/data/actions";
import { useOrganization } from "~/data/hooks";
import { caseIdOf, patientOf } from "~/data/model";
import { checkNote } from "~/data/noteCheck";
import { dayTime } from "~/lib/format";
import { downloadUrl, openExternal } from "~/lib/download";

export function SignedStrip({ study, onView }: { study: Study; onView?: () => void }) {
  if (!study.signed) return null;
  const hash = study.signed.reportHash.replace(/^sha256:/, "").slice(0, 8);
  return (
    <div className="signed-strip" role="status">
      <Icon name="lock" />
      <span>
        <strong>Report signed</strong> by {study.signed.name} · {dayTime(tsToMillis(study.signed.at) || null)} · <span className="mono">sha256 {hash}…</span> · locked
      </span>
      <div style={{ flex: "1 1 auto" }} />
      {onView ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onView}>
          View signed report
        </button>
      ) : null}
    </div>
  );
}

function useNote(study: Study): PatientSummary | null {
  return normalizePatientSummary(study.patientSummary as never);
}

/** The patient's first name, or null for an upload (its label is a pseudonym, never a name). */
export function patientFirstName(study: Study): string | null {
  return study.source === "upload" ? null : patientOf(study).firstName;
}

export function noteFileName(study: Pick<Study, "id" | "caseId">): string {
  return `HelioDX-${caseIdOf(study)}-patient-note.pdf`;
}

export function NotePane({ study }: { study: Study }) {
  const toast = useToast();
  const note = useNote(study);
  const org = useOrganization(study.orgId);
  const [editing, setEditing] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [body, setBody] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [waited, setWaited] = useState(false);
  const check = rewriting ? ({ status: "rewriting" } as const) : checkNote(editing ? { body, nextSteps: (note?.nextSteps ?? []).map((s, i) => ({ ...s, text: steps[i] ?? s.text })) } : note, study.report);
  const locked = study.status === "shared" || study.status === "closed";

  useEffect(() => {
    if (note) return;
    const t = setTimeout(() => setWaited(true), 25_000);
    return () => clearTimeout(t);
  }, [note]);

  const rewrite = async () => {
    setRewriting(true);
    setEditing(false);
    try {
      await generatePatientNote(study.id);
    } catch {
      toast({ message: "Couldn't rewrite the note. Try again.", action: { label: "Retry", onClick: () => void rewrite() } });
    } finally {
      setRewriting(false);
    }
  };

  const startEdit = () => {
    if (!note) return;
    setBody(note.body);
    setSteps(note.nextSteps.map((s) => s.text));
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!note) return;
    try {
      await savePatientNote(study.id, withEdits(note, { title: note.title, body: body.trim(), steps: steps.map((s) => s.trim()) }));
      setEditing(false);
    } catch {
      toast({ message: "Couldn't save the wording." });
    }
  };

  const fromLine = [study.signed?.name ?? study.clinicianName, org?.name].filter(Boolean).join(" · ");
  const date = new Date(tsToMillis(study.signed?.at) || Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="note-pane" aria-label="Patient note preview">
      <div className="note-pane__bar">
        <span className="label">What {patientFirstName(study) ?? "the patient"} will receive</span>
        {check.status === "ok" ? <span className="chip chip-ok">Checked against the signed report</span> : null}
        {check.status === "unsupported" ? (
          <span className="chip chip-warn">
            {check.sentences} sentence{check.sentences === 1 ? "" : "s"} not supported by the signed report — review
          </span>
        ) : null}
        {check.status === "rewriting" ? (
          <span className="chip chip-neutral">
            <span className="pulse" aria-hidden="true" />
            Rewriting from the signed report…
          </span>
        ) : null}
        <div style={{ flex: "1 1 auto" }} />
        {!locked && note ? (
          <div className="note-pane__tools">
            {editing ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveEdit()}>
                  Save wording
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={startEdit} disabled={rewriting}>
                  <Icon name="edit" />
                  Edit wording
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void rewrite()} disabled={rewriting}>
                  Rewrite from report
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="note-pane__stage">
        <article className="note" aria-label="Patient note" aria-busy={!note || rewriting}>
          <div className="note__from">
            <span>{fromLine}</span>
            <span className="muted">{date}</span>
          </div>
          {note && !rewriting ? (
            <>
              <h2>{note.title}</h2>
              {editing ? (
                <label className="note__edit">
                  <span className="sr-only">Note body</span>
                  <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
              ) : (
                <p className="note__body">{note.body}</p>
              )}
              <div className="note__next">
                <span className="note__next-title">What happens next</span>
                <ul className="note__steps">
                  {note.nextSteps.map((s, i) => (
                    <li key={i}>
                      {editing ? (
                        <label className="note__edit">
                          <span className="sr-only">Next step {i + 1}</span>
                          <textarea rows={2} value={steps[i] ?? ""} onChange={(e) => setSteps((all) => all.map((v, j) => (j === i ? e.target.value : v)))} />
                        </label>
                      ) : (
                        <span className={check.status === "unsupported" && check.steps.includes(i + 1) ? "note__flag" : ""}>{s.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="note__foot">
                <span>{note.attribution ?? `Reviewed and approved by ${note.reviewedBy}`}
                  {study.source === "upload" ? " · HelioDX research prototype" : org?.name ? ` · ${org.name}` : ""}</span>
                <span>This note explains your X-ray in plain language. Your full report stays in your record.</span>
              </div>
            </>
          ) : (
            <div className="note__skel" aria-hidden="true">
              <span className="skel" style={{ width: "62%", height: 18 }} />
              <span className="skel" style={{ width: "100%" }} />
              <span className="skel" style={{ width: "94%" }} />
              <span className="skel" style={{ width: "88%" }} />
              <span className="skel" style={{ width: "40%", marginTop: 8 }} />
              <span className="skel" style={{ width: "90%" }} />
            </div>
          )}
          {!note && !rewriting ? (
            <p className="muted note__drafting" role="status">
              Writing the note from the signed report…{" "}
              {waited ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void rewrite()}>
                  Write it now
                </button>
              ) : null}
            </p>
          ) : null}
        </article>
        <p className="muted note-pane__pdf">
          The PDF is this note, one page, with the case ID <span className="mono">{caseIdOf(study)}</span> in the footer. The image and your clinical findings are not included.
        </p>
      </div>
    </section>
  );
}

/** §4.6a consent sentence: optional for a PDF, recorded either way. */
export function consentSentence(firstName: string | null): string {
  return `${firstName ?? "The patient"} agreed to receive a printed or saved copy of this note.`;
}

async function savePdf(url: string, filename: string): Promise<void> {
  try {
    await downloadUrl(url, filename);
  } catch {
    // Cross-origin fetch refused (no bucket CORS): the signed URL is served
    // as an attachment, so following it downloads in place.
    openExternal(url, "_self");
  }
}

export function SharePanel({ study, onBack }: { study: Study; onBack: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const note = useNote(study);
  const first = patientFirstName(study);
  const [consent, setConsent] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [needs, setNeeds] = useState<{ needs: string[]; steps: number[] } | null>(null);
  // Wording the signed report doesn't support: saving waits for "Save PDF anyway".
  const [anyway, setAnyway] = useState(false);
  const check = checkNote(note, study.report);
  const filename = noteFileName(study);
  const warn = check.status === "unsupported";

  const download = async (confirmed = false) => {
    if (!note) return;
    if (warn && !confirmed) {
      setAnyway(true);
      return;
    }
    setBusy(true);
    setNeeds(null);
    try {
      const out = await shareStudy({ studyId: study.id, channel: "pdf", consent, consentNote: consentNote.trim() || undefined });
      if (!out.ok) {
        setNeeds({ needs: out.needs, steps: out.steps });
        return;
      }
      await savePdf(out.result.downloadUrl, filename);
      toast({ message: "PDF downloaded" });
      navigate(`/study/${caseIdOf(study)}?step=done`);
    } catch {
      toast({ message: "Couldn't save the PDF. Nothing was recorded.", action: { label: "Retry", onClick: () => void download(confirmed) } });
    } finally {
      setBusy(false);
      setAnyway(false);
    }
  };

  return (
    <>
      <div className="panel__body">
        <div className="sh-head">
          <h1>Save the patient note as a PDF</h1>
          <p className="muted">One page, to print or hand to {first ?? "the patient"}. Only the plain-language note leaves HelioDX; the image and your clinical findings stay in the record.</p>
        </div>

        <div className="card sh-pdf">
          <span className="ico sh-pdf__ico">
            <Icon name="file" />
          </span>
          <span className="sh-pdf__text">
            <span style={{ fontWeight: 600 }}>
              PDF · <span className="mono" style={{ fontWeight: 500 }}>{filename}</span>
            </span>
            <span className="muted">Downloads here — no new tab. Sending by WhatsApp or email is not available yet.</span>
          </span>
        </div>

        <section className="card sh-consent" aria-labelledby="sh-consent-title">
          <div className="sh-consent__head">
            <span className="sh-n" aria-hidden="true">1</span>
            <h2 id="sh-consent-title">Record consent</h2>
            <span className="chip chip-neutral">Optional for a PDF</span>
          </div>
          <label className="sh-consent__line">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {consentSentence(first)}
          </label>
          <label className="sh-consent__note">
            Consent note (optional)
            <input type="text" value={consentNote} maxLength={280} placeholder={`e.g. agreed at the visit, ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`} onChange={(e) => setConsentNote(e.target.value)} />
          </label>
          <p className="muted sh-third">What you record here goes into the study&apos;s audit trail with the time.</p>
        </section>

        {needs ? (
          <div className="card sg-needs" role="alert">
            <strong>Not saved yet</strong>
            <ul>
              {needs.needs.map((n) => (
                <li key={n}>{shareNeedText(n, needs.steps)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <footer className="panel__foot">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back to report
        </button>
        {anyway ? (
          <div className="rv-confirm" role="alert">
            <span>The note has wording the signed report doesn&apos;t support. Save the PDF anyway?</span>
            <div className="actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAnyway(false)}>
                Review the note
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void download(true)}>
                Save PDF anyway
              </button>
            </div>
          </div>
        ) : (
          <div className="sh-send">
            <div className="actions">
              <span className="sh-n" aria-hidden="true">2</span>
              <button type="button" className="btn btn-primary" disabled={!note || busy} aria-describedby="sh-hint" onClick={() => void download()}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" />}
                Download PDF
              </button>
            </div>
            <span id="sh-hint" className="muted sg-hint">
              {note ? "Saves the PDF and records the share in the audit trail." : "The note is still being written."}
            </span>
          </div>
        )}
      </footer>
    </>
  );
}
