/**
 * Card W3 · The film viewer (SPEC §4.0): the whole film (`object-fit:
 * contain` in a box of the film's own aspect ratio, never cropped), numbered
 * markers per region, the focused finding's spotlight, the CTR measurement
 * lines, and Markers / Measurements / Fit / 1:1 / Invert toggles.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Study } from "@/types/study";
import { RowMenu, SourceTag } from "~/components/Source";
import { useToast } from "~/components/Toast";
import { deleteUpload, downloadDeidentified } from "~/data/actions";
import { useStorageUrl } from "~/data/hooks";
import { caseIdOf, isSigned, patientOf, studyLabel, type FindingView } from "~/data/model";

export type ViewerMode = "analyzing" | "review" | "sign";

export function Viewer({
  study,
  findings,
  mode,
  focusN,
  onFocus,
  status,
  scanning = false,
}: {
  study: Study;
  findings: FindingView[];
  mode: ViewerMode;
  focusN: number | null;
  onFocus?: (n: number) => void;
  status: React.ReactNode;
  scanning?: boolean;
}) {
  const url = useStorageUrl(study.image?.storagePath);
  const [markers, setMarkers] = useState(true);
  const [measurements, setMeasurements] = useState(true);
  const [actual, setActual] = useState(false);
  const [invert, setInvert] = useState(false);
  const p = patientOf(study);
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isUpload = study.source === "upload";
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteUpload(study.id);
      toast({ message: `${p.displayName} deleted` });
      navigate("/worklist");
    } catch {
      setDeleting(false);
      toast({ message: "Couldn't delete the study. Try again." });
    }
  };
  const w = study.image?.width || 1024;
  const h = study.image?.height || 1024;
  const showMarkers = mode !== "analyzing" && markers;
  const showLines = mode !== "analyzing" && measurements;
  const focused = findings.find((f) => f.n === focusN) ?? null;
  const lines = (study.overlays ?? []).filter((o) => o.kind === "line");

  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => (
    <button type="button" className="btn btn-dark" aria-pressed={on} onClick={() => set(!on)}>
      {label}
    </button>
  );

  return (
    <section className="viewer" aria-label="Image viewer">
      <div className="viewer__bar">
        <strong className="viewer__name">{p.displayName}</strong>
        <SourceTag study={study} />
        <span className="viewer__meta">
          {[p.ageSex, studyLabel(study)].filter(Boolean).join(" · ")} · <span className="mono">{caseIdOf(study)}</span>
        </span>
        <div style={{ flex: "1 1 auto" }} />
        <div className="viewer__tools">
          {mode !== "analyzing" ? toggle("Markers", markers, setMarkers) : null}
          {mode !== "analyzing" && lines.length ? toggle("Measurements", measurements, setMeasurements) : null}
          <button type="button" className="btn btn-dark" aria-pressed={!actual} onClick={() => setActual(false)}>
            Fit
          </button>
          <button type="button" className="btn btn-dark" aria-pressed={actual} onClick={() => setActual(true)}>
            1:1
          </button>
          {toggle("Invert", invert, setInvert)}
          {isUpload ? (
            <RowMenu
              label="More actions for this study"
              items={[
                { label: "Delete study", icon: "trash", disabled: isSigned(study), hint: "Signed studies are kept for the audit trail", onSelect: () => setConfirmDelete(true) },
                { label: "Download de-identified file", icon: "download", onSelect: () => void downloadDeidentified(study.image.storagePath, caseIdOf(study)).catch(() => toast({ message: "Couldn't download the file. Try again." })) },
              ]}
            />
          ) : null}
        </div>
      </div>
      {confirmDelete ? (
        <div className="viewer__confirm" role="group" aria-label="Confirm delete">
          <span>Delete this upload and everything drafted from it?</span>
          <button type="button" className="btn btn-dark btn-sm" disabled={deleting} onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={deleting} onClick={() => void remove()}>
            {deleting ? <span className="spinner" aria-hidden="true" /> : null}
            Delete
          </button>
        </div>
      ) : null}
      <div className={`viewer__stage ${actual ? "is-actual" : ""}`}>
        <div className="film" style={{ aspectRatio: `${w}/${h}`, ...(actual ? { width: w, maxWidth: "none" } : {}) }}>
          {url ? (
            <img
              src={url}
              alt={`${studyLabel(study)}, ${p.displayName}${showMarkers && findings.length ? `, with ${findings.length} numbered finding markers` : ""}`}
              style={invert ? { filter: "invert(1)" } : undefined}
            />
          ) : (
            <span className="film__placeholder" aria-hidden="true" />
          )}
          {scanning ? <div className="scan" aria-hidden="true" /> : null}
          {showMarkers && focused?.spot ? (
            <div
              className="spot"
              aria-hidden="true"
              style={{ left: `${focused.spot.x}%`, top: `${focused.spot.y}%`, width: `${focused.spot.w}%`, height: `${focused.spot.h}%` }}
            />
          ) : null}
          {showLines
            ? lines.map((l, i) => {
                const left = Math.min(l.from.x, l.to.x) * 100;
                const width = Math.abs(l.to.x - l.from.x) * 100;
                const below = i % 2 === 1;
                return (
                  <div key={l.label} aria-hidden="true">
                    <div className="mline" style={{ left: `${left}%`, top: `${l.from.y * 100}%`, width: `${width}%` }} />
                    <div className="ltag" style={{ left: `${left + width / 2}%`, top: `${l.from.y * 100 + (below ? 1.5 : -1)}%`, ...(below ? { transform: "translate(-50%,0)" } : {}) }}>
                      {l.label}
                    </div>
                  </div>
                );
              })
            : null}
          {showMarkers
            ? findings.flatMap((f) =>
                f.regions.map((r, i) => (
                  <button
                    key={`${f.n}-${i}`}
                    type="button"
                    className={`marker ${focusN === f.n ? "focus" : ""} ${f.decision === "rejected" ? "rejected" : ""}`}
                    style={{ left: `${r.x}%`, top: `${r.y}%` }}
                    aria-label={`Finding ${f.n}, ${r.label ?? f.title}${focusN === f.n ? ", selected" : ""}`}
                    onClick={() => onFocus?.(f.n)}
                  >
                    {f.n}
                  </button>
                )),
              )
            : null}
        </div>
      </div>
      <div className="viewer__status">{status}</div>
    </section>
  );
}
