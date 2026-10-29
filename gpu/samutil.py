"""Pure helpers for the SAM server: mask encoding and box normalisation.

No torch, no GPU: unit-tested on any machine (`python3 -m unittest`).

Mask encoding (shared with functions/src/models/gpu.ts `decodeRle`):
row-major (C order) run lengths of a boolean mask, alternating
false/true and always starting with a run of false (which may be 0).
"""
from __future__ import annotations

from typing import Sequence

import numpy as np


def rle_encode(mask: np.ndarray) -> list[int]:
    flat = np.asarray(mask, dtype=bool).ravel(order="C")
    if flat.size == 0:
        return []
    # Indices where the value changes, plus both ends.
    change = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    edges = np.concatenate(([0], change, [flat.size]))
    runs = np.diff(edges).tolist()
    if flat[0]:
        runs.insert(0, 0)
    return [int(r) for r in runs]


def rle_decode(counts: Sequence[int], height: int, width: int) -> np.ndarray:
    flat = np.zeros(height * width, dtype=bool)
    pos, value = 0, False
    for run in counts:
        if value:
            flat[pos : pos + run] = True
        pos += run
        value = not value
    if pos != height * width:
        raise ValueError(f"run lengths cover {pos} pixels, expected {height * width}")
    return flat.reshape(height, width)


def normalise_box(box_xyxy: Sequence[float], width: int, height: int) -> list[float]:
    """Pixel [x0, y0, x1, y1] to 0-1, clamped and rounded to 4 places."""
    x0, y0, x1, y1 = (float(v) for v in box_xyxy)
    out = [x0 / width, y0 / height, x1 / width, y1 / height]
    return [round(min(1.0, max(0.0, v)), 4) for v in out]
