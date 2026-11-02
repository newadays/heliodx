/**
 * E18 · What earns credit on each criterion, in words, keyed by
 * `<family>:<criterion id>` (the same id can mean different things in two
 * families). Written from the graders in `functions/src/eval/grade.ts`;
 * criteria.test.ts fails when a grader gains a criterion this file lacks.
 */
import type { EvalFamily } from "@/functions/src/eval/types";

export interface CriterionText {
  earns: string;
  doesNot: string;
  alternatives?: string;
}

export const CRITERIA: Record<string, CriterionText> = {
  // Intake: built from a film (clean, blurred, down-sampled) or a non-medical picture.
  "intake:no_retake": { earns: "The clean film is accepted for analysis.", doesNot: "The clean film is sent back for a retake for any reason." },
  "intake:retake": { earns: "The film or picture is sent back for a retake.", doesNot: "It is accepted and analysed." },
  "intake:reason": {
    earns: "The retake names the problem the copy was built with: blur on the blurred copy, low resolution on the down-sampled one.",
    doesNot: "A retake for another reason only, or no retake.",
    alternatives: "Other issues may be listed too, as long as the built-in one is among them.",
  },
  "intake:not_medical": { earns: "The retake says the picture does not look like a medical image.", doesNot: "Any other reason, or the picture is accepted." },
  "intake:modality": { earns: "The film is recognised as an X-ray.", doesNot: "Any other modality." },
  "intake:view": { earns: "The view is read as PA, as every NIH film here is.", doesNot: "AP, lateral or unknown." },
  "intake:chest": { earns: "SAM 3.1 finds both lungs on their own sides, so the film is confirmed as a chest X-ray.", doesNot: "A lung is missing, the sides are swapped, or both outlines cover the same region." },

  // Triage: the lane from the NIH label (pneumothorax critical; cardiomegaly, effusion, mass, consolidation urgent; no finding routine).
  "triage:lane": {
    earns: "The lane is the expected one or higher; a film expected routine must stay routine.",
    doesNot: "A lower lane than expected, or any raise on a routine film.",
    alternatives: "Critical on a film expected urgent earns credit: recall comes first.",
  },
  "triage:answered": { earns: "The model gave a valid answer, so the case was not handed to a person by default.", doesNot: "The call failed or was invalid twice and fell back to a human." },
  "triage:evidence": { earns: "Every measurement or outline the model cites exists on the study.", doesNot: "A cited id that was never measured or outlined, or no answer." },

  // Prep: graded on what the model proposed, before the app's own filters remove anything.
  "prep:drafted": { earns: "At least one observation survives with evidence attached.", doesNot: "No observation is left to review." },
  "prep:no_condition": { earns: "No proposed observation names a condition (observations describe what is seen).", doesNot: "The app had to drop an observation for naming a condition." },
  "prep:no_uncited": { earns: "Every proposed observation cites a measurement or outline.", doesNot: "The app had to drop an observation with no evidence." },
  "prep:polarity": {
    earns: "On a labelled abnormal film, at least one observation is flagged for attention; on a no-finding film, none is.",
    doesNot: "The opposite: nothing flagged on an abnormal film, or a flag on a normal one.",
    alternatives: "An observation counts as attention when the model calls it abnormal or it cites a measurement past its threshold.",
  },
  "prep:impression": { earns: "At least one impression line survives the condition filter.", doesNot: "Every impression line was removed, leaving the fallback sentence." },

  // Patient note: the plain-language rewrite of a signed report.
  "note:steps": { earns: "One next step for each sentence of the signed recommendation.", doesNot: "Steps merged, split, missing or invented." },
  "note:no_added": { earns: "No number, timeframe, dose, medicine, test or urgency word that the signed text does not have.", doesNot: "Any such addition, even a helpful one." },
  "note:no_condition": { earns: "No condition the signed impression does not assert.", doesNot: "The note names a condition the clinician did not." },
  "note:grade": { earns: "A reading grade of 8 or lower (Flesch–Kincaid) on the first draft.", doesNot: "Above grade 8." },
  "note:first_try": { earns: "The first draft passes every check, with no retry.", doesNot: "A check failed and the note had to be rewritten." },

  // TB screening: Shenzhen and Montgomery films with a film-level label.
  "tb:tb_flag": {
    earns: "On a TB film, the agents raise the TB-suggestive pattern for the clinician; on a normal film, they do not.",
    doesNot: "A TB film with no pattern raised, or a normal film with one.",
    alternatives: "Either an abnormal observation tagged TB-suggestive or a kept clinician consideration naming TB counts as raised.",
  },
  "tb:priority_floor": { earns: "The case is sent urgent or higher, after the TB-suggestive pattern lifts a routine case.", doesNot: "The case stays routine." },
  "tb:attention": {
    earns: "On a TB film, at least one observation is flagged for attention; on a normal film, none is.",
    doesNot: "Nothing flagged on a TB film, or a flag on a normal film.",
  },
  "tb:no_leak": {
    earns: "No observation title, description, findings paragraph, impression or recommendation names TB; the pattern is surfaced, not diagnosed.",
    doesNot: "Any of those texts asserts TB, before the app's filters.",
    alternatives: "Clinician considerations may name TB by design.",
  },
  "tb:outline": { earns: "Every abnormal observation has a zone outline on the film.", doesNot: "An abnormal observation with no outline." },
  "tb:zone_match": {
    earns: "An abnormal observation's outline is on the side (and zone) the clinical reading names, or overlaps a region radiologists marked.",
    doesNot: "No outline on the read side or over a marked region.",
    alternatives: "Zones are coarse: thirds of the chest from the lung outlines. No lesion-level accuracy is claimed.",
  },
  "tb:read_gate": {
    earns: "With every observation accepted, the app recommends a radiologist read before signing (critical case, or a pattern of concern).",
    doesNot: "No read is recommended.",
  },
};

export function criterionText(family: EvalFamily, id: string): CriterionText | null {
  return CRITERIA[`${family}:${id}`] ?? null;
}
