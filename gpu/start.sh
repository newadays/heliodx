#!/usr/bin/env bash
# Starts the three processes of the HelioDX GPU service and exits if any of
# them dies, so Cloud Run replaces the instance.
#
#   1. SAM 3.1 server (127.0.0.1:8002), loaded first so vLLM sizes its KV
#      cache around SAM's memory.
#   2. vLLM serving Muse Glimmer (127.0.0.1:8001), weights streamed from
#      Cloud Storage.
#   3. Caddy on :8080, the only port Cloud Run sees.
set -euo pipefail

: "${GLIMMER_MODEL:?set GLIMMER_MODEL, e.g. gs://<weights-bucket>/glimmer}"
: "${GLIMMER_QUANTIZATION:=fp8_per_tensor}"   # online FP8, or "none" for bf16
# Off by default: in vLLM v0.32.0 the muse_glimmer reasoning parser cannot
# find its end-of-reasoning tokens, and structured output (our JSON schemas)
# waits for that marker, so schemas were never enforced. Set to
# "muse_glimmer" to retest (card B8).
: "${GLIMMER_REASONING_PARSER:=}"
: "${GLIMMER_MAX_MODEL_LEN:=32768}"
: "${GLIMMER_GPU_MEM_UTIL:=0.80}"         # leaves room for SAM 3.1
: "${GLIMMER_MAX_NUM_SEQS:=8}"

cd /app
python3 -m uvicorn sam_server:app --host 127.0.0.1 --port 8002 --log-level warning &

echo "start: waiting for SAM 3.1"
for _ in $(seq 1 180); do
  if python3 -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8002/sam/ready', timeout=2)" 2>/dev/null; then
    echo "start: SAM 3.1 ready"
    break
  fi
  sleep 2
done

QUANT_ARGS=()
if [ "$GLIMMER_QUANTIZATION" != "none" ]; then
  QUANT_ARGS=(--quantization "$GLIMMER_QUANTIZATION")
fi
REASONING_ARGS=()
if [ -n "$GLIMMER_REASONING_PARSER" ]; then
  REASONING_ARGS=(--reasoning-parser "$GLIMMER_REASONING_PARSER")
fi

vllm serve "$GLIMMER_MODEL" \
  --served-model-name glimmer \
  --load-format runai_streamer \
  --dtype bfloat16 \
  "${QUANT_ARGS[@]}" \
  --max-model-len "$GLIMMER_MAX_MODEL_LEN" \
  --max-num-seqs "$GLIMMER_MAX_NUM_SEQS" \
  --gpu-memory-utilization "$GLIMMER_GPU_MEM_UTIL" \
  --limit-mm-per-prompt '{"image": 1}' \
  --enable-prefix-caching \
  --enable-auto-tool-choice \
  --tool-call-parser muse_glimmer \
  "${REASONING_ARGS[@]}" \
  --host 127.0.0.1 --port 8001 &

caddy run --config /app/Caddyfile --adapter caddyfile &

# Any process exiting takes the instance down; Cloud Run starts a new one.
wait -n
echo "start: a process exited; stopping" >&2
exit 1
