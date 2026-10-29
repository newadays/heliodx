/**
 * B18 · Dictate into a report box on the Sign step: click to record, click
 * again (or 60 s) to stop; the clip goes to Muse Voice Transcribe and the
 * text lands at the cursor, for the clinician to edit and save. While
 * recording it says not to name the patient. When the transcriber is down
 * the button becomes "Type your edit" for the rest of the session.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { dictate, DictationUnavailable } from "~/data/actions";
import { MAX_DICTATION_S, startRecording, type Recording } from "~/lib/recorder";

// "Unavailable" is shared by every button for the session, so a failure isn't retried box by box.
let unavailable = false;
const listeners = new Set<() => void>();
function markUnavailable() {
  unavailable = true;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type State = "idle" | "starting" | "recording" | "transcribing";

export function DictateButton({ studyId, label, onText }: { studyId: string; label: string; onText: (text: string) => void }) {
  const off = useSyncExternalStore(subscribe, () => unavailable);
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recording | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (state !== "recording") return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [state]);
  // Leaving the page mid-recording releases the microphone.
  useEffect(() => () => rec.current?.cancel(), []);

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setState("transcribing");
    try {
      const clip = await r.stop();
      if (clip.seconds < 0.5) {
        toast({ message: "Nothing recorded. Hold the mic closer and try again." });
        return;
      }
      const text = await dictate(studyId, clip.wav);
      onText(text);
    } catch (error) {
      if (error instanceof DictationUnavailable) {
        markUnavailable();
        toast({ message: "Dictation is unavailable right now. Type your edit." });
      } else {
        console.error("[dictate] failed", error);
        toast({ message: "Couldn't transcribe that. Try again, or type your edit." });
      }
    } finally {
      setState("idle");
    }
  };

  const start = async () => {
    setState("starting");
    try {
      rec.current = await startRecording(() => void stop());
      startedAt.current = Date.now();
      setElapsed(0);
      setState("recording");
    } catch (error) {
      setState("idle");
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      toast({ message: blocked ? "Microphone blocked. Allow it in the browser, or type your edit." : "No microphone found. Type your edit." });
    }
  };

  if (off) return <span className="muted dict-off">Type your edit</span>;
  const recording = state === "recording";
  return (
    <span className="dict">
      <button
        type="button"
        className={`btn btn-ghost btn-sm dict-btn ${recording ? "is-recording" : ""}`}
        aria-pressed={recording}
        disabled={state === "starting" || state === "transcribing"}
        onClick={() => void (recording ? stop() : start())}
      >
        {state === "transcribing" ? <span className="spinner" aria-hidden="true" /> : recording ? <span className="dict-dot" aria-hidden="true" /> : <Icon name="mic" />}
        {state === "transcribing" ? "Transcribing…" : recording ? `Stop · ${elapsed}s / ${MAX_DICTATION_S}s` : `Dictate ${label}`}
      </button>
      {recording ? (
        <span className="muted dict-note" role="status">
          Don't say the patient's name. Audio goes to Muse Voice Transcribe and isn't kept.
        </span>
      ) : null}
    </span>
  );
}
