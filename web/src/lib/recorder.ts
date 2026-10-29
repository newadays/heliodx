/**
 * B18 · Records one dictation clip from the microphone: raw samples through
 * the Web Audio API (no codec, so no webm-to-WAV step), resampled to 16 kHz
 * mono PCM16 WAV at stop. Stops by itself at 60 s and always releases the
 * microphone. Nothing is written anywhere; the clip lives in memory until
 * it is sent.
 */
import { DICTATION_RATE, encodeWav, resample, toBase64 } from "./wav";

export const MAX_DICTATION_S = 60;

export interface Clip {
  /** Base64 WAV. */
  wav: string;
  seconds: number;
}

export interface Recording {
  stop(): Promise<Clip>;
  cancel(): void;
  /** Input level 0–1, for the meter. */
  level(): number;
}

/** Throws a DOMException "NotAllowedError" when the microphone is blocked. */
export async function startRecording(onAutoStop: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but works in every browser without a separate worklet module.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let samples = 0;
  let peak = 0;
  let done = false;
  proc.onaudioprocess = (e) => {
    if (done) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    samples += data.length;
    peak = data.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    if (samples >= MAX_DICTATION_S * ctx.sampleRate) onAutoStop();
  };
  source.connect(proc);
  proc.connect(ctx.destination);

  const release = () => {
    done = true;
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    level: () => peak,
    cancel: release,
    async stop() {
      const rate = ctx.sampleRate;
      release();
      const all = new Float32Array(Math.min(samples, MAX_DICTATION_S * rate));
      let off = 0;
      for (const c of chunks) {
        if (off >= all.length) break;
        all.set(c.subarray(0, all.length - off), off);
        off += c.length;
      }
      const pcm = resample(all, rate, DICTATION_RATE);
      return { wav: toBase64(encodeWav(pcm)), seconds: pcm.length / DICTATION_RATE };
    },
  };
}
