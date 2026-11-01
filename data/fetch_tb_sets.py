#!/usr/bin/env python3
"""
E16 · Fetch a fixed sample of the two public TB screening sets for the
evaluation's TB family, without downloading either set in full.

Sources (U.S. National Library of Medicine, Lister Hill Center):
  - Shenzhen: 336 TB and 326 normal films from Shenzhen No. 3 People's
    Hospital, with clinical readings and a consensus ROI file.
  - Montgomery County: 58 TB and 80 normal films from the Montgomery County
    TB screening programme, with clinical readings and a consensus ROI file.
    If the NLM path fails, the Montgomery files are read from a Hugging Face
    mirror with the original layout (Famatsu123/montgomery-shenzhen-tuberculosis-cxr).

Sample, fixed (the same ids every run; `pick` is mirrored in
functions/src/eval/tasks.ts and tested there):
  held-out  40 TB + 40 normal (Shenzhen 30 + 30, Montgomery 10 + 10)
  tuning    20 TB + 20 normal (Shenzhen 15 + 15, Montgomery 5 + 5)

Writes data/out/eval/tb/<id>.png (the original PNGs, untouched; the runner
makes the model copy) and data/out/eval/tb-films.json, both gitignored. The
NLM readme asks that the data set not be shared outside the research group,
so the images and the reading texts stay here; the committed task files
(eval/tasks/tb) hold ids, labels, source URLs, ROI boxes and the side and
zone read from the reading.

ROI frame: the consensus ROI files give x_dis, y_dis, width_dis, height_dis
in a 1024 x 1024 display frame, whatever the film's aspect. Checked against
the pixel-level Shenzhen annotations (Yang et al., Data 2022): over the 67
films with both, the union of the ROI boxes, scaled by width/1024 and
height/1024, centres on the union of the pixel polygons (median ratio 1.01
in x, 0.99 in y), where an aspect-preserving 1024-wide frame is off by 15%
in y on tall films. Montgomery has no pixel annotations to check against; the
same frame is assumed. Boxes are stored normalised 0-1, [x0, y0, x1, y1].

Usage: python3 -I data/fetch_tb_sets.py --eval [--out data/out]
"""
import argparse
import csv
import hashlib
import io
import json
import pathlib
import re
import time
import urllib.request

NLM = "https://data.lhncbc.nlm.nih.gov/public/Tuberculosis-Chest-X-ray-Datasets"
HF = "https://huggingface.co/datasets/Famatsu123/montgomery-shenzhen-tuberculosis-cxr/resolve/main"
HF_TREE = "https://huggingface.co/api/datasets/Famatsu123/montgomery-shenzhen-tuberculosis-cxr/tree/main"

SETS = {
    "shenzhen": {"base": f"{NLM}/Shenzhen-Hospital-CXR-Set", "mirror": None, "prefix": "CHNCXR", "roi": "shenzhen_consensus_roi.csv"},
    "montgomery": {
        "base": f"{NLM}/Montgomery-County-CXR-Set/MontgomerySet",
        "mirror": f"{HF}/MontgomerySet",
        "prefix": "MCUCXR",
        "roi": "montgomery_consensus_roi.csv",
    },
}

# (held-out, tuning) per dataset and label.
SAMPLE = {
    ("shenzhen", "tb"): (30, 15),
    ("shenzhen", "normal"): (30, 15),
    ("montgomery", "tb"): (10, 5),
    ("montgomery", "normal"): (10, 5),
}
SEED = "heliodx-e16"
ROI_FRAME = 1024

CITATION = (
    "Jaeger S, Candemir S, Antani S, Wang YX, Lu PX, Thoma G. Two public chest X-ray datasets for computer-aided "
    "screening of pulmonary diseases. Quant Imaging Med Surg 2014;4(6):475-477. Data courtesy of the U.S. National "
    "Library of Medicine, Shenzhen No. 3 People's Hospital, and the Montgomery County Department of Health and Human Services."
)


def pick(ids: list, n: int, seed: str) -> list:
    """Fixed-seed sample: the n ids with the smallest sha256(seed:id). Mirrored by `pick` in functions/src/eval/tasks.ts."""
    return sorted(ids, key=lambda i: hashlib.sha256(f"{seed}:{i}".encode()).hexdigest())[:n]


def get(url: str, tries: int = 3) -> bytes:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch(ds: str, path: str) -> tuple:
    """(bytes, url) from NLM, or from the mirror when NLM fails and one exists."""
    cfg = SETS[ds]
    url = f"{cfg['base']}/{path}"
    try:
        return get(url), url
    except Exception:
        if not cfg["mirror"]:
            raise
        url = f"{cfg['mirror']}/{path}"
        return get(url), url


def listing(ds: str) -> list:
    """File stems in CXR_png (e.g. CHNCXR_0001_0), from the NLM index page or the mirror's tree API."""
    cfg = SETS[ds]
    pattern = re.compile(rf"{cfg['prefix']}_\d{{4}}_[01]\.png")
    try:
        html = get(f"{cfg['base']}/CXR_png/index.html").decode("utf-8", "replace")
        names = set(pattern.findall(html))
    except Exception:
        names = set()
    if not names and cfg["mirror"]:
        tree = json.loads(get(f"{HF_TREE}/MontgomerySet/CXR_png"))
        names = {pathlib.PurePosixPath(e["path"]).name for e in tree if pattern.fullmatch(pathlib.PurePosixPath(e["path"]).name)}
    return sorted(n[:-4] for n in names)


