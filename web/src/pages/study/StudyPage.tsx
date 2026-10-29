/**
 * Card W3 · The study workspace (SPEC §2.1, §4.0): one route per case, the
 * step held in `?step=`; the film viewer stays mounted from Analyze to Sign
 * and the panel swaps per step. Share swaps the left pane for the note
 * preview; Done is its own layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import type { Study } from "@/types/study";
import { AppShell } from "~/components/AppShell";
import { warmModels } from "~/data/actions";
import type { RailStep } from "~/components/StepRail";
import { StepRail } from "~/components/StepRail";
import { useNow, useStudies, useStudy } from "~/data/hooks";
import { analysisElapsedMs, caseIdOf, defaultStep, findingsOf, isSigned, patientOf, STEPS, type Step } from "~/data/model";
import { num } from "~/lib/format";
import { tsToMillis } from "@/utils/millis";
import { provenanceLine } from "@/utils/studySource";

import { AnalyzingPanel } from "./AnalyzingStep";
import { DoneView } from "./DoneStep";
import { ReviewPanel } from "./ReviewStep";
import { SharePanel, NotePane, SignedStrip } from "./ShareStep";
import { SignPanel } from "./SignStep";
import { Viewer } from "./Viewer";

import "./study.css";

/** The case id in the URL, or a document id (links made before a case id existed). */
function useCase(param: string): { study: Study | null; loading: boolean } {
  const { data: studies, loading } = useStudies(200);
  const byCase = studies.find((s) => caseIdOf(s) === param);
  const direct = useStudy(byCase ? null : param);
  if (byCase) return { study: byCase, loading: false };
  return { study: direct.data, loading: loading || direct.loading };
}

function allowed(study: Study, step: Step): boolean {
  const s = study.status;
  const drafted = !["uploading", "queued", "quality_check", "classifying", "detecting", "summarizing", "failed"].includes(s);
  switch (step) {
    case "analyzing":
      return true;
    case "review":
      return drafted || (study.findings ?? []).length > 0;
    case "sign":
      return drafted;
    case "share":
      return isSigned(study);
    case "done":
      return s === "shared" || s === "closed";
  }
}

/** The draft landed while the page was opening (a fast run finishes before the first snapshot). */
function justDrafted(study: Study, openedAt: number): boolean {
  const readyAt = tsToMillis(study.pipeline?.stepTimestamps?.ready);
  return readyAt > 0 && readyAt >= openedAt - 8_000;
}

const RAIL: { key: string; label: string }[] = [
  { key: "analyzing", label: "Analyze" },
  { key: "review", label: "Review" },
  { key: "sign", label: "Sign" },
  { key: "note", label: "Patient note" },
  { key: "share", label: "Share" },
];

function railFor(study: Study, step: Step, path: string): RailStep[] {
  const signed = isSigned(study);
  const noteReady = ["patient_summary_ready", "shared", "closed"].includes(study.status);
  const drafted = allowed(study, "sign");
  const current = step === "analyzing" ? "analyzing" : step === "review" ? "review" : step === "sign" ? "sign" : noteReady ? "share" : "note";
  const done = (key: string): boolean => {
    if (key === "analyzing") return drafted && current !== "analyzing";
    if (key === "review") return signed || (drafted && ["sign", "note", "share"].includes(current) && (study.findings ?? []).every((f) => f.status !== "pending"));
    if (key === "sign") return signed;
    if (key === "note") return noteReady;
    return study.status === "shared" || study.status === "closed";
  };
  const target: Record<string, Step> = { analyzing: "analyzing", review: "review", sign: "sign", note: "share", share: "share" };
  return RAIL.map((r) => ({
    key: r.key,
    label: r.label,
    state: r.key === current ? "cur" : done(r.key) ? "done" : "todo",
    to: done(r.key) && r.key !== current ? `${path}?step=${target[r.key]}` : undefined,
  }));
}

