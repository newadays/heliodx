/**
 * Card W8 · Done (SPEC §4.7): what was sent, what's next, and the audit
 * trail built from the case's own events (study, trace, audit), never
 * hard-coded.
 */
import { Link } from "react-router-dom";

import type { AuditEntry, ShareChannel, Study, TraceEntry } from "@/types/study";
import { tsToMillis } from "@/utils/millis";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { shareStudy } from "~/data/actions";
import { storageUrl, useAudit, useStudies, useTrace } from "~/data/hooks";
import { analysisElapsedMs, arrivedAt, caseIdOf, CHANNEL_LABEL, findingsOf, lastShare, patientOf, studyLabel, verdict, viewStatus } from "~/data/model";
import { dayTime, hhmm, mss } from "~/lib/format";
import { downloadUrl, openExternal } from "~/lib/download";
import { consolePath, studyPath } from "~/lib/paths";
import { noteFileName, patientFirstName } from "./ShareStep";

interface Event {
  at: number | null;
  title: string;
  detail: React.ReactNode;
  human?: boolean;
}

/** Audit-trail title of one share: a PDF today (§4.6a); WhatsApp and email when sending returns. */
export function shareTitle(channel: ShareChannel): string {
  return channel === "pdf" ? "Patient note saved as PDF" : `Sent via ${CHANNEL_LABEL[channel]}`;
}

/**
 * The case's audit trail (SPEC §4.7), from its audit entries (when each
 * thing happened) and trace (what the agents did), with the study for the
 * details. Same sources as the console, so the two agree.
 */
export function auditEvents(study: Study, audit: AuditEntry[], trace: TraceEntry[], now: number): Event[] {
  const findings = findingsOf(study);
  const v = verdict(findings);
  const n = (s: string) => findings.filter((f) => f.decision === s).length;
  const edited = findings.filter((f) => f.decision === "edited").map((f) => f.n);
  const at = (e: AuditEntry | undefined) => (e ? tsToMillis(e.at) || null : null);
  const all = [...audit].sort((a, b) => tsToMillis(a.at) - tsToMillis(b.at));
  // §4.11: after a sample reset, sign-off and shares count from the reset on.
  const reset = [...all].reverse().find((e) => e.action === "sample_reset");
  const sorted = reset ? all.filter((e) => tsToMillis(e.at) >= tsToMillis(reset.at) || e.to === "ready") : all;
  const first = (pred: (e: AuditEntry) => boolean) => sorted.find(pred);
  const quality = study.pipeline?.quality;
  const events: Event[] = [
    { at: arrivedAt(study), title: "Study arrived", detail: [studyLabel(study), "1 image", quality ? (quality.ok ? "quality OK" : "quality below the limits") : null].filter(Boolean).join(" · ") },
  ];
  const gpu = trace.find((t) => t.name === "wait_for_gpu");
  if (gpu || study.pipeline?.warming?.waitedMs) {
    const ms = gpu?.ms ?? study.pipeline?.warming?.waitedMs ?? 0;
    events.push({ at: tsToMillis(gpu?.at) || tsToMillis(study.pipeline?.warming?.readyAt) || null, title: "Private GPU started", detail: `waited ${mss(ms)} for a cold start` });
  }
  const ready = first((e) => e.to === "ready");
  if (ready || study.pipeline?.stepTimestamps?.ready) {
    const readyAt = at(ready) ?? (tsToMillis(study.pipeline?.stepTimestamps?.ready) || null);
    const calls = trace.filter((t) => t.kind === "model").length;
    events.push({
      at: readyAt,
      title: `Analyzed in ${mss(analysisElapsedMs(study, now))}`,
      detail: `${v.text.replace(/^(\d+) findings?/, "$1 findings drafted")}${calls ? ` · ${calls} model call${calls === 1 ? "" : "s"}` : ""}`,
    });
  }
  if (reset) events.push({ at: at(reset), title: "Sample reset", detail: "decisions, signature, note and shares cleared", human: true });
  const signed = first((e) => e.action === "study_signed");
  if (signed || study.signed) {
    const signedAt = at(signed) ?? (tsToMillis(study.signed?.at) || null);
    events.push({
      at: signedAt,
      title: `Reviewed by ${study.signed?.name ?? study.clinicianName}`,
      detail: `${n("accepted") + n("edited")} accepted · ${n("rejected")} rejected${edited.length ? ` · ${edited.length} wording edited (finding${edited.length === 1 ? "" : "s"} ${edited.join(", ")})` : ""}`,
      human: true,
    });
    events.push({
      at: signedAt,
      title: "Report signed",
      detail: (
        <>
          <span className="mono">sha256 {study.signed?.reportHash.replace(/^sha256:/, "").slice(0, 8)}…</span> · locked
        </>
      ),
      human: true,
    });
  }
  const note = first((e) => e.action === "patient_summary_generated");
  if (note || study.patientSummary) {
    const mapped = trace.find((t) => t.name === "map_next_steps")?.result;
    events.push({
      at: at(note) ?? (tsToMillis(study.pipeline?.stepTimestamps?.patient_summary_ready) || null),
      title: "Patient note written from the signed report",
      detail: mapped ?? ["plain language", study.patientSummary?.readingGrade ? `reading grade ${Math.round(study.patientSummary.readingGrade)}` : null].filter(Boolean).join(" · "),
    });
  }
  const shareAudit = sorted.filter((e) => e.action === "study_shared");
  (study.shares ?? []).forEach((s, i) => {
    events.push({
      at: at(shareAudit[i]) ?? (tsToMillis(s.sentAt) || null),
      title: shareTitle(s.channel),
      detail: (
        <>
          <span className="mono">{s.channel === "pdf" ? noteFileName(study) : s.target}</span>
          {s.consent?.given ? ` · consent recorded${s.consent.note ? ` (${s.consent.note})` : ""}` : " · consent not recorded"}
        </>
      ),
      human: true,
    });
  });
  return events;
}

