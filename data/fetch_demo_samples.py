#!/usr/bin/env python3
"""
F11 / P5 (demo part) · Fetch ~10 chest X-rays from NIH ChestX-ray14 for the
demo sample picker, without downloading the 45 GB dataset.

Source: the NIH Clinical Center ChestX-ray14 images (Wang et al., CVPR 2017),
read through a public Hugging Face mirror (BahaaEldin0/NIH-Chest-Xray-14,
test split) via the dataset viewer's row API. PA views only, single label.

Writes data/out/samples/{id}.jpg and data/out/manifest.json (both
gitignored). The NIH label is kept in the manifest for evaluations; the
upload script stores it where clients can't read it, and the picker never
shows it. Upload with: (cd functions && npx tsx scripts/upload-samples.ts).

Usage: python3 -I data/fetch_demo_samples.py [--out data/out]
"""
import argparse
import io
import json
import pathlib
import urllib.parse
import urllib.request

from PIL import Image

DATASET = "BahaaEldin0/NIH-Chest-Xray-14"
SPLIT = "test"
ROWS = "https://datasets-server.huggingface.co/rows"

# How many of each label; one pneumothorax is the critical case.
WANT = {"No Finding": 3, "Cardiomegaly": 2, "Effusion": 2, "Pneumothorax": 3}

# Neutral indications, assigned by position (not by label) so the picker
# gives nothing away.
INDICATIONS = [
    "Cough for two weeks.",
    "Shortness of breath on exertion.",
    "Pre-operative check.",
    "Chest pain after a fall.",
    "Fever and cough for three days.",
    "Follow-up film.",
    "Sudden breathlessness.",
    "Routine check.",
    "Tiredness and breathlessness.",
    "Persistent cough.",
]

CITATION = (
    "Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. ChestX-ray8: Hospital-scale Chest X-ray Database "
    "and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases. "
    "IEEE CVPR 2017. Images: NIH Clinical Center."
)


def rows(offset: int, length: int = 100) -> list:
    q = urllib.parse.urlencode({"dataset": DATASET, "config": "default", "split": SPLIT, "offset": offset, "length": length})
    with urllib.request.urlopen(f"{ROWS}?{q}", timeout=60) as r:
        return json.load(r)["rows"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/out")
    ap.add_argument("--max-pages", type=int, default=60)
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    (out / "samples").mkdir(parents=True, exist_ok=True)

    need = dict(WANT)
    picked = []
    for page in range(args.max_pages):
        if not any(need.values()):
            break
        for r in rows(page * 100):
            row = r["row"]
            labels = row["label"]
            if row["View Position"] != "PA" or len(labels) != 1 or need.get(labels[0], 0) == 0:
                continue
            label = labels[0]
            with urllib.request.urlopen(row["image"]["src"], timeout=60) as resp:
                img = Image.open(io.BytesIO(resp.read())).convert("L")
            n = len(picked)
            sample_id = f"nih-{SPLIT}-{r['row_idx']}"
            img.save(out / "samples" / f"{sample_id}.jpg", "JPEG", quality=92)
            picked.append(
                {
                    "id": sample_id,
                    "order": n,
                    "title": f"Sample {n + 1} · chest X-ray",
                    "age": int(row["Patient Age"]),
                    "sex": row["Patient Gender"],
                    "view": "PA",
                    "indication": INDICATIONS[n % len(INDICATIONS)],
                    "nihLabel": label,
                    "critical": label == "Pneumothorax" and need[label] == WANT[label],
                    "source": {"dataset": DATASET, "split": SPLIT, "rowIdx": r["row_idx"], "patientId": row["Patient ID"]},
                }
            )
            need[label] -= 1
            print(f"picked {sample_id}: {label}")
            if not any(need.values()):
                break

    if any(need.values()):
        print(f"warning: still missing {need}")
    (out / "manifest.json").write_text(json.dumps({"citation": CITATION, "samples": picked}, indent=2))
    print(f"wrote {len(picked)} samples to {out}")


if __name__ == "__main__":
    main()
