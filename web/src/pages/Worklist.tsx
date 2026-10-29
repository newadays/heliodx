/**
 * Card W2 · Worklist (SPEC §4.2), with the W9 agent console side panel at
 * `?console=1`. §4.11: the clinician's uploads and the workspace's samples
 * sit in two sections (uploads first), told apart by tag, thumbnail frame,
 * wording and case-id prefix, never by colour; `?source=` filters them.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { Study } from "@/types/study";
import { initials, studyLine } from "@/utils/studySource";
import { useAuth } from "~/auth/AuthContext";
import { AppShell } from "~/components/AppShell";
import { ConsolePanel } from "~/components/ConsolePanel";
import { Icon } from "~/components/Icon";
import { SamplePicker } from "~/components/SamplePicker";
import { RowMenu, Segmented, SourceTag } from "~/components/Source";
import { useToast } from "~/components/Toast";
import { UploadPanel, type PendingUpload, type UploadPanelHandle } from "~/upload/UploadPanel";
import { deleteUpload, downloadDeidentified, resetSample, warmModels } from "~/data/actions";
import { useNow, useStorageUrl, useStudies } from "~/data/hooks";
import { analysisProgress, arrivedAt, caseIdOf, defaultStep, indicationOf, isSigned, patientOf, readOf, statusDetail, studyLabel, verdict, findingsOf, viewStatus, type ViewStatus } from "~/data/model";
import { hhmm } from "~/lib/format";
import { consolePath, studyPath } from "~/lib/paths";
import { readFlag, writeFlag } from "~/lib/storage";

import "./worklist.css";

type Tab = "all" | "ready" | "analyzing" | "signed";

const TABS: { key: Tab; label: string; match: (s: ViewStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "ready", label: "Ready to review", match: (s) => s === "draft_ready" || s === "in_review" },
  { key: "analyzing", label: "Analyzing", match: (s) => s === "analyzing" || s === "failed" },
  { key: "signed", label: "Signed", match: (s) => s === "signed" || s === "shared" },
];

const READY_RANK: Record<ViewStatus, number> = { draft_ready: 0, in_review: 0, analyzing: 1, failed: 1, signed: 2, shared: 2 };

const CONSOLE_KEY = "hx.console.open";

const DEMO_STEPS = ["Open a study", "Review the drafted findings", "Sign the report", "Share the plain-language note"];

type SourceFilter = "all" | "uploads" | "samples";

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "uploads", label: "Your uploads" },
  { value: "samples", label: "Samples" },
];

function Thumb({ study }: { study: Study }) {
  const url = useStorageUrl(study.image?.thumbPath ?? study.image?.storagePath);
  if (study.source === "sample") {
    // A dashed frame and a dimmed film: decorative, the tag carries the meaning.
    return <span className="thumb-sample" aria-hidden="true">{url ? <img src={url} alt="" loading="lazy" /> : <span />}</span>;
  }
  return url ? <img className="wl-thumb" src={url} alt="" loading="lazy" /> : <span className="wl-thumb" aria-hidden="true" />;
}

/** "47 F · by DC at 14:52 · U-7K2P" | "34 M · synthetic · S-AI2Y7". */
function MetaLine({ study }: { study: Study }) {
  const p = patientOf(study);
  const parts = study.source === "sample" ? [p.ageSex || null, "synthetic"] : [p.ageSex || null, `by ${initials(study.clinicianName)} at ${hhmm(arrivedAt(study))}`];
  return (
    <span className="muted wl-sub">
      {parts.filter(Boolean).join(" · ")} · <span className="mono">{caseIdOf(study)}</span>
    </span>
  );
}

/** B13 · The coordinator escalated this case to a human: say so under the status. B14 · The radiologist read, while unsigned. */
function StatusCell({ study, now }: { study: Study; now: number }) {
  const escalation = study.flags?.needsHuman ? study.coordinator?.escalation : null;
  const read = isSigned(study) ? null : readOf(study, now);
  return (
    <div className="wl-status-col">
      <StatusChip study={study} now={now} />
      {read && read.state !== "none" ? (
        <span className="wl-read muted">
          <Icon name={read.state === "signed" ? "check" : "clock"} size={12} />
          {read.state === "signed" ? "Radiologist read signed" : `Radiologist read · ${read.line.replace(/^Sent to /, "")}`}
        </span>
      ) : null}
      {escalation ? (
        <span className="wl-flag">
          <Icon name="flag" size={12} />
          Flagged by coordinator · {escalation.reason}
        </span>
      ) : null}
    </div>
  );
}

