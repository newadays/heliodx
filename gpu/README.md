# Private model service

Muse Glimmer 30B (vLLM) and SAM 3.1 in one Cloud Run service with one
NVIDIA RTX PRO 6000, in the EU. Only the Cloud Functions runtime
service account can call it. Images and clinical text never leave the
project.

| Path | Served by |
|---|---|
| `/v1/*` | vLLM, OpenAI-compatible, model name `glimmer` |
| `/sam/segment` | `sam_server.py`: text prompts in, masks (run-length encoded), boxes and scores out |
| `/health` | 200 only when both models are loaded |

## Run it

```sh
cp env.example.sh env.sh     # your project, region and bucket (gitignored)
./stage-weights.sh glimmer   # ~60 GB, Hugging Face -> your weights bucket (Cloud Build)
./stage-weights.sh sam       # SAM 3.1 is gated: accept the licence and store HF_TOKEN first
./deploy.sh                  # infra, image build, deploy, invoker grant
echo "GPU_URL=<printed url>" >> ../functions/.env.heliodx
```

`GLIMMER_QUANTIZATION=none ./deploy.sh` serves BF16 instead of FP8; `GLIMMER_REASONING_PARSER=muse_glimmer` turns Glimmer's reasoning parser back on (it currently stops JSON schemas being enforced) (slower,
for the quality comparison in card B8). `MIN_INSTANCES=1` keeps one GPU warm
for clinic hours or judging; the default 0 scales to zero and costs nothing
when idle, with a cold start of several minutes.

## Versions

| Part | Version |
|---|---|
| vLLM image | `vllm/vllm-openai:v0.32.0` |
| SAM 3 code | `facebookresearch/sam3@f1647e8` |
| Caddy | 2.11.7 |

Tests for the mask encoding: `python3 -m unittest test_samutil` (numpy only).
