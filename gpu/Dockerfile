# HelioDX private model service: Muse Glimmer 30B on vLLM + SAM 3.1, behind
# Caddy on :8080. Runs on Cloud Run with one RTX PRO 6000 in the EU.
# Weights are not baked in: Glimmer streams from Cloud Storage and SAM 3.1
# reads from a read-only Cloud Storage volume (see deploy.sh).

# vLLM v0.32.0 (2026-10-18) registers MuseGlimmerForConditionalGeneration and
# the muse_glimmer tool-call and reasoning parsers.
ARG VLLM_IMAGE=vllm/vllm-openai:v0.32.0
FROM ${VLLM_IMAGE}

# SAM 3 code pinned to a commit with SAM 3.1 checkpoint support.
ARG SAM3_COMMIT=f1647e8d0c1d280991f4d1b7d974c2704537fe66
ARG CADDY_VERSION=2.11.7

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1

# SAM 3 and the five packages it needs that the vLLM image lacks (found by an
# import probe inside vllm/vllm-openai:v0.32.0: ftfy, wcwidth, iopath,
# portalocker, pycocotools; timm, fastapi, uvicorn, pillow and the Run:ai
# streamer with GCS support are already there). Installed with --no-deps so
# nothing vLLM was built against changes: the image deliberately pairs torch
# 2.13 with NCCL 2.30.7, and any dependency resolution would downgrade NCCL.
# SAM 3 comes from GitHub's archive of the pinned commit (no git in the image).
RUN pip install --no-cache-dir --no-deps \
      "https://github.com/facebookresearch/sam3/archive/${SAM3_COMMIT}.tar.gz" \
      "ftfy==6.1.1" wcwidth "iopath>=0.1.10" portalocker pycocotools

RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin caddy \
 && caddy version

WORKDIR /app
COPY samutil.py sam_server.py Caddyfile start.sh /app/
RUN chmod +x /app/start.sh \
 && python3 -c "import sam3, samutil, numpy; from sam3.model_builder import build_sam3_image_model; import torch, runai_model_streamer_gcs, ftfy, iopath, pycocotools; import importlib.metadata as md; print('sam3 import ok, numpy', numpy.__version__, 'torch', torch.__version__, 'nccl', md.version('nvidia-nccl-cu13'))"

EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