function StatusChip({ study, now }: { study: Study; now: number }) {
  const vs = viewStatus(study);
  const detail = statusDetail(study, now);
  if (vs === "analyzing") {
    const pct = analysisProgress(study);
    return (
      <div className="wl-status">
        <span className="chip chip-neutral">
          <span className="pulse" aria-hidden="true" />
          Analyzing
        </span>
        <div className="bar wl-bar is-live" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="muted wl-detail">{detail}</span>
      </div>
    );
  }
  if (vs === "failed") {
    return (
      <div className="wl-status">
        <span className="chip chip-warn">Needs attention</span>
        <span className="muted wl-detail">{detail}</span>
      </div>
    );
  }
  if (vs === "draft_ready" || vs === "in_review") {
    const v = verdict(findingsOf(study));
    return (
      <div className="wl-status">
        <span className={`chip ${v.attention ? "chip-warn" : "chip-ok"}`}>{vs === "in_review" ? "In review" : "Draft ready"}</span>
        <span className="muted wl-detail">{detail}</span>
      </div>
    );
  }
  return (
    <div className="wl-status">
      <span className="chip chip-ink">Signed</span>
      <span className="muted wl-detail">{detail}</span>
    </div>
  );
}

function Action({ study, primary }: { study: Study; primary: boolean }) {
  const vs = viewStatus(study);
  const step = defaultStep(study);
  const label = vs === "analyzing" ? "Watch" : vs === "failed" ? "Open" : vs === "draft_ready" ? "Review draft" : vs === "in_review" ? "Continue review" : "View";
  return (
    <Link className={`btn ${primary ? "btn-primary" : "btn-secondary"}`} to={studyPath(study, step)}>
      {label}
    </Link>
  );
}

