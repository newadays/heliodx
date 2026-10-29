/**
 * B18 · Dictate an edit on the Sign step: a WAV clip in, a transcript out
 * (Muse Voice Transcribe, models/transcribe.ts). Only for the study's
 * clinician (or a sample's workspace member) while the report can still be
 * edited. Nothing is stored: the study gets one audit entry and one trace row
 * saying dictation was used and for how long, never the audio or the text.
 */
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { META_API_KEY, MODEL_MOCK, MODELS } from "../config";
import { asCaller, callerOf, canAct, type Caller } from "../lib/access";
import { traceEvent, traceScope } from "../lib/trace";
import { DictationUnavailable, MAX_SECONDS, MAX_WAV_BYTES, transcribe, wavSeconds } from "../models/transcribe";

export interface DictateRequest {
  studyId?: unknown;
  /** Base64 WAV: PCM16 mono, 16 kHz (the browser's recorder). */
  audio?: unknown;
}

/** The emulator's answer (MODEL_MOCK), so the flow works offline. */
export const MOCK_TRANSCRIPT = "Small right pleural effusion.";
const EDITABLE = new Set(["ready", "clinician_review"]);

export async function dictateCore(
  db: Firestore,
  caller: Caller,
  req: DictateRequest,
  deps: { transcribe?: typeof transcribe } = {},
): Promise<{ transcript: string }> {
  if (typeof req.studyId !== "string" || !req.studyId) throw new HttpsError("invalid-argument", "studyId is required.");
  if (typeof req.audio !== "string" || !req.audio) throw new HttpsError("invalid-argument", "audio is required.");
  const wav = Buffer.from(req.audio, "base64");
  if (wav.length > MAX_WAV_BYTES) throw new HttpsError("invalid-argument", `Dictation is limited to ${MAX_SECONDS} seconds.`);
  const seconds = wavSeconds(wav);
  if (seconds === null) throw new HttpsError("invalid-argument", "The recording isn't a WAV clip.");
  if (seconds > MAX_SECONDS + 1) throw new HttpsError("invalid-argument", `Dictation is limited to ${MAX_SECONDS} seconds.`);

  const { uid, orgId } = asCaller(caller);
  const ref = db.collection("studies").doc(req.studyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
  const study = snap.data() ?? {};
  if (!canAct(study, uid, orgId)) throw new HttpsError("permission-denied", "Only the clinician who owns this study can dictate into its report.");
  if (!EDITABLE.has(study.status)) throw new HttpsError("failed-precondition", "The report can no longer be edited.");

  return traceScope(ref, "dictation", async () => {
    const started = Date.now();
    try {
      let transcript: string;
      if (process.env.MODEL_MOCK_FAIL === "dictation") throw new DictationUnavailable("mock");
      if (MODEL_MOCK && !deps.transcribe) transcript = MOCK_TRANSCRIPT;
      else transcript = (await (deps.transcribe ?? transcribe)(wav)).transcript;
      const ms = Date.now() - started;
      traceEvent({ kind: "model", name: `${MODELS.dictation}.transcribe`, model: MODELS.dictation, route: "dictation", ms, ok: true, result: `${seconds.toFixed(1)} s transcribed` });
      await ref.collection("audit").add({ at: FieldValue.serverTimestamp(), actor: uid, action: "dictation_used", from: study.status, to: study.status, detail: { seconds: Math.round(seconds * 10) / 10 } });
      logger.info("dictate: transcribed", { studyId: ref.id, seconds: Math.round(seconds), ms });
      return { transcript };
    } catch (error) {
      if (!(error instanceof DictationUnavailable)) throw error;
      traceEvent({ kind: "model", name: `${MODELS.dictation}.transcribe`, model: MODELS.dictation, route: "dictation", ms: Date.now() - started, ok: false, result: `unavailable (${error.reason})` });
      logger.warn("dictate: unavailable", { studyId: ref.id, reason: error.reason });
      throw new HttpsError("unavailable", "Dictation is unavailable right now. Type your edit.", { error: "dictation_unavailable" });
    }
  });
}

export const dictate = onCall<DictateRequest, Promise<{ transcript: string }>>({ enforceAppCheck: false, secrets: [META_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return dictateCore(getFirestore(), callerOf(request.auth), request.data ?? {});
});
