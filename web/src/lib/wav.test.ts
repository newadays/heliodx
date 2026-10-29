import { describe, expect, it } from "vitest";

import { encodeWav, resample, toBase64 } from "./wav";

describe("dictation WAV", () => {
  it("writes a 44-byte PCM16 mono 16 kHz header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 8);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 16000, 16]);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });

  it("resamples 48 kHz to 16 kHz and base64-encodes", () => {
    const one = resample(new Float32Array(48_000).fill(0.5), 48_000);
    expect(one.length).toBe(16_000);
    expect(one[100]).toBeCloseTo(0.5);
    expect(toBase64(new Uint8Array([72, 105]))).toBe("SGk=");
  });
});
