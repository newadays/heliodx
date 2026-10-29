import { afterEach, describe, expect, it, vi } from "vitest";

import { DictationUnavailable, transcribe, wavSeconds } from "../src/models/transcribe";
import { wav } from "./fixtures/wav";

describe("wavSeconds", () => {
  it("reads the duration of a PCM WAV and refuses anything else", () => {
    expect(wavSeconds(wav(32_000))).toBe(2);
    expect(wavSeconds(Buffer.from("not a wav file at all, just some text bytes here"))).toBeNull();
    const float = wav(10);
    float.writeUInt16LE(3, 20);
    expect(wavSeconds(float)).toBeNull();
  });
});

describe("transcribe", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts the request and audio parts to the hosted asr endpoint with the key, and returns the transcript", async () => {
    vi.stubEnv("META_API_KEY", "test-key");
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ transcript: "Small right plural effusion..", audioDurationMs: 1680, turns: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await transcribe(wav(16_000), fake);
    expect(out.transcript).toBe("Small right plural effusion.");
    expect(calls[0].url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const form = calls[0].init.body as FormData;
    expect(JSON.parse(await (form.get("request") as Blob).text())).toEqual({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
    expect((form.get("audio") as Blob).size).toBe(44 + 32_000);
    expect([...form.keys()].sort()).toEqual(["audio", "request"]);
  });

  it("maps a model error, a network error and an empty answer to DictationUnavailable", async () => {
    vi.stubEnv("META_API_KEY", "test-key");
    const status = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await expect(transcribe(wav(100), status)).rejects.toMatchObject({ reason: "http_503" });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(transcribe(wav(100), down)).rejects.toBeInstanceOf(DictationUnavailable);
    const empty = (async () => new Response(JSON.stringify({ transcript: "  " }), { status: 200 })) as unknown as typeof fetch;
    await expect(transcribe(wav(100), empty)).rejects.toMatchObject({ reason: "empty" });
  });
});