export default function StudyPage() {
  const { caseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { study, loading } = useCase(caseId);
  const now = useNow(1000);
  const [focusN, setFocusN] = useState<number | null>(null);
  const watching = useRef(false);
  const opened = useRef(Date.now());
  const findings = useMemo(() => (study ? findingsOf(study) : []), [study]);

  const requested = params.get("step") as Step | null;
  const step: Step = study ? (requested && STEPS.includes(requested) && allowed(study, requested) ? requested : defaultStep(study)) : "analyzing";
  const path = study ? `/study/${caseIdOf(study)}` : "";

  const go = useCallback((next: Step) => setParams({ step: next }, { replace: false }), [setParams]);

  // A case still analyzing: make sure the private GPU is starting.
  const analyzing = !!study && !allowed(study, "sign") && study.status !== "failed";
  useEffect(() => {
    if (analyzing) void warmModels();
  }, [analyzing]);

  // Analyzing → Review on its own when the draft lands while the clinician
  // is watching; never when they opened a finished study's Analyze step.
  useEffect(() => {
    if (!study || step !== "analyzing") {
      watching.current = false;
      return;
    }
    if (!allowed(study, "sign")) watching.current = true;
    else if (watching.current || justDrafted(study, opened.current)) {
      watching.current = false;
      go("review");
    }
  }, [study, step, go]);

  if (!study) {
    if (loading) return <AppShell crumbs={[{ label: "Worklist", to: "/worklist" }, { label: caseId }]}><div className="ws" aria-busy="true" /></AppShell>;
    return (
      <AppShell crumbs={[{ label: "Worklist", to: "/worklist" }, { label: caseId }]}>
        <div className="center-page">
          <div className="card" style={{ padding: 28, maxWidth: 440, display: "flex", flexDirection: "column", gap: 12 }}>
            <h1 style={{ fontSize: 20 }}>Study not found</h1>
            <p className="muted">It may have been removed, or it belongs to another account.</p>
            <Link className="btn btn-primary" to="/worklist">
              Back to worklist
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }
  if (caseId !== caseIdOf(study)) return <Navigate to={`${path}${params.toString() ? `?${params}` : ""}`} replace />;

  const p = patientOf(study);
  const crumbs = [{ label: "Worklist", to: "/worklist" }, { label: p.displayName }];
  const rail = railFor(study, step, path);

  if (step === "done") {
    return (
      <AppShell crumbs={crumbs}>
        <DoneView study={study} />
      </AppShell>
    );
  }

  const elapsed = analysisElapsedMs(study, now);
  const focused = findings.find((f) => f.n === focusN);
  const quality = study.pipeline?.quality;
  const dims = study.image?.width ? `${study.image.width} × ${study.image.height}` : null;

  // §4.11: the film's provenance is always the status bar's second item.
  const provenance = provenanceLine(study);
  const prov = provenance ? <span>{provenance}</span> : null;
  const viewerStatus =
    step === "analyzing" ? (
      <>
        <span>{quality ? (quality.ok ? "Image quality OK" : "Image quality below the limits") : "Checking image quality…"}</span>
        {prov}
        {dims ? <span className="mono">{dims}</span> : null}
        <span>No prior studies on file</span>
      </>
    ) : step === "review" ? (
      <>
        <span>
          Spotlight: <span className="hl">{focused ? `${focused.n} · ${focused.title.toLowerCase()}` : "none"}</span>
        </span>
        {prov}
        <span>Hover a finding in the list to spotlight its region</span>
      </>
    ) : (
      <>
        <span>Markers match the numbered findings in the report</span>
        {prov}
        <span>Hover a line of the report to spotlight it</span>
      </>
    );

  const railNote =
    step === "review" ? (
      allowed(study, "sign") ? (
        <span className="muted rail-note">Analyzed in {num(elapsed / 1000, 0)} s</span>
      ) : null
    ) : step === "sign" ? (
      <span className="muted rail-note">
        {(() => {
          const n = (s: string) => findings.filter((f) => f.decision === s).length;
          const reviewed = findings.length - n("pending");
          return `${reviewed} of ${findings.length} reviewed · ${n("accepted") + n("edited")} accepted · ${n("edited")} wording edited`;
        })()}
      </span>
    ) : null;

  return (
    <AppShell crumbs={crumbs}>
      {step === "share" || (step === "sign" && isSigned(study)) ? <SignedStrip study={study} onView={step === "share" ? () => go("sign") : undefined} /> : null}
      <div className="ws">
        {step === "share" ? (
          <NotePane study={study} />
        ) : (
          <Viewer study={study} findings={findings} mode={step === "analyzing" ? "analyzing" : step === "review" ? "review" : "sign"}
            scanning={step === "analyzing" && !allowed(study, "sign") && study.status !== "failed"} focusN={focusN} onFocus={setFocusN} status={viewerStatus} />
        )}
        <section className="panel" aria-label={step === "analyzing" ? "Analysis" : step === "review" ? "Findings" : step === "sign" ? "Report" : "Share"}>
          <div className="panel__rail">
            <StepRail steps={rail} />
            <div style={{ flex: "1 1 auto" }} />
            {railNote}
          </div>
          {step === "analyzing" ? <AnalyzingPanel study={study} findings={findings} now={now} onStart={() => go("review")} /> : null}
          {step === "review" ? <ReviewPanel study={study} findings={findings} focusN={focusN} setFocusN={setFocusN} onContinue={() => go("sign")} /> : null}
          {step === "sign" ? <SignPanel study={study} findings={findings} onFocus={setFocusN} onBack={() => go("review")} onSigned={() => go("share")} /> : null}
          {step === "share" ? <SharePanel study={study} onBack={() => go("sign")} /> : null}
        </section>
      </div>
    </AppShell>
  );
}