export function DoneView({ study }: { study: Study }) {
  const toast = useToast();
  const { data: studies } = useStudies(200);
  const trace = useTrace(study.id);
  const audit = useAudit(study.id);
  const first = patientFirstName(study);
  const share = lastShare(study);
  const channel = share ? CHANNEL_LABEL[share.channel] : "PDF";
  const sentAt = tsToMillis(share?.sentAt) || null;
  const next = [...studies]
    .filter((s) => s.id !== study.id && (viewStatus(s) === "draft_ready" || viewStatus(s) === "in_review"))
    .sort((a, b) => (arrivedAt(a) ?? 0) - (arrivedAt(b) ?? 0))[0];
  const events = auditEvents(study, audit, trace, Date.now());

  const pdfCopy = async () => {
    const filename = noteFileName(study);
    try {
      // The PDF already shared, when there is one; otherwise a new PDF share.
      const saved = (study.shares ?? []).filter((s) => s.pdfPath).pop()?.pdfPath;
      if (saved) {
        await downloadUrl(await storageUrl(saved), filename);
        toast({ message: "PDF downloaded" });
        return;
      }
      const out = await shareStudy({ studyId: study.id, channel: "pdf", consent: false, consentNote: "Clinician's copy" });
      if (!out.ok) {
        toast({ message: "Couldn't make the PDF." });
        return;
      }
      await downloadUrl(out.result.downloadUrl, filename).catch(() => openExternal(out.result.downloadUrl, "_self"));
      toast({ message: "PDF downloaded" });
    } catch {
      toast({ message: "Couldn't make the PDF. Try again." });
    }
  };

  return (
    <main className="done-page">
      <section className="done__main">
        <div className="done__disc">
          <Icon name="check" size={26} strokeWidth={2} />
        </div>
        <div className="done__title">
          <h1>{!share || share.channel === "pdf" ? "Patient note saved as a PDF" : `Sent to ${first ?? "the patient"} via ${channel}`}</h1>
          <p className="muted">
            {sentAt ? `${dayTime(sentAt).replace(/^today/, "Today at")} · ` : ""}
            {share?.consent?.given ? "consent recorded" : "consent not recorded"}. Print it or hand it to {first ?? "the patient"}; the image and your clinical findings stay in the record.
          </p>
        </div>
        <div className="done__actions">
          <Link className="btn btn-primary" to="/worklist">
            Back to worklist
          </Link>
          {next ? (
            <Link className="btn btn-secondary" to={studyPath(next, "review")}>
              Open next: {patientOf(next).displayName}
              <Icon name="chevronRight" />
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => void pdfCopy()}>
            <Icon name="download" />
            Download the PDF again
          </button>
        </div>
        <div className="card done__replies">
          <span className="label">What the PDF contains</span>
          <p>
            One page: the plain-language note, who approved it and the case ID <span className="mono">{caseIdOf(study)}</span> in the footer. No image and no measurements, so nothing clinical can be misread without you.
          </p>
        </div>
      </section>

      <section className="card done__audit" aria-label="Audit trail">
        <div className="done__audit-head">
          <h2>Audit trail</h2>
          <Link to={consolePath(study)}>Open in agent console</Link>
        </div>
        <ol className="audit">
          {events.map((e, i) => (
            <li key={`${e.title}-${i}`} className={`aev ${i === events.length - 1 ? "last cur" : ""} ${e.human ? "human" : ""}`}>
              <span className="aev__t">{hhmm(e.at)}</span>
              <span className="aev__d" aria-hidden="true">
                <span />
                <i />
              </span>
              <div className="aev__b">
                <strong>{e.title}</strong>
                <span className="muted">{e.detail}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
