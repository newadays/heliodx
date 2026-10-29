/**
 * Card W5 · Review (SPEC §4.4, §5.3): verdict, Accept all normal, compact
 * accept / edit / reject per finding, inline wording edits, keyboard, and a
 * focused row linked to its marker on the film. Decisions are written with
 * the review hash, as in the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { Finding, FindingStatus, Study } from "@/types/study";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { saveFindings } from "~/data/actions";
import { bandBars, bandLabel, qualityWarnings, verdict, type FindingView } from "~/data/model";
import { isTyping } from "~/lib/keys";
import { MonoNumbers } from "~/lib/text";

function withoutEdit(f: Finding): Finding {
  const { editedText: _edit, ...rest } = f;
  void _edit;
  return rest;
}

function decided(d: FindingStatus): boolean {
  return d !== "pending";
}

function Row({
  f,
  focused,
  editing,
  disabled,
  onFocus,
  onDecide,
  onEdit,
  onSave,
  onCancel,
  rowRef,
}: {
  f: FindingView;
  focused: boolean;
  editing: boolean;
  disabled: boolean;
  onFocus: () => void;
  onDecide: (d: "accepted" | "rejected") => void;
  onEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const [text, setText] = useState(f.sentence);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setText(f.sentence);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, f.sentence]);

  if (editing) {
    return (
      <div ref={rowRef} className="rv-row editing focus" onMouseEnter={onFocus}>
        <span className="num">{f.n}</span>
        <div className="rv-edit">
          <div className="rv-edit__head">
            <span style={{ fontWeight: 600 }}>{f.title}</span>
            <span className="chip chip-neutral">Editing</span>
          </div>
          <label className="rv-edit__label">
            Wording in the report
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim()) onSave(text.trim());
                if (e.key === "Escape") onCancel();
              }}
            />
          </label>
          <div className="rv-edit__actions">
            <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} disabled={!text.trim() || disabled} onClick={() => onSave(text.trim())}>
              Save and accept
            </button>
            <button type="button" className="btn btn-ghost" style={{ minHeight: 40 }} onClick={onCancel}>
              Cancel
            </button>
            <span className="muted rv-note">
              {f.evidence !== f.sentence ? (
                <>
                  Measured <MonoNumbers text={f.evidence.replace(/^[A-Z][^0-9]*?(?=\d)/, "")} /> ·{" "}
                </>
              ) : null}
              your edit is recorded as yours
            </span>
          </div>
        </div>
      </div>
    );
  }

  const bars = bandBars(f.band);
  return (
    <div
      ref={rowRef}
      className={`rv-row ${focused ? "focus" : ""} ${f.decision === "rejected" ? "rejected" : ""} ${f.polarity === "attention" ? "attention" : ""}`}
      onMouseEnter={onFocus}
      onFocusCapture={onFocus}
    >
      <span className="num">{f.n}</span>
      <div className="rv-text">
        <span className="rv-title">
          {f.title}
          {f.decision === "edited" ? <span className="chip chip-neutral">Edited by you</span> : null}
        </span>
        <span className="muted rv-evidence">
          <MonoNumbers text={f.decision === "edited" && f.editedText ? f.editedText : f.evidence} />
        </span>
      </div>
      <div className="rv-conf">
        <span>
          {bandLabel(f.band)} · <span className="mono">{Math.round(f.confidence * 100)}%</span>
        </span>
        <div className="meter" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < bars ? "f" : ""} />
          ))}
        </div>
      </div>
      <div className="rv-actions">
        <button
          type="button"
          className="ib"
          aria-pressed={f.decision === "accepted" || f.decision === "edited"}
          aria-label={f.decision === "accepted" || f.decision === "edited" ? `Accepted finding ${f.n}; press to undo` : `Accept finding ${f.n}`}
          disabled={disabled}
          onClick={() => onDecide("accepted")}
        >
          <Icon name="check" />
        </button>
        <button type="button" className="ib" aria-label={`Edit finding ${f.n}`} disabled={disabled} onClick={onEdit}>
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="ib danger"
          aria-pressed={f.decision === "rejected"}
          aria-label={f.decision === "rejected" ? `Rejected finding ${f.n}; press to reopen` : `Reject finding ${f.n}`}
          disabled={disabled}
          onClick={() => onDecide("rejected")}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

export function ReviewPanel({
  study,
  findings,
  focusN,
  setFocusN,
  onContinue,
}: {
  study: Study;
  findings: FindingView[];
  focusN: number | null;
  setFocusN: (n: number | null) => void;
  onContinue: () => void;
}) {
  const toast = useToast();
  const [editingN, setEditingN] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const canDecide = study.status === "ready";
  const reviewed = findings.filter((f) => decided(f.decision)).length;
  const pending = findings.length - reviewed;
  const v = verdict(findings);
  const pendingNormal = findings.filter((f) => f.polarity === "normal" && f.decision === "pending");
  const grouped = v.attention > 0;
  const ordered = useMemo(
    () => (grouped ? [...findings.filter((f) => f.polarity === "attention"), ...findings.filter((f) => f.polarity === "normal")] : findings),
    [findings, grouped],
  );

  const write = useCallback(
    async (change: (f: Finding) => Finding) => {
      const next = [...(study.findings ?? [])].sort((a, b) => a.index - b.index).map(change);
      try {
        await saveFindings(study.id, next);
      } catch {
        toast({ message: "Couldn't save your decision. Check your connection.", action: { label: "Retry", onClick: () => void saveFindings(study.id, next) } });
      }
    },
    [study.findings, study.id, toast],
  );

  const decide = useCallback(
    (n: number, d: "accepted" | "rejected") =>
      void write((f) => {
        if (f.index + 1 !== n) return f;
        const accepted = f.status === "accepted" || f.status === "edited";
        // A second press undoes the decision (back to pending); an edit goes with it.
        if ((d === "accepted" && accepted) || (d === "rejected" && f.status === "rejected")) return { ...withoutEdit(f), status: "pending", reviewedAt: null };
        if (d === "accepted") return { ...f, status: "accepted", reviewedAt: new Date() };
        return { ...withoutEdit(f), status: "rejected", reviewedAt: new Date() };
      }),
    [write],
  );

  const saveEdit = (n: number, text: string) => {
    setEditingN(null);
    void write((f) => (f.index + 1 !== n ? f : text === f.description ? { ...withoutEdit(f), status: "accepted", reviewedAt: new Date() } : { ...f, status: "edited", editedText: text, reviewedAt: new Date() }));
  };

  const acceptAllNormal = useCallback(() => {
    const ns = new Set(pendingNormal.map((f) => f.n));
    if (!ns.size) return;
    void write((f) => (ns.has(f.index + 1) ? { ...f, status: "accepted", reviewedAt: new Date() } : f));
    toast({ message: `Accepted ${ns.size} normal finding${ns.size === 1 ? "" : "s"}.` });
  }, [pendingNormal, write, toast]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const idx = ordered.findIndex((f) => f.n === focusN);
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, idx < 0 ? 0 : idx + dir))];
      if (next) {
        setFocusN(next.n);
        rows.current.get(next.n)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    [ordered, focusN, setFocusN],
  );

  useEffect(() => {
    if (focusN === null && ordered[0]) setFocusN(ordered[0].n);
  }, [focusN, ordered, setFocusN]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") move(1);
      else if (k === "k") move(-1);
      else if (!canDecide || focusN === null) return;
      else if (e.key === "A") acceptAllNormal();
      else if (k === "a") decide(focusN, "accepted");
      else if (k === "r") decide(focusN, "rejected");
      else if (k === "e" || e.key === "Enter") setEditingN(focusN);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move, decide, acceptAllNormal, focusN, canDecide]);

  const continueToReport = () => {
    if (pending > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onContinue();
  };

  const renderRow = (f: FindingView) => (
    <Row
      key={f.id}
      f={f}
      focused={focusN === f.n}
      editing={editingN === f.n}
      disabled={!canDecide}
      onFocus={() => setFocusN(f.n)}
      onDecide={(d) => decide(f.n, d)}
      onEdit={() => {
        setFocusN(f.n);
        setEditingN(f.n);
      }}
      onSave={(text) => saveEdit(f.n, text)}
      onCancel={() => setEditingN(null)}
      rowRef={(el) => {
        if (el) rows.current.set(f.n, el);
        else rows.current.delete(f.n);
      }}
    />
  );

  return (
    <>
      <div className="panel__body">
        <div className="rv-head">
          <div className="rv-head__text">
            <h1>Review findings</h1>
            <div className="rv-verdict">
              <span className={`chip ${v.attention ? "chip-warn" : "chip-ok"}`}>{v.text}</span>
              <span className="muted">AI-drafted. Supports your judgment; not a diagnosis.</span>
            </div>
          </div>
          <div className="rv-progress">
            <span>
              <strong>
                {reviewed} of {findings.length}
              </strong>{" "}
              <span className="muted">reviewed</span>
            </span>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={findings.length} aria-valuenow={reviewed} aria-label="Findings reviewed">
              <span style={{ width: `${findings.length ? (100 * reviewed) / findings.length : 0}%` }} />
            </div>
          </div>
        </div>

        {qualityWarnings(study).length ? (
          <div className="rv-quality" role="note">
            <Icon name="info" size={14} />
            <span>
              <strong>Image quality notes</strong> (analysis continued; check the film yourself): {qualityWarnings(study).join(" · ")}
            </span>
          </div>
        ) : null}

        <div className="rv-toolbar">
          <button type="button" className="btn btn-secondary" disabled={!canDecide || !pendingNormal.length} onClick={acceptAllNormal}>
            <Icon name="checkAll" />
            {pendingNormal.length ? `Accept all ${pendingNormal.length} normal finding${pendingNormal.length === 1 ? "" : "s"}` : "No normal findings left to accept"}
          </button>
          <div className="rv-keys" aria-label="Keyboard shortcuts">
            <span>
              <span className="kbd">A</span> accept
            </span>
            <span>
              <span className="kbd">E</span> edit
            </span>
            <span>
              <span className="kbd">R</span> reject
            </span>
            <span>
              <span className="kbd">J</span>
              <span className="kbd">K</span> next / previous
            </span>
          </div>
        </div>

        {!canDecide ? <p className="muted rv-wait">Decisions open when the draft is complete. You can read the findings already detected.</p> : null}

        {grouped ? (
          <>
            <span className="label">Needs attention</span>
            <div className="rv-list">{ordered.filter((f) => f.polarity === "attention").map(renderRow)}</div>
            <span className="label">Within normal limits</span>
            <div className="rv-list">{ordered.filter((f) => f.polarity === "normal").map(renderRow)}</div>
          </>
        ) : (
          <div className="rv-list">{ordered.map(renderRow)}</div>
        )}
      </div>

      <footer className="panel__foot">
        {confirming && pending > 0 ? (
          <div className="rv-confirm" role="alert">
            <span>
              {pending} finding{pending === 1 ? " has" : "s have"} no decision. Continue and leave {pending === 1 ? "it" : "them"} out of the report?
            </span>
            <div className="actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button type="button" className="btn btn-primary" onClick={onContinue}>
                Continue
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="muted hint">The report drafts itself as soon as every finding has a decision — no waiting at the next step.</span>
            <div className="actions">
              <Link className="btn btn-ghost" to="/worklist">
                Save and return later
              </Link>
              <button type="button" className="btn btn-primary" disabled={!canDecide} onClick={continueToReport}>
                Continue to report
                <Icon name="chevronRight" />
              </button>
            </div>
          </>
        )}
      </footer>
    </>
  );
}
