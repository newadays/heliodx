"""SAM 3.1 segmentation server, and the service health check.

Runs inside the HelioDX GPU container next to vLLM (Muse Glimmer). Caddy
routes /v1/* to vLLM and everything else here. Only the Cloud Function can
call the service (Cloud Run IAM), and it runs in the EU.

Privacy: images are processed in memory and never written to disk or logs.
Logs carry timings and counts only.
"""
from __future__ import annotations

import base64
import binascii
import io
import logging
import os
import threading
import time
import urllib.request

import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from samutil import normalise_box, rle_encode

CHECKPOINT = os.environ.get("SAM_CHECKPOINT", "/weights/sam3.1/sam3.1_multiplex.pt")
VLLM_HEALTH_URL = os.environ.get("VLLM_HEALTH_URL", "http://127.0.0.1:8001/health")
MAX_IMAGE_PX = int(os.environ.get("SAM_MAX_IMAGE_PX", "2048"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s sam %(levelname)s %(message)s")
log = logging.getLogger("sam")

app = FastAPI(title="HelioDX SAM 3.1", docs_url=None, redoc_url=None, openapi_url=None)
_processor = None
_load_error: str | None = None
# One image at a time on the GPU; SAM state is per-call but the model is shared.
_gpu_lock = threading.Lock()


def _load() -> None:
    global _processor, _load_error
    started = time.time()
    try:
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        model = build_sam3_image_model(checkpoint_path=CHECKPOINT, load_from_HF=False)
        _processor = Sam3Processor(model)
        log.info("SAM 3.1 loaded in %.1fs", time.time() - started)
    except Exception as exc:  # surfaced through /health
        _load_error = f"{type(exc).__name__}: {exc}"[:300]
        log.error("SAM 3.1 failed to load: %s", _load_error)


@app.on_event("startup")
def _startup() -> None:
    _load()


class SegmentRequest(BaseModel):
    image_b64: str = Field(min_length=16, max_length=30_000_000)
    prompts: list[str] = Field(min_length=1, max_length=16)
    threshold: float = Field(default=0.5, ge=0.05, le=0.95)


class Detection(BaseModel):
    prompt: str
    score: float
    box: list[float]  # [x0, y0, x1, y1], 0-1
    area_px: int
    rle: list[int]  # see samutil.rle_encode


class SegmentResponse(BaseModel):
    width: int
    height: int
    detections: list[Detection]
    ms: int


@app.get("/sam/ready")
def sam_ready():
    """Local readiness, used by start.sh before it launches vLLM."""
    if _processor is None:
        raise HTTPException(503, _load_error or "loading")
    return {"sam": "ok"}


# Not /healthz: Cloud Run reserves URL paths ending in "z" at Google's front
# end, so that path never reaches the container from outside.
@app.get("/health")
def health():
    """Service health: 200 only when SAM and Glimmer (vLLM) both answer."""
    sam = "ok" if _processor is not None else ("error" if _load_error else "loading")
    try:
        with urllib.request.urlopen(VLLM_HEALTH_URL, timeout=3) as r:
            glimmer = "ok" if r.status == 200 else "down"
    except Exception:
        glimmer = "down"
    body = {"sam": sam, "glimmer": glimmer}
    if sam != "ok" or glimmer != "ok":
        raise HTTPException(503, body)
    return body


@app.post("/sam/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest) -> SegmentResponse:
    if _processor is None:
        raise HTTPException(503, "SAM is not loaded")
    prompts = [p.strip() for p in req.prompts if p.strip()]
    if not prompts or any(len(p) > 60 for p in prompts):
        raise HTTPException(422, "prompts must be 1-60 characters")
    try:
        image = Image.open(io.BytesIO(base64.b64decode(req.image_b64, validate=True))).convert("RGB")
    except (binascii.Error, OSError, ValueError):
        raise HTTPException(422, "image_b64 is not a readable image")
    width, height = image.size
    if max(width, height) > MAX_IMAGE_PX:
        raise HTTPException(413, f"image larger than {MAX_IMAGE_PX}px on its long edge")

    started = time.time()
    detections: list[Detection] = []
    # SAM 3 runs in bfloat16 under autocast (as in its own examples); some
    # layers cast activations to bf16 while the weights load as float32.
    with _gpu_lock, torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        _processor.set_confidence_threshold(req.threshold)
        state = _processor.set_image(image)
        for prompt in prompts:
            _processor.reset_all_prompts(state)
            out = _processor.set_text_prompt(state=state, prompt=prompt)
            masks = out["masks"].squeeze(1).bool().cpu().numpy()
            boxes = out["boxes"].float().cpu().numpy()
            scores = out["scores"].float().cpu().numpy()
            for mask, box, score in zip(masks, boxes, scores):
                detections.append(
                    Detection(
                        prompt=prompt,
                        score=round(float(score), 4),
                        box=normalise_box(box, width, height),
                        area_px=int(mask.sum()),
                        rle=rle_encode(mask),
                    )
                )
    ms = int((time.time() - started) * 1000)
    log.info("segment: %d prompts, %d detections, %d ms", len(prompts), len(detections), ms)
    return SegmentResponse(width=width, height=height, detections=detections, ms=ms)