def rois(ds: str) -> dict:
    """stem -> [[x0, y0, x1, y1] normalised 0-1] from the consensus ROI file (1024 x 1024 display frame)."""
    try:
        text, _ = fetch(ds, SETS[ds]["roi"])
    except Exception as e:
        print(f"warning: no ROI file for {ds} ({e}); its films get roi []")
        return {}
    out: dict = {}
    for r in csv.DictReader(io.StringIO(text.decode("utf-8-sig"))):
        x, y, w, h = (float(r[k]) for k in ("x_dis", "y_dis", "width_dis", "height_dis"))
        if w <= 1 or h <= 1:
            continue  # degenerate strokes in the file (e.g. width 1)
        clamp = lambda v: round(min(1.0, max(0.0, v / ROI_FRAME)), 4)
        out.setdefault(r["patientId"][:-4], []).append([clamp(x), clamp(y), clamp(x + w), clamp(y + h)])
    return out


def reading(ds: str, stem: str) -> dict:
    """Sex, age and the reading text from ClinicalReadings/<stem>.txt."""
    raw, _ = fetch(ds, f"ClinicalReadings/{stem}.txt")
    lines = [l.strip() for l in raw.decode("utf-8", "replace").splitlines() if l.strip()]
    sex = age = None
    rest = []
    for line in lines:
        low = line.lower()
        m_sex = re.search(r"sex:\s*([mf])|^(male|female)\b", low)
        m_age = re.search(r"(\d+)\s*(?:y|yr|yrs|years?)\b", low)
        if ds == "montgomery" and low.startswith("patient's sex"):
            sex = "M" if m_sex and m_sex.group(1) == "m" else "F"
        elif ds == "montgomery" and low.startswith("patient's age"):
            age = int(m_age.group(1)) if m_age else None
        elif ds == "shenzhen" and sex is None and m_sex:
            sex = "M" if m_sex.group(2) == "male" else "F"
            age = int(m_age.group(1)) if m_age else None
            tail = re.sub(r"^(male|female)\s*\S*\s*", "", line, flags=re.I).strip()
            if tail and not re.fullmatch(r"\d+\s*(?:y|yr|yrs|years?|days?|months?)", tail, flags=re.I):
                rest.append(tail)
        else:
            rest.append(line)
    return {"sex": sex, "age": age, "reading": " ".join(rest).strip()}


def fetch_eval(out: pathlib.Path) -> None:
    tb_dir = out / "eval" / "tb"
    tb_dir.mkdir(parents=True, exist_ok=True)
    films = []
    for ds in SETS:
        stems = listing(ds)
        roi = rois(ds)
        print(f"{ds}: {len(stems)} films listed, {len(roi)} with an ROI")
        for label, suffix in (("tb", "_1"), ("normal", "_0")):
            held, tune = SAMPLE[(ds, label)]
            chosen = pick([s for s in stems if s.endswith(suffix)], held + tune, f"{SEED}:{ds}:{label}")
            if len(chosen) < held + tune:
                raise SystemExit(f"{ds} {label}: only {len(chosen)} films listed, need {held + tune}")
            for k, stem in enumerate(chosen):
                path = tb_dir / f"{stem}.png"
                png_url = f"{SETS[ds]['base']}/CXR_png/{stem}.png"
                if not path.exists() or path.stat().st_size == 0:
                    data, png_url = fetch(ds, f"CXR_png/{stem}.png")
                    if not data.startswith(b"\x89PNG"):
                        raise SystemExit(f"{stem}: not a PNG from {png_url}")
                    path.write_bytes(data)
                info = reading(ds, stem)
                films.append(
                    {
                        "id": stem,
                        "dataset": ds,
                        "label": label,
                        "split": "held-out" if k < held else "tuning",
                        "reading": info["reading"],
                        "age": info["age"],
                        "sex": info["sex"],
                        "roi": roi.get(stem, []) if label == "tb" else [],
                        "source": png_url,
                    }
                )
                print(f"  {stem}: {label} · {films[-1]['split']} · roi {len(films[-1]['roi'])}")
    (out / "eval" / "tb-films.json").write_text(
        json.dumps({"citation": CITATION, "roiFrame": f"{ROI_FRAME}x{ROI_FRAME} display, normalised 0-1", "films": films}, indent=2)
    )
    count = lambda **kw: sum(all(f[k] == v for k, v in kw.items()) for f in films)
    for split in ("held-out", "tuning"):
        print(f"{split}: {count(split=split, label='tb')} TB + {count(split=split, label='normal')} normal")
    print(f"wrote {len(films)} films to {tb_dir} and {out / 'eval' / 'tb-films.json'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/out")
    ap.add_argument("--eval", action="store_true", help="fetch the TB evaluation sample (card E16)")
    args = ap.parse_args()
    if not args.eval:
        ap.error("pass --eval to fetch the TB evaluation sample")
    fetch_eval(pathlib.Path(args.out))


if __name__ == "__main__":
    main()
