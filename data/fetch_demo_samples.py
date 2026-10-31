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

With --eval (card E1) it fetches the evaluation films instead: about 24
single-label PA films (the 10 demo samples plus more of each label) into
data/out/eval/films/ and data/out/eval/films.json. The task files in eval/tasks
reference them by id; images are never committed.

Usage: python3 -I data/fetch_demo_samples.py [--out data/out] [--eval]
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
# The evaluation set (E1): the demo samples come first, then more of each label.
EVAL_WANT = {"No Finding": 8, "Cardiomegaly": 5, "Effusion": 5, "Pneumothorax": 4, "Mass": 1, "Consolidation": 1}
NIH_URL = "https://nihcc.app.box.com/v/ChestXray-NIHCC"

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


def fetch_eval(out: pathlib.Path, max_pages: int) -> None:
    """E1 films: the first EVAL_WANT single-label PA films of each label, which include the demo samples."""
    films_dir = out / "eval" / "films"
    films_dir.mkdir(parents=True, exist_ok=True)
    demo = json.loads((out / "manifest.json").read_text())["samples"] if (out / "manifest.json").exists() else []
    demo_rows = {s["source"]["rowIdx"] for s in demo}
    need = dict(EVAL_WANT)
    films = []
    for page in range(max_pages):
        if not any(need.values()):
            break
        for r in rows(page * 100):
            row = r["row"]
            labels = row["label"]
            if row["View Position"] != "PA" or len(labels) != 1 or need.get(labels[0], 0) == 0:
                continue
            # Rows are scanned in the same order as the demo fetch and EVAL_WANT is at
            # least WANT per label, so every demo sample is picked again here.
            label = labels[0]
            film_id = f"nih-{SPLIT}-{r['row_idx']}"
            with urllib.request.urlopen(row["image"]["src"], timeout=60) as resp:
                img = Image.open(io.BytesIO(resp.read())).convert("L")
            img.save(films_dir / f"{film_id}.jpg", "JPEG", quality=92)
            films.append(
                {
                    "id": film_id,
                    "nihLabel": label,
                    "age": int(row["Patient Age"]),
                    "sex": row["Patient Gender"],
                    "demo": r["row_idx"] in demo_rows,
                    "source": {"dataset": DATASET, "split": SPLIT, "rowIdx": r["row_idx"], "nih": NIH_URL},
                }
            )
            need[label] -= 1
            print(f"picked {film_id}: {label}")
            if not any(need.values()):
                break
    if any(need.values()):
        print(f"warning: still missing {need}")
    (out / "eval" / "films.json").write_text(json.dumps({"citation": CITATION, "films": films}, indent=2))
    print(f"wrote {len(films)} films to {films_dir}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/out")
    ap.add_argument("--max-pages", type=int, default=60)
    ap.add_argument("--eval", action="store_true", help="fetch the evaluation films (card E1)")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    if args.eval:
        fetch_eval(out, args.max_pages)
        return
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
