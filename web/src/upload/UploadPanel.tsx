/**
 * §4.10 · Upload a study. Files are processed in the browser (decode, strip
 * identifiers, checks, burned-in text) and staged as de-identified PNGs;
 * "Start analysis" turns each ready file into a study. The person confirms
 * per file that it carries no identifiers and agrees to its use in the beta.
 */
import { deleteObject, ref, uploadBytesResumable, type UploadTask } from "firebase/storage";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Link } from "react-router-dom";

import { stagingPath } from "@/functions/src/lib/storagePaths";
import { AGE_TOP, CONTRIBUTION_TEXT, RESERVED_LABEL } from "@/functions/src/lib/uploads";

import { useAuth } from "~/auth/AuthContext";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { findDuplicate, startUpload } from "~/data/actions";
import { storage } from "~/firebase";

import { decodeFile, FileProblem, pixelHash, redact, thumbUrl, toPng, type Box, type Decoded } from "./process";
import { findText, TEXT_CHECK_TIMEOUT_MS, warmTextCheck, whereIs, withTimeout, type TextHit } from "./textCheck";

import "./upload.css";

const ACCEPT = ".dcm,.dicom,image/jpeg,image/png";

/** Per-file confirmation, recorded with the study (same text the server stores). */
export const CONTRIBUTION_LABEL = CONTRIBUTION_TEXT;

type Phase = "processing" | "text" | "attention" | "uploading" | "ready" | "failed";

interface Details {
  label: string;
  age: string;
  sex: "" | "F" | "M";
  view: "" | "PA" | "AP";
  indication: string;
}

interface Item {
  id: string;
  file: File;
  phase: Phase;
  step: string;
  decoded?: Decoded;
  thumb?: string;
  hash?: string;
  text: TextHit[];
  textKept: boolean;
  /** The text check couldn't run (engine didn't load or timed out): the person checks the edges. */
  textUnchecked?: boolean;
  redactions: Box[];
  overrides: string[];
  duplicate?: { id: string; caseId?: string } | null;
  progress: number;
  uploadId?: string;
  error?: string;
  details: Details;
  contribution: boolean;
}

export interface UploadPanelHandle {
  addFiles: (files: File[]) => void;
  /** Opens the panel's details on one queued file. */
  select: (id: string) => void;
}

/** A file still in the panel, for the worklist's "Your uploads" section (nothing exists on the server yet). */
export interface PendingUpload {
  id: string;
  label: string;
  fileName: string;
  thumb?: string;
  /** What the file is waiting for, in one line. */
  waiting: string;
  failed: boolean;
}

const FORMAT_LABEL = { dicom: "DICOM", jpeg: "JPEG", png: "PNG" } as const;