export default function WorklistPage() {
  const { user, claims } = useAuth();
  const { data: studies, loading, error } = useStudies();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(1000);
  const tab = (params.get("tab") as Tab) || "all";
  const source = (["uploads", "samples"].includes(params.get("source") ?? "") ? params.get("source") : "all") as SourceFilter;
  const consoleOpen = params.get("console") === "1";
  const uploadOpen = params.get("upload") === "1";
  const uploader = useRef<UploadPanelHandle>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selectedId = params.get("case");
  const [sort, setSort] = useState<"newest" | "ready">("newest");
  const demoKey = `hx.guidedDemo.dismissed.${user?.uid ?? ""}`;
  const [demoHidden, setDemoHidden] = useState(() => readFlag(demoKey));
  const [picking, setPicking] = useState(false);
  const isDemo = claims.role === "demo";
  const closedRef = useRef(false);

  const setMany = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setParam = useCallback((key: string, value: string | null) => setMany({ [key]: value }), [setMany]);
  const openUpload = useCallback(() => setMany({ console: null, upload: "1" }), [setMany]);

  const sortRows = useCallback(
    (list: Study[]) => {
      const byNewest = [...list].sort((a, b) => (arrivedAt(b) ?? 0) - (arrivedAt(a) ?? 0));
      if (sort === "newest") return byNewest;
      return byNewest.sort((a, b) => READY_RANK[viewStatus(a)] - READY_RANK[viewStatus(b)]);
    },
    [sort],
  );
  // Uploads always above samples; Sort applies within each section.
  const uploads = useMemo(() => sortRows(studies.filter((s) => s.source !== "sample")), [studies, sortRows]);
  const samples = useMemo(() => sortRows(studies.filter((s) => s.source === "sample")), [studies, sortRows]);
  const visible = useMemo(() => [...(source !== "samples" ? uploads : []), ...(source !== "uploads" ? samples : [])], [uploads, samples, source]);
  const sorted = useMemo(() => [...uploads, ...samples], [uploads, samples]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, visible.filter((s) => t.match(viewStatus(s))).length])) as Record<Tab, number>, [visible]);
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const inTab = (list: Study[]) => list.filter((s) => current.match(viewStatus(s)));
  const uploadRows = inTab(uploads);
  const sampleRows = inTab(samples);
  const selected = studies.find((s) => s.id === selectedId) ?? sorted[0] ?? null;
  const firstReady = [...(source !== "samples" ? uploadRows : []), ...(source !== "uploads" ? sampleRows : [])].find((s) => viewStatus(s) === "draft_ready");
  // The guided demo always uses a sample, never an upload (§4.11).
  const demoSample = samples.find((s) => viewStatus(s) === "draft_ready") ?? null;
  const closeConsole = useCallback(() => {
    closedRef.current = true;
    setParam("console", null);
  }, [setParam]);

  // Start the private GPU as the worklist opens, so the next case doesn't wait
  // for a cold start (the server ignores repeats within a few minutes).
  useEffect(() => {
    void warmModels();
  }, []);

  // The panel stays open across a visit to a study and back (SPEC §4.8):
  // restored once as the worklist opens, never after the person switches it
  // off or opens the upload panel in its place.
  useEffect(() => {
    try {
      if (!params.has("console") && !uploadOpen && window.sessionStorage.getItem(CONSOLE_KEY) === "1") setParam("console", "1");
    } catch {
      // Not remembered; the URL still carries it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (consoleOpen) window.sessionStorage.setItem(CONSOLE_KEY, "1");
      else if (params.has("console") || closedRef.current || uploadOpen) window.sessionStorage.removeItem(CONSOLE_KEY);
    } catch {
      // Not remembered; the URL still carries it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoleOpen, uploadOpen]);

  const run = async (id: string, work: () => Promise<void>, done: string, failed: string) => {
    setBusy(id);
    try {
      await work();
      toast({ message: done });
    } catch (e) {
      console.error("[worklist]", e);
      toast({ message: failed });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const row = (s: Study) => {
    const p = patientOf(s);
    const sel = consoleOpen && selected?.id === s.id;
    const isUpload = s.source !== "sample";
    const vs = viewStatus(s);
    const menu = isUpload
      ? [
          { label: "Delete study", icon: "trash" as const, disabled: isSigned(s), hint: "Signed studies are kept for the audit trail", onSelect: () => setConfirming(s.id) },
          { label: "Download de-identified file", icon: "download" as const, onSelect: () => void downloadDeidentified(s.image.storagePath, caseIdOf(s)).catch(() => toast({ message: "Couldn't download the file. Try again." })) },
          { label: "Open in console", icon: "panel" as const, onSelect: () => navigate(consolePath(s)) },
        ]
      : [
          { label: "Reset sample", icon: "reset" as const, disabled: vs === "analyzing", hint: "Available once the draft is ready", onSelect: () => void run(s.id, () => resetSample(s.id), `${p.displayName} reset to its draft`, "Couldn't reset the sample. Try again.") },
          { label: "Open in console", icon: "panel" as const, onSelect: () => navigate(consolePath(s)) },
        ];
    return (
      <div
        key={s.id}
        role="row"
        className={`wl-row ${sel ? "sel" : ""} ${consoleOpen ? "wl-row--pick" : ""}`}
        aria-selected={consoleOpen ? sel : undefined}
        // With the console open, a click anywhere on the row shows that study
        // in it; the row's own buttons, links and menu keep their actions.
        // (Keyboard: the name button does the same.)
        onClick={
          consoleOpen
            ? (e) => {
                if ((e.target as Element).closest("button, a, input, [role='menu'], [role='group']")) return;
                setParam("case", s.id);
              }
            : undefined
        }
      >
        <span role="cell">
          <Thumb study={s} />
        </span>
        <div role="cell" className="wl-cell">
          <div className="wl-namerow">
            {consoleOpen ? (
              <button type="button" className="wl-name" aria-pressed={sel} onClick={() => setParam("case", s.id)}>
                {p.displayName}
              </button>
            ) : (
              <Link className="wl-name" to={studyPath(s, defaultStep(s))}>
                {p.displayName}
              </Link>
            )}
            <SourceTag study={s} />
          </div>
          <MetaLine study={s} />
        </div>
        <div role="cell" className="wl-cell">
          <span>{studyLabel({ ...s, view: null, studyType: "" })}</span>
          <span className="muted wl-sub">{studyLine(s)}</span>
        </div>
        <div role="cell" className="wl-ind">
          {indicationOf(s) || <span className="muted">—</span>}
        </div>
        <div role="cell">
          <StatusCell study={s} now={now} />
        </div>
        <div role="cell" className="mono wl-time">
          {hhmm(arrivedAt(s))}
        </div>
        <div role="cell">
          {confirming === s.id ? (
            <div className="wl-act wl-act--confirm" role="group" aria-label="Confirm delete">
              <p>Delete this upload and everything drafted from it?</p>
              <div className="actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(null)} disabled={busy === s.id}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy === s.id}
                  onClick={() => void run(s.id, () => deleteUpload(s.id), `${p.displayName} deleted`, "Couldn't delete the study. Try again.")}
                >
                  {busy === s.id ? <span className="spinner" aria-hidden="true" /> : null}
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="wl-act">
              <Action study={s} primary={s.id === firstReady?.id} />
              <RowMenu label={`More actions for ${p.displayName}`} items={menu} />
            </div>
          )}
        </div>
      </div>
    );
  };

  const head = (
    <div className="wl-row wl-row--head label" role="row">
      <span role="columnheader">
        <span className="sr-only">Image</span>
      </span>
      <span role="columnheader">Patient</span>
      <span role="columnheader">Study</span>
      <span role="columnheader">Indication</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Arrived</span>
      <span role="columnheader">
        <span className="sr-only">Action</span>
      </span>
    </div>
  );

  const pendingRows = tab === "all" || tab === "analyzing" ? pending : [];

  return (
    <AppShell crumbs={[{ label: "Worklist" }]}>
      <div
        className={`wl-layout ${consoleOpen || uploadOpen ? "with-console" : ""}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          openUpload();
          uploader.current?.addFiles([...e.dataTransfer.files]);
        }}
      >
        {dragging ? (
          <div className="wl-dropzone" aria-hidden="true">
            <span>Drop to upload</span>
          </div>
        ) : null}
        <main className="wl-main">
          <div className="wl-title">
            <div className="wl-title__text">
              <h1>Worklist</h1>
              <p className="muted">HelioDX drafts findings the moment a study arrives, so a draft is usually waiting when you open one. Nothing reaches a patient until you sign.</p>
            </div>
            <div className="wl-title__actions">
              <button
                type="button"
                className="btn btn-primary"
                aria-pressed={uploadOpen}
                onClick={() => {
                  setMany({ console: null, upload: uploadOpen ? null : "1" });
                }}
              >
                <Icon name="upload" />
                Upload study
              </button>
              {isDemo ? (
                <button type="button" className="btn btn-secondary" onClick={() => setPicking(true)}>
                  Add a sample
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                aria-pressed={consoleOpen}
                onClick={() => {
                  closedRef.current = consoleOpen;
                  setMany({ upload: null, console: consoleOpen ? null : "1" });
                }}
              >
                <Icon name={consoleOpen ? "panel" : "external"} />
                Agent console
              </button>
            </div>
          </div>

          {picking ? <SamplePicker onClose={() => setPicking(false)} /> : null}

          {!demoHidden && isDemo ? (
            <section className="card wl-demo" aria-label="Guided demo">
              <div className="wl-demo__lead">
                <span className="label">Guided demo</span>
                <span style={{ fontWeight: 600 }}>About 2 minutes · uses a sample</span>
              </div>
              <ol className="wl-demo__steps">
                {DEMO_STEPS.map((step, i) => (
                  <li key={step} className="demo-step">
                    <span className="n">{i + 1}</span>
                    {i > 0 ? (
                      step
                    ) : demoSample ? (
                      <Link to={studyPath(demoSample, defaultStep(demoSample))}>{step}</Link>
                    ) : samples.length ? (
                      <button
                        type="button"
                        className="linklike"
                        disabled={busy !== null}
                        onClick={() => void run(samples[samples.length - 1].id, () => resetSample(samples[samples.length - 1].id), "Sample reset · open it to start", "Couldn't reset the sample. Try again.")}
                      >
                        Reset a sample
                      </button>
                    ) : (
                      step
                    )}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Dismiss guided demo"
                style={{ minWidth: 44 }}
                onClick={() => {
                  writeFlag(demoKey, true);
                  setDemoHidden(true);
                }}
              >
                <Icon name="close" />
              </button>
            </section>
          ) : null}

          <div className="wl-filters">
            <nav aria-label="Filter" className="wl-tabs">
              {TABS.map((t) => (
                <button key={t.key} type="button" className={`tab ${t.key === tab ? "cur" : ""}`} aria-current={t.key === tab ? "page" : undefined} onClick={() => setParam("tab", t.key === "all" ? null : t.key)}>
                  {t.label} <span className="count">{counts[t.key]}</span>
                </button>
              ))}
            </nav>
            <div className="wl-filters__right">
              <Segmented label="Filter by source" value={source} options={SOURCE_OPTIONS} onChange={(v) => setParam("source", v === "all" ? null : v)} />
              <label className="wl-sort">
                <span>Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "ready")}>
                  <option value="newest">Newest first</option>
                  <option value="ready">Ready first</option>
                </select>
              </label>
            </div>
          </div>

          {error ? <p className="inline-error">Couldn&apos;t load the worklist. Check your connection; it reconnects on its own.</p> : null}

          {source !== "samples" ? (
            <section className="wl-sec" aria-label="Your uploads">
              <div className="sech">
                <h2>Your uploads</h2>
                <span className="count">{uploads.length + pending.length}</span>
                <span className="muted">De-identified in your browser · visible to you only · you can delete them</span>
                <span className="sech__gap" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={openUpload}>
                  Upload another
                </button>
              </div>
              {!loading && !uploads.length && !pending.length ? (
                <div className="wl-drop">
                  <span>
                    No uploads yet — drop a chest X-ray here or{" "}
                    <button type="button" onClick={openUpload}>
                      Upload study
                    </button>
                    .
                  </span>
                </div>
              ) : (
                <div className="wl-scroll">
                  <div className="card wl-table" role="table" aria-label="Your uploads" aria-busy={loading}>
                    {head}
                    {pendingRows.map((u) => (
                      <div key={u.id} role="row" className="wl-row wl-pending">
                        <span role="cell">{u.thumb ? <img className="wl-thumb" src={u.thumb} alt="" /> : <span className="wl-thumb" aria-hidden="true" />}</span>
                        <div role="cell" className="wl-cell">
                          <div className="wl-namerow">
                            <span className="wl-name">{u.label}</span>
                            <span className="src src-up">
                              <Icon name="upload" size={10} strokeWidth={2} />
                              Uploaded
                            </span>
                          </div>
                          <span className="muted wl-sub">{u.fileName} · not started</span>
                        </div>
                        <div role="cell" className="wl-cell">
                          <span>Chest X-ray</span>
                          <span className="muted wl-sub">In the upload panel</span>
                        </div>
                        <div role="cell" className="wl-ind">
                          <span className="muted">—</span>
                        </div>
                        <div role="cell">
                          <div className="wl-status">
                            <span className={`chip ${u.failed ? "chip-warn" : "chip-neutral"}`}>{u.failed ? "Upload failed" : "Not started"}</span>
                            <span className="muted wl-detail">{u.waiting}</span>
                          </div>
                        </div>
                        <div role="cell" className="mono wl-time">
                          —
                        </div>
                        <div role="cell">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              openUpload();
                              uploader.current?.select(u.id);
                            }}
                          >
                            Finish upload
                          </button>
                        </div>
                      </div>
                    ))}
                    {uploadRows.map(row)}
                    {!loading && uploads.length && !uploadRows.length && !pendingRows.length ? (
                      <div className="wl-empty" role="row">
                        <span role="cell">No uploads in this view.</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {source !== "uploads" ? (
            <section className="wl-sec" aria-label="Sample studies">
              <div className="sech">
                <h2>Sample studies</h2>
                <span className="count">{samples.length}</span>
                <span className="muted">NIH ChestX-ray14 films with synthetic patients · for the guided demo · reset any time</span>
                <span className="sech__gap" />
                {isDemo ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
                    Add a sample
                  </button>
                ) : null}
              </div>
              <div className="wl-scroll">
                <div className="card wl-table" role="table" aria-label="Sample studies" aria-busy={loading}>
                  {head}
                  {sampleRows.map((s) => (
                    <Fragment key={s.id}>{row(s)}</Fragment>
                  ))}
                  {!loading && !sampleRows.length ? (
                    <div className="wl-empty" role="row">
                      <span role="cell">
                        {samples.length ? "No samples in this view." : isDemo ? "No samples yet — use Add a sample." : "Sample studies are available in the demo workspace."}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <p className="muted wl-foot">
            Analysis runs on arrival and usually finishes within a minute once the private GPU is warm; the first case after a quiet spell waits a few minutes for it to start. Open a study at any time to watch it — you can read the findings as they land, and decisions open when the draft is complete.
          </p>
        </main>
        {consoleOpen ? <ConsolePanel studies={sorted} selected={selected} onSelect={(id) => setParam("case", id)} onClose={closeConsole} /> : null}
        <UploadPanel
          handle={uploader}
          open={uploadOpen && !consoleOpen}
          onClose={() => setParam("upload", null)}
          onQueue={setPending}
          onSample={
            isDemo
              ? () => {
                  setParam("upload", null);
                  setPicking(true);
                }
              : undefined
          }
        />
      </div>
    </AppShell>
  );
}
