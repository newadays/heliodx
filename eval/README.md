# Evaluation: HelioDX vs MedGemma

The task library the agents are graded on, run through the same stage code
the app runs (`functions/src/stages`). Two systems, same hardware, same
prompts, same SAM masks and measurements; only the language model differs.

| System | Model | Precision | GPU |
|---|---|---|---|
| HelioDX | Muse Glimmer 30B + SAM 3.1 | FP8 (per tensor) | 1× NVIDIA RTX PRO 6000, vLLM 0.32.0 |
| Baseline | MedGemma 27B (`google/medgemma-27b-it`), with SAM 3.1 masks from the HelioDX service | bf16 | 1× NVIDIA RTX PRO 6000, vLLM 0.32.0 |

Results are on the public page `/evals` and in the README.

## Tasks

`eval/tasks/<family>/<id>.json`, shape in `functions/src/eval/types.ts`. Every
criterion is graded in code (`functions/src/eval/grade.ts`); a task's score is
the share of its criteria passed.

| Family | Tasks | What is graded |
|---|---|---|
| Intake | 14 | Clean films accepted and read as a PA chest X-ray; blurred and down-sampled copies sent back for a retake with the right reason; two synthetic non-medical images refused. Ground truth comes from how each variant was built. |
| Triage | 24 | The reading lane against the NIH label (pneumothorax → critical; cardiomegaly, effusion, mass, consolidation → urgent; no finding must stay routine), the model answered, and every cited measurement exists. |
| Prep | 24 | What the model proposed before the app's filters: no observation names a condition, none lacks evidence, the impression survives the filter, and the observations flag attention exactly when the label is abnormal. |
| Patient note | 8 | The rewrite of a signed report: one step per signed sentence, nothing added (number, timeframe, dose, medicine, test or urgency word), no condition the impression does not assert, reading grade 8 or lower, all on the first try. |
| TB screening | 120 | Whether the agents surface a TB-suggestive pattern for the clinician on public TB screening films, and stay quiet on normal ones. See [TB screening](#tb-screening). |

Limits, stated plainly:

- NIH labels are text-mined and noisy, and carry no size: an effusion is
  graded urgent, never critical.
- Triage floors come from geometry (heart size, lung asymmetry, angle
  blunting, density). Mass and consolidation have no measurement behind
  them, so they are expected to be missed unless the model raises the lane.
- The prompts were written for Glimmer. MedGemma runs them unchanged, so
  some of its misses may be about following our format rather than reading
  the film.
- Intake's blur and resolution checks are code, so both systems pass or fail
  them together; the model-dependent intake criteria are view, modality and
  the non-medical images.
- Patient-note tasks are rewrites of HelioDX drafts (signed as drafted by a
  simulated signer), and both systems rewrite the same text. Two of ten
  held-out films gave no draft, so there are 8. Four drafts were corrected by
  hand before signing, as a radiologist would: a heart size called "within"
  on an AP film (note-1), a crossed threshold called "within" (note-6), and
  two cut-off sentences (note-5, note-8).
- The lung cutoff (0.2, `tools/anatomy.ts`) was chosen after a probe on these
  same films; the held-out half is reported separately for that reason.
- The heart-size floor applies only to PA films, and the model decides the
  view. So the "floor from measurements" triage column depends on the model
  even though both systems get identical measurements.

## TB screening

Card E16. Film-level TB labels from two public screening sets, run through
intake, triage and prep exactly like the Prep family, then graded on the
TB-suggestive pattern (B26) and the zone outlines (B25).

**Sets.** Shenzhen (Shenzhen No. 3 People's Hospital: 336 TB, 326 normal,
about 3000 px) and Montgomery County (Montgomery County TB screening
programme: 58 TB, 80 normal, 4020 × 4892 px), both from the U.S. National
Library of Medicine. Each film has a clinical reading (sex, age and a short
text such as "right upper PTB with fibrous changes" or "inactive TB scars
LUL"); 68 Shenzhen and 55 Montgomery TB films also have consensus ROI boxes.

**Sample.** Fixed (`pick` in `data/fetch_tb_sets.py` and
`functions/src/eval/tasks.ts`: the ids with the smallest
sha256 of seed and id, so the same ids every time):

| Split | TB | Normal | Shenzhen | Montgomery |
|---|---|---|---|---|
| Held-out | 40 | 40 | 30 + 30 | 10 + 10 |
| Tuning | 20 | 20 | 15 + 15 | 5 + 5 |

21 of the 60 sampled TB films have ROI boxes. Every task has the same
synthetic indication ("Adult with a cough for several weeks."); age and sex
come from the dataset. Titles are "TB screening · film N" and task numbers
are in a seeded order, so neither gives the label away.

**Criteria** (all code, `gradeTb` in `functions/src/eval/grade.ts`):

| Criterion | Films | Passes when |
|---|---|---|
| `tb_flag` | all | The TB pattern is raised (an abnormal observation tagged `tb_suggestive`, or a kept consideration naming TB) on TB films, and not raised on normal films. |
| `priority_floor` | TB | The lane after the B26 lift (a tagged pattern raises routine to urgent) is urgent or critical. |
| `attention` | all | TB films: at least one observation is attention (`polarityOf`: abnormal, or cites a crossed threshold). Normal films: none is. |
| `no_leak` | all | The model's titles, descriptions, findings paragraph, impression and recommendation, before the app's filters, never assert TB. Considerations may, by design. |
| `outline` | all | Every abnormal observation has at least one zone outline. |
| `zone_match` | TB with a read side or an ROI (57 of 60) | An abnormal outline is on a side the reading names (and its zone, when the reading names one), or its box overlaps an ROI box. |
| `read_gate` | TB | `readRequirement` asks for a radiologist read (critical, or pattern of concern) with every observation accepted. |

Sensitivity is TB films whose `tb_flag` passed over TB films; specificity is
normal films whose `tb_flag` passed over normal films. Both are reported with
95% Wilson intervals over the films that ran without error; the run record
also carries the floor, zone-match and no-leak rates (`tbSummary`).

Limits, stated plainly:

- These are screening sets from two sites, not the clinic's own population,
  equipment or TB prevalence. A sensitivity here does not transfer.
- The language model is a general model, not a trained TB detector. The
  number says whether the agents surface the pattern for a clinician to
  consider, not how well a film is diagnosed.
- Labels are film-level (TB yes/no). The zone check is coarse: thirds of the
  chest from the lung masks, matched to a side and zone parsed from a free-text
  reading (Montgomery shorthand such as RUL, LUL, rt, lt is spelled out first),
  or any overlap with an ROI box. No lesion-level accuracy is claimed.
- ROI frame: the consensus ROI files give boxes in a 1024 × 1024 display
  frame, whatever the film's aspect. Against the pixel-level Shenzhen
  annotations (Yang et al., Data 2022) on the 67 films that have both, the
  ROI union scaled by width/1024 and height/1024 centres on the polygon union
  (median ratio 1.01 in x, 0.99 in y; an aspect-preserving frame is off by
  15% in y on tall films). Montgomery has no pixel annotations, so the same
  frame is assumed there.
- On 26 of the first 60 Shenzhen films SAM 3.1 returned both lungs under the
  "right lung" prompt and nothing under "left lung", so intake rejected them
  as "lungs not found" (1 Nov run). Since 2 Nov a lung with no detection of
  its own takes the other prompt's box on its side of the film (`pickBest`,
  `tools/segment.ts`); that recovers 25 of the 26.
- Many readings name no side ("STB", "inactive TB scars"); those films are
  matched on ROI boxes only, or not at all (3 of 60). Some readings name
  several places; `parseLocation` keeps every side and one zone (upper over
  middle over lower).

**Data and terms.** Nothing from these sets is in this repository. Each
user fetches the images, readings and ROI boxes from the NLM and builds
`eval/tasks/tb` locally (gitignored). The in-app `/evals` page shows only
the aggregate numbers (sensitivity, specificity and rates). The public results
file (E17, below) also lists each TB task by its library id and title ("tb-37",
"TB screening · film 37") with its split, the film-level label (TB or normal)
and each system's pass or fail per criterion; it never holds a film id, file
name, reading, age, sex, ROI box, image or model text, so it cannot be mapped
back to the set's files. The NLM readme for each set states (verbatim):

> Shenzhen (`NLM-ChinaCXRSet-ReadMe.docx`): "Please do not share the dataset
> outside of your research group/ organization, but forward new dataset
> requests to us. Please inform us if you find errors or inconsistencies in
> the data. It is requested that publications resulting from the use of this
> data attribute the source (National Library of Medicine, National Institutes
> of Health, Bethesda, MD, USA and Shenzhen No.3 People's Hospital, Guangdong
> Medical College, Shenzhen, China) and cite the following publications:"

> Montgomery (`NLM-MontgomeryCXRSet-ReadMe.pdf`): "(a) Please do not share the
> data set outside of your research group/organization, but forward new data
> set requests to us. (b) Please inform us if you find errors or
> inconsistencies in the data. (c) It is requested that publications
> resulting from the use of this data attribute the source (National Library
> of Medicine, National Institutes of Health, Bethesda, MD, USA) and cite the
> following publications:"

Cite: Jaeger S, Candemir S, Antani S, Wáng YX, Lu PX, Thoma G. *Two public
chest X-ray datasets for computer-aided screening of pulmonary diseases.*
Quant Imaging Med Surg 2014;4(6):475–477. Candemir S, Jaeger S, Palaniappan
K, et al. *Lung segmentation in chest radiographs using anatomical atlases
with nonrigid registration.* IEEE Trans Med Imaging 2014;33(2):577–590.
Jaeger S, Karargyris A, Candemir S, et al. *Automatic tuberculosis screening
using chest radiographs.* IEEE Trans Med Imaging 2014;33(2):233–245. Data
courtesy of the U.S. National Library of Medicine, Shenzhen No. 3 People's
Hospital, and the Montgomery County Department of Health and Human Services.

```sh
python3 -I data/fetch_tb_sets.py --eval           # 120 PNGs (about 620 MB) → data/out/eval/tb (not committed)
cd functions
npm run eval -- build-tasks --tb                  # eval/tasks/tb (local, gitignored)
npm run eval -- run --system helio --family tb --mock --limit 4
```

Under `--mock` the fixture model never raises the pattern, so TB films fail
`tb_flag` by design; the mock checks the plumbing, not the model.

## Run it

```sh
python3 -I data/fetch_demo_samples.py --eval     # 24 NIH films → data/out/eval (not committed)
cd functions
npm run eval -- build-tasks                       # eval/tasks/{intake,triage,prep}
npm run eval -- run --system helio --mock         # no GPU: fixture model and SAM, checks the plumbing
```

A live run needs the GPU services (`gpu/README.md`, "Eval baseline") and
credentials that may invoke them. Only the Functions runtime service account
may call the GPU, so run as that account through impersonation:

```sh
gcloud iam service-accounts add-iam-policy-binding <runtime-service-account> \
  --member user:<you> --role roles/iam.serviceAccountTokenCreator
gcloud auth application-default login --impersonate-service-account <runtime-service-account>
```

Then, from `functions/`:

```sh
export GPU_URL=<HelioDX service URL> BASELINE_GPU_URL=<baseline service URL> EVAL_GPU_USD_PER_HOUR=<price>
npm run eval -- build-notes                       # patient-note tasks from HelioDX drafts; read them, then commit
npm run eval -- run --system helio
(cd ../gpu && SERVICE=heliodx-baseline ./warm.sh on)
npm run eval -- run --system medgemma
(cd ../gpu && SERVICE=heliodx-baseline ./warm.sh off)
npm run eval -- table <helio runId> <medgemma runId>
SEED_TARGET=project npm run eval -- publish <runId>    # to the public page
```

Runs are saved to `data/out/eval/runs/` after every task; nothing is
published until `publish`. Mock runs are never published to the live project.
A run that stops part way continues with `run … --resume <runId>` (the same
flags), which keeps every graded task and re-runs those that lost the GPU.

### Public results file (E17)

The results site (E18) reads one JSON file from a public Cloud Storage bucket,
built from local runs by `export` and validated against `PublicResultsSchema`
(`functions/src/eval/publicSchema.ts`). For each system and family the newest
run that has the family is used, so the NIH families and the TB family can
come from different runs; each family keeps its run id and commit.

```sh
npm run eval -- run --system helio    --family tb --dataset shenzhen
npm run eval -- run --system medgemma --family tb --dataset shenzhen
npm run eval -- export <helio NIH> <medgemma NIH> <helio TB> <medgemma TB>            # data/out/eval/public
npm run eval -- export <same runIds> --bucket            # also uploads; the name comes from EVAL_RESULTS_BUCKET
```

The upload writes `results/runs/<time>.json` (cached for a year),
`results/latest.json` and `results/index.json` (five minutes). The bucket is
uniform-access with public read and CORS GET; its name stays out of this
repository. The file holds per-family and per-system summaries, triage and
TB numbers (combined, held-out and tuning, per criterion), and per task: id,
title, split, tags, criteria, the synthetic indication, what is expected in
words, and per system the score, pass or fail per criterion, latency and a
short error class. Mock runs are never uploaded.

## Data and licences

Films: NIH Clinical Center ChestX-ray14, fetched through a public mirror and
never committed. Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM.
*ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on
Weakly-Supervised Classification and Localization of Common Thorax
Diseases.* IEEE CVPR 2017. Download: https://nihcc.app.box.com/v/ChestXray-NIHCC.
Ages and sexes come from the dataset; indications are synthetic.

MedGemma is used under the Health AI Developer Foundations terms of use and
is not for clinical use. HelioDX is a research prototype and is not for
clinical use either.