function newId(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function today(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** What still blocks this file, in one sentence; null when it can upload. */
function blocker(item: Item): string | null {
  if (item.text.length && !item.textKept && !item.redactions.length) return `Burned-in text found in the ${whereIs(item.text[0].box)}. Redact it or confirm it isn't identifying.`;
  const open = (item.decoded?.issues ?? []).filter((i) => !item.overrides.includes(i.key));
  if (open.length) return open[0].text;
  if (item.duplicate && !item.overrides.includes("duplicate")) return "This image is already in your worklist.";
  return null;
}

export function UploadPanel({
  open,
  onClose,
  onSample,
  onQueue,
  handle,
}: {
  open: boolean;
  onClose: () => void;
  onSample?: () => void;
  onQueue?: (pending: PendingUpload[]) => void;
  handle: Ref<UploadPanelHandle>;
}) {
  const { user, claims } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [deid, setDeid] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [starting, setStarting] = useState(false);
  const tasks = useRef(new Map<string, UploadTask>());
  const counter = useRef(0);

  const patch = useCallback((id: string, change: Partial<Item> | ((i: Item) => Partial<Item>)) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...(typeof change === "function" ? change(i) : change) } : i)));
  }, []);

  useEffect(() => {
    if (open) warmTextCheck();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (deid ? setDeid(null) : onClose());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, deid, onClose]);

  /** Upload the (possibly redacted) pixels to the private staging area. */
  const stage = useCallback(
    async (item: Item) => {
      if (!user || !claims.orgId || !item.decoded) return;
      const uploadId = newId();
      patch(item.id, { phase: "uploading", step: "uploading", progress: 0, uploadId });
      try {
        const blob = await toPng(item.decoded.canvas);
        const task = uploadBytesResumable(ref(storage, stagingPath(claims.orgId, user.uid, uploadId)), blob, { contentType: "image/png" });
        tasks.current.set(item.id, task);
        // No progress for 45 s: give up with a reason instead of spinning.
        let stalled = false;
        let watchdog = setTimeout(() => {
          stalled = true;
          task.cancel();
        }, 45_000);
        task.on("state_changed", (snap) => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            stalled = true;
            task.cancel();
          }, 45_000);
          patch(item.id, { progress: Math.round((100 * snap.bytesTransferred) / Math.max(1, snap.totalBytes)) });
        });
        try {
          await task;
        } catch (error) {
          if (stalled) throw Object.assign(new Error("upload stalled"), { code: "storage/stalled" });
          throw error;
        } finally {
          clearTimeout(watchdog);
        }
        tasks.current.delete(item.id);
        patch(item.id, { phase: "ready", step: "", progress: 100 });
      } catch (error) {
        tasks.current.delete(item.id);
        const code = (error as { code?: string }).code ?? "unknown";
        if (code === "storage/canceled") return;
        console.error("[upload] staging", code, error);
        patch(item.id, {
          phase: "failed",
          error:
            code === "storage/unauthorized"
              ? "The upload was refused (storage/unauthorized). Sign out and in again, then replace the file."
              : `The upload didn't finish (${code}). Check your connection and replace the file to try again.`,
        });
      }
    },
    [claims.orgId, patch, user],
  );

  /** With the latest decisions applied: upload once nothing blocks, else ask the person. */
  const proceed = useCallback(
    (item: Item) => {
      const why = blocker(item);
      // Keep whatever the person typed meanwhile (details, confirmation).
      const keep = (cur: Item) => ({ details: cur.details, contribution: cur.contribution });
      if (why) {
        patch(item.id, (cur) => ({ ...item, ...keep(cur), phase: item.text.length && !item.textKept && !item.redactions.length ? "text" : "attention" }));
        return;
      }
      patch(item.id, (cur) => ({ ...item, ...keep(cur) }));
      void stage(item);
    },
    [patch, stage],
  );

  const process = useCallback(
    async (item: Item) => {
      try {
        patch(item.id, { phase: "processing", step: "decoding" });
        const decoded = await decodeFile(item.file);
        const thumb = thumbUrl(decoded.canvas);
        const hints = decoded.hints;
        patch(item.id, (i) => ({
          decoded,
          thumb,
          step: "checking for text on the film",
          details: {
            ...i.details,
            age: i.details.age || (hints.age !== null ? String(Math.min(AGE_TOP, hints.age)) : ""),
            sex: i.details.sex || hints.sex || "",
            view: i.details.view || hints.view || "",
          },
        }));
        const hash = await pixelHash(decoded.canvas);
        const duplicate =
          claims.orgId && user
            ? await withTimeout(findDuplicate(claims.orgId, user.uid, hash), 10_000, "duplicate check").catch((error) => {
                console.error("[upload] duplicate check", error);
                return null;
              })
            : null;
        let text: TextHit[] = [];
        let textUnchecked = false;
        try {
          text = await withTimeout(findText(decoded.canvas), TEXT_CHECK_TIMEOUT_MS, "text check");
        } catch (error) {
          // The engine didn't load or hung: never block the file; the person
          // checks the edges themselves and still confirms there are no identifiers.
          console.error("[upload] text check", error);
          textUnchecked = true;
        }
        proceed({ ...item, decoded, thumb, hash, duplicate, text, textUnchecked, step: "" });
      } catch (error) {
        console.error("[upload] processing", error);
        patch(item.id, { phase: "failed", error: error instanceof FileProblem ? error.message : `This file couldn't be processed (${(error as Error)?.message ?? "unknown error"}).` });
      }
    },
    [proceed, claims.orgId, patch, user],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const fresh = files.slice(0, 20).map((file): Item => {
        counter.current += 1;
        return {
          id: newId(),
          file,
          phase: "processing",
          step: "decoding",
          text: [],
          textKept: false,
          redactions: [],
          overrides: [],
          progress: 0,
          details: { label: `Upload ${counter.current} · ${today()}`, age: "", sex: "", view: "", indication: "" },
          contribution: false,
        };
      });
      setItems((all) => [...all, ...fresh]);
      setSelected((s) => s ?? fresh[0]?.id ?? null);
      for (const item of fresh) void process(item);
    },
    [process],
  );

  useImperativeHandle(handle, () => ({ addFiles, select: (id: string) => setSelected(id) }), [addFiles]);

  useEffect(() => {
    onQueue?.(
      items.map((i) => ({
        id: i.id,
        label: i.details.label.trim() || i.file.name,
        fileName: i.file.name,
        thumb: i.thumb,
        failed: i.phase === "failed",
        waiting:
          i.phase === "processing"
            ? `${i.step || "checking"}…`
            : i.phase === "uploading"
              ? `uploading ${i.progress}%`
              : i.phase === "failed"
                ? (i.error ?? "Couldn't be processed")
                : i.phase === "ready"
                  ? i.contribution
                    ? "Ready · press Start analysis in the upload panel"
                    : "Waiting for your details · finish in the upload panel"
                  : (blocker(i) ?? "Needs your decision in the upload panel"),
      })),
    );
  }, [items, onQueue]);

  const remove = async (item: Item) => {
    tasks.current.get(item.id)?.cancel();
    tasks.current.delete(item.id);
    if (item.uploadId && user && claims.orgId && item.phase === "ready") await deleteObject(ref(storage, stagingPath(claims.orgId, user.uid, item.uploadId))).catch(() => undefined);
    setItems((all) => all.filter((i) => i.id !== item.id));
    if (selected === item.id) setSelected(null);
    if (deid === item.id) setDeid(null);
  };

  const replace = (item: Item, file: File | undefined) => {
    if (!file) return;
    tasks.current.get(item.id)?.cancel();
    const next: Item = { ...item, file, phase: "processing", step: "decoding", decoded: undefined, thumb: undefined, text: [], textKept: false, redactions: [], overrides: [], duplicate: null, progress: 0, uploadId: undefined, error: undefined };
    setItems((all) => all.map((i) => (i.id === item.id ? next : i)));
    void process(next);
  };

  const analyzeAnyway = (item: Item) => {
    const keys = [...(item.decoded?.issues ?? []).map((i) => i.key), ...(item.duplicate ? ["duplicate"] : [])];
    proceed({ ...item, overrides: [...new Set([...item.overrides, ...keys])] });
  };

  const ready = items.filter((i) => i.phase === "ready");
  const confirmed = ready.filter((i) => i.contribution && i.details.label.trim() && !RESERVED_LABEL.test(i.details.label));
  const unconfirmed = ready.length - confirmed.length;
  const busy = items.filter((i) => i.phase === "processing" || i.phase === "uploading").length;
  const sel = items.find((i) => i.id === selected) ?? items[0] ?? null;

  const start = async () => {
    if (!confirmed.length || confirmed.length !== ready.length) return;
    setStarting(true);
    let started = 0;
    for (const item of confirmed) {
      try {
        await startUpload({
          uploadId: item.uploadId!,
          details: {
            label: item.details.label.trim(),
            age: item.details.age === "" ? null : Number(item.details.age),
            sex: item.details.sex || null,
            view: item.details.view || null,
            indication: item.details.indication.trim(),
          },
          meta: {
            format: item.decoded!.format,
            removedTags: item.decoded!.removed.length + item.decoded!.privateTags,
            kept: item.decoded!.kept,
            redactions: item.redactions,
            textKept: item.textKept,
            overrides: item.overrides,
            pixelHash: item.hash ?? "",
            width: item.decoded!.width,
            height: item.decoded!.height,
          },
          contribution: true,
        });
        started++;
        setItems((all) => all.filter((i) => i.id !== item.id));
      } catch (error) {
        const code = (error as { code?: string }).code;
        console.error("[upload] start analysis", code, error);
        patch(item.id, {
          phase: "failed",
          error: code === "functions/resource-exhausted" ? "Hourly limit reached. Try again later." : `Couldn't start the analysis for this file (${(error as Error)?.message || code}).`,
        });
      }
    }
    setStarting(false);
    if (started) {
      toast({ message: `${started} stud${started === 1 ? "y" : "ies"} uploaded · analysis started` });
      setSelected(null);
      onClose();
    }
  };

  const deidItem = items.find((i) => i.id === deid) ?? null;

  return (
    <aside aria-label={deidItem ? "Upload a study — de-identification check" : "Upload a study"} className="up" hidden={!open}>
      {deidItem ? (
        <DeidView
          item={deidItem}
          onBack={() => setDeid(null)}
          onClose={onClose}
          onRemove={() => void remove(deidItem)}
          onKeep={() => {
            setDeid(null);
            proceed({ ...deidItem, textKept: true });
          }}
          onRedact={(boxes) => {
            if (deidItem.decoded) redact(deidItem.decoded.canvas, boxes);
            setDeid(null);
            proceed({ ...deidItem, redactions: boxes, thumb: deidItem.decoded ? thumbUrl(deidItem.decoded.canvas) : deidItem.thumb });
          }}
        />
      ) : (
        <>
          <div className="up__head">
            <h2>Upload a study</h2>
            {items.length ? <span className="chip chip-neutral">{items.length} file{items.length === 1 ? "" : "s"}</span> : null}
            <div style={{ flex: "1 1 auto" }} />
            <button type="button" className="ib ib-sm ib-flat" aria-label="Close upload panel" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>

          <div className="up__body">
            {!items.length ? (
              <>
                <div
                  className={`drop ${over ? "over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    addFiles([...e.dataTransfer.files]);
                  }}
                >
                  <span className="drop__icon">
                    <Icon name="upload" size={20} />
                  </span>
                  <div className="drop__text">
                    <span>Drop chest X-rays here</span>
                    <span className="muted">or</span>
                  </div>
                  <label className="btn btn-secondary filebtn">
                    <input type="file" multiple accept={ACCEPT} aria-label="Choose files to upload" onChange={(e) => addFiles([...(e.target.files ?? [])])} />
                    Choose files
                  </label>
                  <span className="muted drop__hint">JPEG, PNG or DICOM (.dcm) · up to 50 MB per file · several files at once</span>
                </div>

                <div className="up__points">
                  <span className="label">Before anything leaves your machine</span>
                  <div className="pt">
                    <span className="i">
                      <Icon name="shield" />
                    </span>
                    <span>
                      <strong>Personal information is removed in your browser</strong> — DICOM tags (name, ID, birth date, institution and the rest) and photo metadata are dropped; only the image pixels are uploaded.
                    </span>
                  </div>
                  <div className="pt">
                    <span className="i">
                      <Icon name="text" />
                    </span>
                    <span>
                      <strong>Burned-in text is checked</strong> — names, IDs or dates printed on the film are flagged so you can redact them before upload.
                    </span>
                  </div>
                  <div className="pt">
                    <span className="i">
                      <Icon name="play" />
                    </span>
                    <span>
                      <strong>You add the details</strong> — a pseudonym label, age, sex, view and indication. Analysis starts when you press Start analysis.
                    </span>
                  </div>
                </div>

                {onSample ? (
                  <>
                    <div className="up__or">
                      <span />
                      or
                      <span />
                    </div>
                    <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onSample}>
                      Add a sample from the NIH ChestX-ray14 set
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <label className="addmore">
                  <input type="file" multiple accept={ACCEPT} aria-label="Add more files" onChange={(e) => addFiles([...(e.target.files ?? [])])} />
                  <Icon name="upload" />
                  Add more files — or drop them here
                </label>
                <ul className="queue">
                  {items.map((item) => (
                    <QueueCard
                      key={item.id}
                      item={item}
                      selected={sel?.id === item.id}
                      onSelect={() => setSelected(item.id)}
                      onRemove={() => void remove(item)}
                      onReplace={(f) => replace(item, f)}
                      onAnyway={() => analyzeAnyway(item)}
                      onReview={() => setDeid(item.id)}
                    />
                  ))}
                </ul>
                {sel && sel.phase !== "failed" ? <DetailsCard item={sel} onChange={(d) => patch(sel.id, { details: { ...sel.details, ...d } })} onContribution={(v) => patch(sel.id, { contribution: v })} /> : null}
              </>
            )}

          </div>

          <div className="up__foot">
            <span className="muted up__foot-note">
              {items.length ? (
                <>
                  <strong>
                    {ready.length} of {items.length} ready.
                  </strong>{" "}
                  Files that need attention are skipped unless you choose Analyze anyway.
                </>
              ) : (
                "Research Beta — upload synthetic or fully de-identified images only."
              )}
            </span>
            <div className="up__actions">
              <div className="actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!ready.length || confirmed.length !== ready.length || starting}
                  aria-describedby="up-hint"
                  onClick={() => void start()}
                >
                  {starting ? <span className="spinner" aria-hidden="true" /> : null}
                  Start analysis{ready.length ? ` · ${ready.length}` : ""}
                </button>
              </div>
              <span id="up-hint" className="muted sg-hint">
                {!items.length
                  ? "Add at least one file to start"
                  : !ready.length
                    ? busy
                      ? `Checking ${busy} file${busy === 1 ? "" : "s"}…`
                      : "No file is ready — see the reasons above"
                    : confirmed.length !== ready.length
                      ? ready.some((i) => RESERVED_LABEL.test(i.details.label))
                        ? "A label starting “Sample Patient” is reserved: change it to continue"
                        : `Tick the research confirmation for ${unconfirmed} file${unconfirmed === 1 ? "" : "s"} (open each file below)`
                      : `${ready.length} ready to analyze`}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function QueueCard({
  item,
  selected,
  onSelect,
  onRemove,
  onReplace,
  onAnyway,
  onReview,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onReplace: (f: File | undefined) => void;
  onAnyway: () => void;
  onReview: () => void;
}) {
  const fmt = item.decoded ? FORMAT_LABEL[item.decoded.format] : "";
  const attention = item.phase === "attention" || item.phase === "text";
  const why = blocker(item);
  return (
    <li className={`q ${selected ? "sel" : ""} ${attention || item.phase === "failed" ? "bad" : ""}`}>
      <button type="button" className="q__select" aria-pressed={selected} aria-label={`Show details for ${item.file.name}`} onClick={onSelect}>
        {item.thumb ? <img className="q__t" src={item.thumb} alt="" style={item.phase === "uploading" ? { opacity: 0.55 } : undefined} /> : <span className="q__t" aria-hidden="true" />}
      </button>
      <div className="q__main">
        <div className="q__name">
          <span>{item.file.name}</span>
          <span className="muted">
            {mb(item.file.size)}
            {fmt ? ` · ${fmt}` : ""}
          </span>
        </div>
        {item.phase === "processing" ? (
          <span className="muted q__line">
            <span className="spinner" aria-hidden="true" style={{ width: 12, height: 12 }} /> {item.step}…
          </span>
        ) : null}
        {item.phase === "uploading" ? (
          <>
            <div className="qbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} aria-label="Upload progress">
              <span style={{ width: `${item.progress}%` }} />
            </div>
            <span className="muted q__line">
              {item.decoded?.format === "dicom" ? `${(item.decoded.removed.length + item.decoded.privateTags)} patient tags removed` : "metadata removed"}
              {item.redactions.length ? ` · ${item.redactions.length} area redacted` : ""} · uploading <span className="mono">{item.progress}%</span>
            </span>
          </>
        ) : null}
        {item.phase === "ready" ? (
          <div className="q__status">
            <span className="chip chip-ok">Ready</span>
            <span className="muted q__line">
              {[
                item.decoded?.format === "dicom" ? `${item.decoded.removed.length + item.decoded.privateTags} tags removed` : "metadata removed",
                item.redactions.length ? `${item.redactions.length} area redacted` : item.textKept ? "flagged text kept" : item.textUnchecked ? "text check unavailable — look at the film's edges yourself" : "no text on film",
                item.overrides.length ? `analyze anyway: ${item.overrides.join(", ")}` : "view checked during analysis",
              ].join(" · ")}
            </span>
          </div>
        ) : null}
        {attention ? (
          <>
            <div className="q__status">
              <span className="chip chip-warn">Needs attention</span>
              <span className="q__why">{why}</span>
            </div>
            <div className="q__actions">
              {item.phase === "text" ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onReview}>
                  Review and redact
                </button>
              ) : (
                <>
                  <label className="btn btn-ghost btn-sm filebtn">
                    <input type="file" accept={ACCEPT} aria-label={`Replace ${item.file.name}`} onChange={(e) => onReplace(e.target.files?.[0])} />
                    Replace file
                  </label>
                  {item.duplicate && !item.overrides.includes("duplicate") ? (
                    <Link className="btn btn-ghost btn-sm" to={`/study/${item.duplicate.caseId ?? item.duplicate.id}`}>
                      Open the existing study
                    </Link>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onAnyway}>
                    Analyze anyway
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
        {item.phase === "failed" ? (
          <>
            <div className="q__status">
              <span className="chip chip-warn">Failed</span>
              <span className="q__why">{item.error}</span>
            </div>
            <div className="q__actions">
              <label className="btn btn-ghost btn-sm filebtn">
                <input type="file" accept={ACCEPT} aria-label={`Replace ${item.file.name}`} onChange={(e) => onReplace(e.target.files?.[0])} />
                Replace file
              </label>
            </div>
          </>
        ) : null}
      </div>
      <button type="button" className="ib ib-sm ib-flat" aria-label={item.phase === "uploading" ? `Cancel ${item.file.name}` : `Remove ${item.file.name}`} onClick={onRemove}>
        <Icon name="close" />
      </button>
    </li>
  );
}

function DetailsCard({ item, onChange, onContribution }: { item: Item; onChange: (d: Partial<Details>) => void; onContribution: (v: boolean) => void }) {
  const detected = item.decoded?.hints.view;
  return (
    <div className="card up__details">
      <div className="up__details-head">
        <span className="label">Details · {item.file.name}</span>
        <span className="muted">Applies to this file only</span>
      </div>
      <label className="fl">
        Patient label
        <input
          type="text"
          value={item.details.label}
          maxLength={60}
          aria-invalid={RESERVED_LABEL.test(item.details.label)}
          aria-describedby={`lbl-${item.id}`}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        {RESERVED_LABEL.test(item.details.label) ? (
          <span className="inline-error" id={`lbl-${item.id}`}>
            Reserved for sample studies.
          </span>
        ) : (
          <span className="fl__hint" id={`lbl-${item.id}`}>
            A pseudonym for the worklist. Never a real name or ID.
          </span>
        )}
      </label>
      <div className="up__grid">
        <label className="fl">
          Age <span className="muted">(90 means 90 or over)</span>
          <input type="number" min={0} max={AGE_TOP} value={item.details.age} onChange={(e) => onChange({ age: e.target.value === "" ? "" : String(Math.min(AGE_TOP, Number(e.target.value))) })} />
        </label>
        <label className="fl">
          Sex
          <select value={item.details.sex} onChange={(e) => onChange({ sex: e.target.value as Details["sex"] })}>
            <option value="">Not recorded</option>
            <option value="F">F</option>
            <option value="M">M</option>
          </select>
        </label>
        <label className="fl">
          View
          <select value={item.details.view} onChange={(e) => onChange({ view: e.target.value as Details["view"] })}>
            <option value="">Auto-detect</option>
            <option value="PA">PA{detected === "PA" ? " · from the file" : ""}</option>
            <option value="AP">AP{detected === "AP" ? " · from the file" : ""}</option>
          </select>
        </label>
      </div>
      <label className="fl">
        Indication
        <textarea rows={2} maxLength={300} placeholder="e.g. Cough for two weeks." value={item.details.indication} onChange={(e) => onChange({ indication: e.target.value })} />
      </label>
      <label className="up__consent">
        <input type="checkbox" checked={item.contribution} onChange={(e) => onContribution(e.target.checked)} />
        {CONTRIBUTION_LABEL}
      </label>
    </div>
  );
}

function DeidView({
  item,
  onBack,
  onClose,
  onRemove,
  onKeep,
  onRedact,
}: {
  item: Item;
  onBack: () => void;
  onClose: () => void;
  onRemove: () => void;
  onKeep: () => void;
  onRedact: (boxes: Box[]) => void;
}) {
  const [boxes, setBoxes] = useState<Box[]>(() => item.text.map((t) => t.box));
  const [adjusting, setAdjusting] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: "move" | "resize"; x: number; y: number; start: Box } | null>(null);
  const d = item.decoded;

  useEffect(() => {
    if (!d) return;
    const scale = Math.min(1, 1200 / Math.max(d.width, d.height));
    const c = document.createElement("canvas");
    c.width = Math.round(d.width * scale);
    c.height = Math.round(d.height * scale);
    c.getContext("2d")!.drawImage(d.canvas, 0, 0, c.width, c.height);
    setPreview(c.toDataURL("image/jpeg", 0.85));
  }, [d]);

  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    const el = stage.current;
    if (!g || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - g.x) / r.width;
    const dy = (e.clientY - g.y) / r.height;
    setBoxes((all) =>
      all.map((b, i) => {
        if (i !== g.index) return b;
        if (g.mode === "move") return { ...b, x: Math.min(1 - b.w, Math.max(0, g.start.x + dx)), y: Math.min(1 - b.h, Math.max(0, g.start.y + dy)) };
        return { ...b, w: Math.min(1 - b.x, Math.max(0.02, g.start.w + dx)), h: Math.min(1 - b.y, Math.max(0.02, g.start.h + dy)) };
      }),
    );
  };

  const nudge = (index: number, e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = m[e.key];
    if (!v) return;
    e.preventDefault();
    setBoxes((all) => all.map((b, i) => (i !== index ? b : e.altKey ? { ...b, w: Math.max(0.02, b.w + v[0]), h: Math.max(0.02, b.h + v[1]) } : { ...b, x: Math.min(1 - b.w, Math.max(0, b.x + v[0])), y: Math.min(1 - b.h, Math.max(0, b.y + v[1])) })));
  };

  const removedShown = d?.removed.slice(0, 6) ?? [];
  const keptEntries = Object.entries(d?.kept ?? {});
  const KEPT_LABEL: Record<string, string> = { modality: "Modality", bodyPart: "Body part", viewPosition: "View position", imageSize: "Image size", pixelSpacing: "Pixel spacing", photometric: "Photometric" };
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <div className="up__head up__head--deid">
        <button type="button" className="ib ib-sm ib-flat" aria-label="Back to the upload queue" onClick={onBack}>
          <Icon name="arrowLeft" />
        </button>
        <h2>{item.file.name}</h2>
        <span className="chip chip-warn">Needs attention</span>
        <div style={{ flex: "1 1 auto" }} />
        <button type="button" className="ib ib-sm ib-flat" aria-label="Close upload panel" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="up__body">
        <div className="deid__film">
          <div
            ref={stage}
            className="deid__stage"
            style={{ aspectRatio: d ? `${d.width}/${d.height}` : "1" }}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            {preview ? <img src={preview} alt="Uploaded chest X-ray with the flagged text area outlined" /> : null}
            {boxes.map((b, i) => (
              <div key={i} className="flag" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                <span className={`ftag ${b.y < 0.06 ? "ftag--below" : ""}`}>Text detected</span>
                {adjusting ? (
                  <>
                    <button
                      type="button"
                      className="flag__move"
                      aria-label="Move the flagged area (arrow keys move, Alt+arrow resizes)"
                      onPointerDown={(e) => {
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        drag.current = { index: i, mode: "move", x: e.clientX, y: e.clientY, start: b };
                      }}
                      onKeyDown={(e) => nudge(i, e)}
                    />
                    <span
                      className="flag__handle"
                      aria-hidden="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        drag.current = { index: i, mode: "resize", x: e.clientX, y: e.clientY, start: b };
                      }}
                    />
                  </>
                ) : null}
              </div>
            ))}
          </div>
          <div className="deid__meta">
            <span>
              {d ? FORMAT_LABEL[d.format] : ""}
              {d?.kept.modality ? ` · ${d.kept.modality}` : ""}
            </span>
            {d ? <span className="mono">{`${d.width} × ${d.height}`}</span> : null}
            {d?.kept.viewPosition ? <span>{d.kept.viewPosition}</span> : null}
          </div>
        </div>

        <div className="deid__banner" role="alert">
          <span className="deid__icon">
            <Icon name="text" size={14} />
          </span>
          <div className="deid__banner-text">
            <p className="deid__title">Burned-in text found in the {item.text[0] ? whereIs(item.text[0].box) : "image"}.</p>
            <p>
              It may be a name, ID or date printed on the film{item.text[0]?.words.length ? ` (“${item.text.flatMap((t) => t.words).slice(0, 4).join(" ")}”)` : ""}. Redact it before analysis — the redacted image is what gets stored and analyzed; the original never leaves your machine.
            </p>
            <div className="deid__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onKeep}>
                Keep — it is not identifying
              </button>
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={adjusting} onClick={() => setAdjusting((v) => !v)}>
                {adjusting ? "Done adjusting" : "Adjust the area"}
              </button>
            </div>
          </div>
        </div>

        <div className="card deid__left">
          <div className="deid__left-head">
            <span className="label">What leaves your machine</span>
            <span className="chip chip-ok">
              <Icon name="check" size={12} />
              {d?.format === "dicom" ? "Tags removed in your browser" : "Metadata removed in your browser"}
            </span>
          </div>
          <div className="deid__cols">
            <div>
              <span className="deid__col-title">Removed · {d?.format === "dicom" ? d.removed.length + d.privateTags : "all metadata"}</span>
              {d?.format === "dicom" ? (
                <>
                  {(showAll ? d.removed : removedShown).map((t) => (
                    <div key={t} className="kv">
                      <span className="ok">
                        <Icon name="check" size={12} />
                      </span>
                      {t}
                    </div>
                  ))}
                  {d.privateTags ? (
                    <div className="kv">
                      <span className="ok">
                        <Icon name="check" size={12} />
                      </span>
                      {d.privateTags} private vendor tags
                    </div>
                  ) : null}
                  {d.removed.length > removedShown.length ? (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Show fewer" : `Show all ${d.removed.length}`}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="kv">
                  <span className="ok">
                    <Icon name="check" size={12} />
                  </span>
                  EXIF and camera data, location, file name
                </div>
              )}
            </div>
            <div>
              <span className="deid__col-title">Kept · {keptEntries.length}</span>
              {keptEntries.map(([k, v]) => (
                <div key={k} className="kv">
                  <span className="keep" />
                  {KEPT_LABEL[k] ?? k} · <span className="mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="muted deid__note">Only the image pixels are uploaded, as a PNG. The kept attributes travel as study fields.</p>
        </div>
      </div>
      <div className="up__foot">
        <span className="muted up__foot-note">Analysis will not start until the flagged area is redacted or confirmed.</span>
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={onRemove}>
            Remove file
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onRedact(boxes)}>
            <Icon name="shield" />
            Redact and continue
          </button>
        </div>
      </div>
    </>
  );
}
