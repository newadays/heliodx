"""Client-side TTFT / inter-token latency benchmark for the warm GPU service.

Streams /v1/chat/completions and timestamps every SSE chunk. Output length is
fixed (min_tokens = max_tokens, ignore_eos) so runs are comparable. A random
nonce at the start of each prompt defeats vLLM prefix caching.

  URL=<service url> TOKEN=$(gcloud auth print-identity-token) \
    python3 -I gpu/bench_latency.py out.json data/out/samples/*.jpg
"""
import base64, json, os, random, statistics, sys, threading, time, http.client, urllib.parse

URL = urllib.parse.urlparse(os.environ["URL"])
TOKEN = os.environ["TOKEN"]
OUT = sys.argv[1]
IMAGES = [base64.b64encode(open(p, "rb").read()).decode() for p in sys.argv[2:]]

FILLER = ("The clinician reviews each drafted finding, edits wording where needed and signs "
          "the report; the patient receives a plain-language note only. ") * 6
IMAGE_PROMPT = ("Describe the visible findings on this chest X-ray as short radiology phrases, "
                "one per line, then a one-paragraph impression.")


def conn():
    return http.client.HTTPSConnection(URL.netloc, timeout=600)


def one(c, kind, out_tokens):
    nonce = f"[run {random.getrandbits(64):x}] "
    if kind == "text":
        content = nonce + FILLER + "Summarise the workflow above in plain words."
    else:
        img = random.choice(IMAGES)
        content = [{"type": "text", "text": nonce + IMAGE_PROMPT},
                   {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}}]
    body = json.dumps({
        "model": "glimmer", "stream": True, "temperature": 0.2,
        "max_tokens": out_tokens, "min_tokens": out_tokens, "ignore_eos": True,
        "stream_options": {"include_usage": True, "continuous_usage_stats": True},
        "messages": [{"role": "user", "content": content}],
    })
    t0 = time.perf_counter()
    c.request("POST", "/v1/chat/completions", body, {
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    r = c.getresponse()
    if r.status != 200:
        raise RuntimeError(f"HTTP {r.status}: {r.read()[:300]!r}")
    stamps, toks, usage = [], [], None   # time and cumulative completion tokens per token-bearing chunk
    for raw in r:
        line = raw.strip()
        if not line.startswith(b"data:"):
            continue
        data = line[5:].strip()
        if data == b"[DONE]":
            r.read()  # drain the chunked terminator so the connection can be reused
            break
        ev = json.loads(data)
        if ev.get("usage"):
            usage = ev["usage"]
        ch = ev.get("choices") or []
        if ch and ((ch[0].get("delta") or {}).get("content") or (ch[0].get("delta") or {}).get("reasoning_content")):
            stamps.append(time.perf_counter())
            toks.append((usage or {}).get("completion_tokens", len(stamps)))
    t1 = time.perf_counter()
    n = (usage or {}).get("completion_tokens", len(stamps))
    # Gap per token: a chunk carrying k tokens counts as k equal gaps.
    gaps = []
    for i in range(1, len(stamps)):
        k = max(1, toks[i] - toks[i - 1])
        gaps += [(stamps[i] - stamps[i - 1]) / k] * k
    return {
        "kind": kind, "ttft": stamps[0] - t0, "e2e": t1 - t0, "out": n,
        "in": (usage or {}).get("prompt_tokens"),
        "tpot": (t1 - stamps[0]) / max(1, n - 1), "gaps": gaps,
    }


def run(kind, out_tokens, concurrency, n):
    results, lock = [], threading.Lock()
    todo = list(range(n))

    def worker():
        c = conn()
        while True:
            with lock:
                if not todo:
                    return
                todo.pop()
            res = one(c, kind, out_tokens)
            with lock:
                results.append(res)

    ts = [threading.Thread(target=worker) for _ in range(concurrency)]
    t0 = time.perf_counter()
    for t in ts: t.start()
    for t in ts: t.join()
    return results, time.perf_counter() - t0


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))]


def summary(name, res, wall, conc):
    ttft = [r["ttft"] * 1000 for r in res]
    gaps = [g * 1000 for r in res for g in r["gaps"]]
    tpot = [r["tpot"] * 1000 for r in res]
    out_tok = sum(r["out"] for r in res)
    return {
        "scenario": name, "concurrency": conc, "requests": len(res),
        "prompt_tokens": round(statistics.mean(r["in"] for r in res if r["in"])),
        "output_tokens": res[0]["out"],
        "ttft_ms": {p: round(pct(ttft, p)) for p in (50, 90, 99)} | {"mean": round(statistics.mean(ttft))},
        "itl_ms": {p: round(pct(gaps, p), 1) for p in (50, 90, 99)} | {"mean": round(statistics.mean(gaps), 1)},
        "tpot_ms": round(statistics.mean(tpot), 1),
        "per_request_tok_s": round(1000 / statistics.mean(tpot), 1),
        "aggregate_tok_s": round(out_tok / wall, 1),
        "e2e_s_p50": round(pct([r["e2e"] for r in res], 50), 2),
    }


if __name__ == "__main__":
    # Network floor: round trip to the proxy's /health on a warm connection.
    c = conn(); rtt = []
    for _ in range(6):
        t = time.perf_counter(); c.request("GET", "/health", headers={"Authorization": f"Bearer {TOKEN}"})
        c.getresponse().read(); rtt.append((time.perf_counter() - t) * 1000)
    print(f"health RTT p50 {statistics.median(rtt[1:]):.0f} ms", flush=True)

    run("image", 32, 1, 2)   # warm-up, discarded
    report = {"health_rtt_ms_p50": round(statistics.median(rtt[1:])), "runs": []}
    for name, kind, out, conc, n in [
        ("text, 1 user", "text", 256, 1, 10),
        ("X-ray + prompt, 1 user", "image", 256, 1, 10),
        ("X-ray + prompt, 4 users", "image", 256, 4, 16),
        ("X-ray + prompt, 8 users", "image", 256, 8, 24),
    ]:
        res, wall = run(kind, out, conc, n)
        s = summary(name, res, wall, conc)
        report["runs"].append(s)
        print(json.dumps(s), flush=True)
    json.dump(report, open(OUT, "w"), indent=2)
