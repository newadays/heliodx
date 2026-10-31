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
| Patient note | 10 | The rewrite of a signed report: one step per signed sentence, nothing added (number, timeframe, dose, medicine, test or urgency word), no condition the impression does not assert, reading grade 8 or lower, all on the first try. |

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
  simulated signer), and both systems rewrite the same text.

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

Runs are saved to `data/out/eval/runs/` first; nothing is published until
`publish`. Mock runs are never published to the live project.

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
