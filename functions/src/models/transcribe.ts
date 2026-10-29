/**
 * B18 · Dictation: one WAV clip to Muse Voice Transcribe on the hosted Meta
 * Model API (route `dictation`: audio only, no context, no image). The one
 * hosted call that carries clinical content, so the audio is passed straight
 * through: never written to disk, Storage or logs, and the transcript goes
 * back only to the caller. Logs carry sizes and timings only.
 *
 * Format verified on our key (2026-10-29): `POST {base}/asr/transcribe`,
 * multipart with a JSON `request` part ({ model, audioEncoding: "WAV" }) and
 * an `audio` part; the answer is { transcript, audioDurationMs, turns }.
 */
import { logger } from "firebase-functions/v2";

import { GPU_URL, META_API_KEY, MODEL_API_BASE } from "../config";
import { assertPayloadAllowed, resolveRoute } from "./routes";

export const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** 60 s of 16 kHz mono PCM16 is 1.92 MB; a little room for the header. */
export const MAX_WAV_BYTES = 2_000_000;
export const MAX_SECONDS = 60;
export const MAX_TRANSCRIPT = 1_000;

export class DictationUnavailable extends Error {
  constructor(readonly reason: string) {
    super(`Dictation unavailable: ${reason}`);
    this.name = "DictationUnavailable";
  }
}

/** A RIFF/WAVE PCM clip; returns its duration in seconds, or null when it isn't one. */
export function wavSeconds(wav: Buffer): number | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  // Walk the chunks for fmt and data (a browser writes 44 bytes; other encoders add chunks).
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") {
      if (wav.readUInt16LE(off + 8) !== 1) return null; // PCM only
      byteRate = wav.readUInt32LE(off + 16);
    } else if (id === "data") {
      return byteRate ? Math.min(size, wav.length - off - 8) / byteRate : null;
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

export async function transcribe(wav: Buffer, fetchImpl: typeof fetch = fetch): Promise<{ transcript: string; ms: number }> {
  assertPayloadAllowed("dictation", { audio: wav });
  const target = resolveRoute("dictation", { gpuUrl: GPU_URL.value(), hostedBase: MODEL_API_BASE }, "ready");
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: target.model, audioEncoding: "WAV" })], { type: "application/json" }));
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "dictation.wav");
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(`${target.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${META_API_KEY.value()}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new DictationUnavailable(timedOut ? "timeout" : "network");
  }
  const ms = Date.now() - started;
  // The error body may echo the request; it is never read or logged.
  if (!res.ok) {
    logger.warn("dictation: model error", { status: res.status, ms });
    throw new DictationUnavailable(`http_${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { transcript?: unknown } | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.replace(/\s+/g, " ").replace(/\.{2,}$/, ".").trim().slice(0, MAX_TRANSCRIPT) : "";
  if (!transcript) throw new DictationUnavailable("empty");
  return { transcript, ms };
}
