# HelioDX design — compliance rules for the canvas and the mockups

Version 1 · 3 Nov 2026 · applies to the Claude Design canvas ("HelioDX clinician flow — redesign"), the exported mockups in `design/mockups/`, the handoff spec and fixtures, and every artboard added later.

## 1. The rule every artboard follows

HelioDX is a **clinical workflow tool**: it measures the film, drafts observations with evidence, documents, and hands everything to a clinician who reviews, edits and signs. It is **not** a detector and **not** a source of medical advice. On screen, that means:

> **Describe what is measured or seen on the film. Flag what needs attention. Let the clinician name it.**

Nothing drawn in a mockup may:

- name a disease or condition as a product output ("TB-suggestive pattern", "consistent with pulmonary tuberculosis");
- show a probability of disease ("likelihood 0.86", "TB 86 %");
- describe the product as detecting, diagnosing or speeding up diagnosis;
- claim compliance, clearance, validation or accuracy ("compliant", "validated", "clinically proven", "at scale");
- address advice to a patient or clinician beyond "review this".

Allowed on screen: measurements against limits (CTR 0.45 · limit 0.55), feature descriptions (upper-zone opacity, possible cavity, blunting), the chips **Needs attention** / **Normal**, confidence of an *observation* (High · 90 %), worklist order, drafted text the clinician signs, and the status line "Research prototype · public de-identified films, synthetic patients · not for clinical use".

Model names, settled: **Muse Wonder** coordinates · **Muse Glimmer** drafts · **SAM 3.1** segments. No other names ("Glimmer" alone, "Muse Spark") anywhere.

## 2. Changes applied to the canvas (3 Nov)

These are done; they are listed so the mockups and the spec can be checked against them.

| Artboard | Was | Now |
| --- | --- | --- |
| Social · Analyzing (1600 × 900) | Card 1 evidence line "Pattern consistent with **pulmonary tuberculosis** · confidence 0.86 · for clinician review"; board title "tuberculosis pattern" | "Focal increased opacity in the right upper zone with a possible cavity · confidence 0.86 · **for clinician review**"; board title "findings that need attention" |
| 0 · Welcome, hero paragraph | "a Meta Glimmer model coordinator for a team of Muse Spark agents that runs clinical workflows in a private, compliant manner at scale" | "Meta Muse Wonder coordinates a team of Muse Glimmer agents that take a chest X-ray from intake to a signed report, on the clinic's own GPU. A clinician reviews, edits and signs every finding." |
| 0 · Welcome, principle card | "Private and compliant — Clinical workflows run in a private, compliant manner at scale." | "Private by design — Images and reports stay on the clinic's own GPU and in its own project." |
| 0 · Welcome, footer | "Meta Glimmer · SAM 3.1 · Muse Spark agents" | "Muse Wonder · Muse Glimmer · SAM 3.1" |
| 8 · Agent console page, agents | Coordinator tagged "Glimmer"; agents tagged "Glimmer"; Triage "sets routine or urgent priority" | Coordinator "Muse Wonder"; agents "Muse Glimmer"; Triage "proposes a review order for the clinician's worklist" |
| 8 · Agent console page, tools | `set_priority(measurements, context)` — "Routine or urgent…" | `propose_order(measurements, context)` — "A review order for the worklist… The clinician decides." |
| 7 · Worklist with console, trace tags and footer | "Glimmer"; "Model steps run on Glimmer; segmentation on SAM 3.1." | "Muse Glimmer"; "Muse Wonder coordinates; model steps run on Muse Glimmer; segmentation on SAM 3.1." |

Unchanged because they already comply: the finding rows on Review (observations with measurement · limit, confidence High/Moderate, Accept/Edit/Reject), the Sign report line "AI-drafted for clinician review. Not a diagnosis — verify against the image before signing.", the Review subtitle "AI-drafted. Supports your judgment; not a diagnosis.", the patient note's approved-by line, the environment chip in every header, the PDF-only share, and the upload de-identification screens. "Detecting findings" as a step name is acceptable: it detects *findings* (features), not disease.

## 3. Rules for new artboards and edits

1. **Finding cards and rows.** Title = the observed feature. Evidence line = measurement · limit · region, or the feature's description. Chip = Needs attention (red) or Normal (green). Never a disease name, never a disease probability. Observation confidence may be shown as High / Moderate / Low with its number.
2. **Headlines and subtitles.** Describe the workflow ("Drafting findings", "Review findings", "Save the patient note as a PDF"). Never "Detect <disease>", "Diagnose", "Likelihood of…".
3. **Status copy.** "N findings · all within normal limits" or "N findings · K need attention". Worklist, console and social assets use the same phrasing.
4. **Report and note.** Keep the "Not a diagnosis" line on Sign. The patient note names a condition only if the clinician wrote it into the signed report; mockups therefore show none.
5. **Claims.** No "compliant", "validated", "accurate", "clinically proven", "at scale", "beta". The only status words are "Research prototype · public de-identified films, synthetic patients · not for clinical use" (header chip) and "HelioDX research prototype · not for clinical use" (PDF footer, social assets).
6. **Agents and tools.** Roles say "observations", "measurements", "proposes", "drafts", "checks". Tool names say what they measure or propose (`measure`, `propose_observation`, `propose_order`, `draft_report`, `check_note`); never `detect_*`, `classify_*`, `diagnose_*`. `propose_observation` keeps "Never a diagnosis."
7. **Model names.** Muse Wonder, Muse Glimmer, SAM 3.1 — in tags, footers and copy.
8. **Social and marketing artboards.** Same rules as the app, plus the status line somewhere visible. A disease may appear only as public-health *context* in landing copy ("where tuberculosis is a top-5 killer"), never as what the product finds.
9. **Film choice.** A positive film may be used to show a *Needs attention* state; the overlay labels name the feature ("Right upper zone · opacity with possible cavitation"), not the disease.

## 4. Check before publishing an artboard

Search the artboard source for these and fix every hit that is a product claim:

```
tubercul | \bTB\b | diagnos | likelihood | probability | detect (as a verb about disease) |
compliant | validated | accurate | proven | at scale | beta | Muse Spark | "Glimmer" without "Muse"
```

Then confirm: the header chip is present (signed-in screens); every finding card follows rule 1; model names follow rule 7.

## 5. Handoff files to keep in step

- `design/mockups/*.html` — regenerate from the canvas after any copy change (the convert script), so Claude Code never copies a stale string.
- `design/SPEC.md` — fixtures §3.3 and the console fixtures: tag Intake/Triage/Prep/Summary as "Muse Glimmer", the Coordinator as "Muse Wonder"; Triage role "proposes a review order"; tool `propose_order` replaces `set_priority`.
- `design/components.md` — no change (components carry no disease copy).
- `design/CLAUDE.md` — add one non-negotiable: "No disease names or disease probabilities in any UI string; model names are Muse Wonder, Muse Glimmer, SAM 3.1."
- Social clip and still — re-export with the Social artboard's current card text; voice-over: "Right upper zone opacity with possible cavitation — flagged for clinician review."
