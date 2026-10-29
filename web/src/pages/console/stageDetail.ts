/** Card W10 · The three columns of an expanded console row: inputs, output, measurements and overlays. */
import type { Study, TraceEntry } from "@/types/study";
import type { StageRow } from "~/data/timeline";
import { findingsOf, indicationOf, studyLabel, verdict } from "~/data/model";

export interface StageDetail {
  inputs: string[];
  output: { title: string; lines: string[]; ordered?: boolean };
  measurements: string[];
  overlays: string[];
}

const results = (calls: TraceEntry[], pred: (t: TraceEntry) => boolean) => calls.filter(pred).map((t) => `${t.name}: ${t.result ?? (t.ok ? "ok" : "failed")}`);

export function stageDetail(row: StageRow, study: Study): StageDetail {
  const calls = row.trace;
  const findings = findingsOf(study);
  const overlays = calls.filter((t) => t.overlayPath).map((t) => t.overlayPath!);
  const dims = study.image?.width ? `${study.image.width} × ${study.image.height}` : "size pending";
  switch (row.key) {
    case "received":
      return {
        inputs: [`Image ${dims}`, `Source: ${study.source}`, indicationOf(study) ? `Indication: ${indicationOf(study)}` : "No indication given"],
        output: { title: "Output", lines: ["Queued for analysis"] },
        measurements: [],
        overlays: [],
      };
    case "intake":
      return {
        inputs: [`Image ${dims}`, `Requested: ${studyLabel(study)}`],
        output: { title: "Output", lines: results(calls, (t) => t.kind !== "check" || t.name === "measure_quality") },
        measurements: results(calls, (t) => t.name === "measure_quality"),
        overlays,
      };
    case "triage":
      return {
        inputs: [`${(study.measurements ?? []).length} measurements from the lung outlines`, "Thresholds from the triage table"],
        output: { title: "Output", lines: [`Priority ${study.priority ?? study.triage?.priority ?? "—"}`, ...results(calls, (t) => t.name === "set_priority")] },
        measurements: calls.filter((t) => t.kind === "check" && t.name !== "set_priority").map((t) => t.result ?? t.name),
        overlays,
      };
    case "prep": {
      const bands = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.band]: (acc[f.band] ?? 0) + 1 }), {});
      return {
        inputs: [
          `Image ${dims}${study.pipeline?.quality?.ok ? ", quality pass from Intake" : ""}`,
          `${(study.pipeline as { masks?: unknown[] })?.masks?.length ?? 0} segmented regions (SAM 3.1)`,
          `${(study.measurements ?? []).length} triage measurements`,
          indicationOf(study) ? `Clinical context: ${indicationOf(study)}` : "No clinical context",
        ],
        output: { title: `Output · ${findings.length} observation${findings.length === 1 ? "" : "s"}`, lines: findings.map((f) => f.title), ordered: true },
        measurements: [
          ...findings.filter((f) => f.evidence !== f.title && /\d/.test(f.evidence)).map((f) => `${f.n} · ${f.evidence}`),
          `Overlays: ${(study.overlays ?? []).length ? "CTR lines" : "none"}${Object.keys((study.pipeline as { overlays?: Record<string, string> })?.overlays ?? {}).length ? ", lung masks" : ""}`,
          `Confidence: ${Object.entries(bands).map(([b, n]) => `${n} ${b}`).join(" · ") || "—"}`,
          verdict(findings).text,
        ],
        overlays,
      };
    }
    case "signed": {
      const n = (s: string) => findings.filter((f) => f.decision === s).length;
      return {
        inputs: [`${findings.length} drafted findings`, "The clinician's decisions and wording"],
        output: { title: "Output", lines: [`${n("accepted")} accepted · ${n("edited")} edited · ${n("rejected")} rejected`, study.signed ? `Signed by ${study.signed.name}` : "Not signed", study.signed ? `Report hash ${study.signed.reportHash.slice(0, 19)}…` : ""].filter(Boolean) },
        measurements: results(calls, () => true),
        overlays: [],
      };
    }
    case "summary":
      return {
        inputs: ["The signed report only (impression and recommendation)"],
        output: { title: "Output", lines: [study.patientSummary ? `${study.patientSummary.nextSteps?.length ?? 0} next steps` : "Not written yet", study.patientSummary?.readingGrade ? `Reading grade ${Math.round(study.patientSummary.readingGrade)}` : ""].filter(Boolean) },
        measurements: results(calls, (t) => t.kind !== "model"),
        overlays: [],
      };
    case "shared":
      return {
        inputs: ["The patient note, every step confirmed", "Consent recorded by the clinician"],
        output: { title: "Output", lines: (study.shares ?? []).map((s) => `${s.channel}${s.target ? ` · ${s.target}` : ""}${s.consent?.given ? " · consent recorded" : ""}`) },
        measurements: results(calls, () => true),
        overlays: [],
      };
    default:
      return { inputs: [], output: { title: "Output", lines: [] }, measurements: [], overlays };
  }
}
