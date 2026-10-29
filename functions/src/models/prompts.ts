/**
 * Prompt text for the three model calls. Patient identifiers are never
 * included; clinical context is (it is what makes the draft useful) and is
 * never logged.
 */
import type { Modality } from "./fixtures";

export const SYSTEM_INSTRUCTION = [
  "You assist a licensed clinician by drafting observations from a single medical image or report.",
  "Your output is a draft for the clinician to review, accept, edit or reject. It is never shown to a patient unreviewed.",
  "Describe what is visible; do not state a diagnosis as fact. Use neutral, specific radiology/dermatology language.",
  "Never address the patient directly in clinician-facing text. Never include names, dates of birth or identifiers.",
  "If the image is not a medical image, say so through the schema rather than inventing findings.",
  "Return only JSON that matches the provided schema.",
].join(" ");

const MODALITY_WORDS: Record<Modality, string> = {
  xray: "a plain radiograph (X-ray), possibly photographed from film, a lightbox or a monitor",
  ct_mri: "a single CT or MRI slice photographed from a monitor or exported",
  ultrasound: "an ultrasound still image",
  lab: "a printed or on-screen laboratory report",
  skin: "a clinical photograph of skin",
};

/** B11 intake. `metrics` are measured in code; the model sees numbers, not extra pixels. */
export function intakePrompt(
  modalityHint: Modality,
  clinicalContext: string,
  metrics: { sharpness: number; mean: number; p1: number; p99: number; clipped: number; width: number; height: number },
  codeIssues: string[],
): string {
  return [
    `The clinician believes this is ${MODALITY_WORDS[modalityHint]}.`,
    "Decide whether the image can be read reliably as it is (decision 'accept') or should be retaken ('retake').",
    "Judge focus, exposure, glare, cropping and orientation; confirm the modality; name the study type and, for",
    "radiographs, the projection (PA, AP or lateral).",
    `Measured in code: sharpness ${metrics.sharpness} (blurred below 20), mean brightness ${metrics.mean}/255,`,
    `range ${metrics.p1}-${metrics.p99}, ${Math.round(metrics.clipped * 100)}% clipped, ${metrics.width}x${metrics.height} px.`,
    codeIssues.length ? `Automatic checks raised: ${codeIssues.join(" ")}` : "Automatic checks raised no issues.",
    "If the image is not medical, set looksMedical=false, decision 'retake' and explain in issues.",
    clinicalContext ? `Clinical context from the clinician: ${clinicalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * B11 triage, text only: the model sees measurements and thresholds, not the
 * image. Code has already set the minimum priority from the thresholds.
 */
export function triagePrompt(
  studyType: string,
  view: string,
  measurements: { id: string; value: number }[],
  flags: { measurementId: string; level: string; value: number; threshold: number }[],
  floor: string,
  maskIds: string[],
): string {
  return [
    `Study: ${studyType}, view ${view}. Set a reading priority: routine, urgent or critical.`,
    "Recall comes first: when in doubt, choose the higher priority. Never choose lower than the minimum below.",
    `Minimum priority set by the thresholds: ${floor}.`,
    `Measurements (id: value): ${measurements.length ? measurements.map((m) => `${m.id}: ${m.value}`).join("; ") : "none available"}.`,
    `Thresholds crossed: ${flags.length ? flags.map((f) => `${f.measurementId} ${f.value} vs ${f.threshold} (${f.level})`).join("; ") : "none"}.`,
    `Segmented regions (mask ids): ${maskIds.length ? maskIds.join(", ") : "none"}.`,
    "In evidence, list only ids from the measurements or mask ids above, exactly as written.",
    "Rationale: at most two sentences, observations only, no diagnosis or condition names.",
  ].join("\n");
}

/**
 * B12 prep: observations grounded in measured evidence. The catalogue lists
 * every id the model may cite; code rejects anything else.
 */
export function prepPrompt(
  studyType: string,
  clinicalContext: string,
  evidence: { id: string; about: string }[],
  regions: { id: string; about: string }[],
): string {
  return [
    `This is a ${studyType}. Draft up to six observations for the clinician to review, most relevant first.`,
    "Observations only: describe what is seen and where, with measured values where they apply. Never name a",
    "disease or diagnosis as present (no 'pneumonia', 'cardiomegaly', 'effusion'); a negative such as",
    "'No pneumothorax' is allowed. Include pertinent normals so a normal film still yields reviewable findings.",
    "Every observation must cite at least one id from the evidence list below, exactly as written. Use the",
    "measurements when they support the observation; cite a lung region id for something seen in that lung.",
    "Evidence list:",
    ...evidence.map((e) => `- ${e.id}: ${e.about}`),
    "Region ids for marking the image (or 'none'):",
    ...regions.map((r) => `- ${r.id}: ${r.about}`),
    "Then write a clinician summary: a findings paragraph that quotes each observation title verbatim, a numbered",
    "impression (1-5 items, observations only), and a recommendation. In `highlights`, give for each observation",
    "an exact substring of the findings paragraph that refers to it.",
    clinicalContext ? `Clinical context: ${clinicalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function findingsPrompt(studyType: string, modality: Modality, clinicalContext: string): string {
  return [
    `This is ${MODALITY_WORDS[modality]}, confirmed as: ${studyType}.`,
    "List up to six observations, most relevant first. For each give a short title, a one-to-two sentence description,",
    "a 0–100 confidence, a bounding box [ymin, xmin, ymax, xmax] on a 0–1000 scale (or null if not localisable),",
    "and whether an ellipse or a rectangle best marks it.",
    "Then write a clinician summary: a findings paragraph that quotes each finding title verbatim, a numbered impression",
    "(1–5 items), and a recommendation. In `highlights`, give for each finding an exact substring of the findings",
    "paragraph that refers to it.",
    "Include pertinent normal observations as findings too (for example 'Heart size within normal limits',",
    "'Lungs clear', 'No pneumothorax') so the clinician can confirm them; a readable image should yield at least",
    "two findings and at most six. Use high confidence for clear normals. Only return an empty list when the image",
    "cannot be read at all.",
    clinicalContext ? `Clinical context: ${clinicalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * B16 · Plain-language rewrite of the SIGNED report for the patient. Only the
 * signed text goes in (never the image or the draft). Step i rewrites
 * Recommendation sentence i, so every step maps to something the clinician
 * signed; code checks the result (lib/patientSummary.ts).
 */
export function patientSummaryFromSignedPrompt(
  signed: { studyType: string; findings: string; impression: string[]; recommendation: string },
  sentences: string[],
  feedback = "",
): string {
  const steps = sentences.length ? sentences.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none)";
  return [
    `Rewrite this signed ${signed.studyType || "imaging"} report for the patient, in plain language.`,
    "Audience: an adult with no medical training. Second person ('your'). Short sentences and everyday words",
    "(US grade 8 or lower). Calm and factual. Do not mention artificial intelligence.",
    "Translate every medical term into everyday words; never copy a technical phrase. For example: 'radiograph' or",
    "'PA' -> 'X-ray'; 'no acute abnormality' -> 'nothing that needs urgent attention'; 'correlate clinically' ->",
    "'your doctor will consider this together with how you feel and your history'; 'cardiothoracic ratio within",
    "normal limits' -> 'your heart is a normal size'. Leave out details a patient does not need (angles, ratios, views).",
    "The examples only show how to translate; use one only when the report says that thing.",
    "Use only what the report says. Do not add any number, time, medicine, dose, test or advice that the report",
    "does not contain. Do not name a condition unless the impression names it. Do not say a body part is normal",
    "or reassure about anything the report does not mention.",
    "`body`: two to four short sentences on what the clinician found, in everyday words.",
    `\`nextSteps\`: exactly ${sentences.length} item(s); item i says recommendation sentence i in plain words,`,
    "same meaning, nothing added or left out, at most two short sentences each.",
    `Findings: ${signed.findings || "(none)"}`,
    `Impression: ${signed.impression.join(" ") || "(none)"}`,
    `Recommendation sentences:\n${steps}`,
    feedback ? `Your previous answer broke these rules; fix them:\n${feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Clinician summary regenerated from the reviewed findings, without the
 * image: `findings` is what the clinician accepted, in their own words where
 * edited. `findingIndex` in highlights refers to this list's order.
 */
export function clinicianSummaryPrompt(
  studyType: string,
  modality: Modality,
  findings: { title: string; description: string }[],
  clinicalContext: string,
): string {
  const list = findings.length
    ? findings.map((f, i) => `${i}. ${f.title}: ${f.description}`).join("\n")
    : "(none accepted)";
  return [
    `Write the clinician summary for ${MODALITY_WORDS[modality]}, confirmed as: ${studyType}.`,
    "Base it only on the reviewed findings below (index: title: description). Do not add findings.",
    "Return a findings paragraph that quotes each finding title verbatim, a numbered impression (1–5 items),",
    "and a recommendation. In `highlights`, give for each finding index an exact substring of the findings",
    "paragraph that refers to it.",
    "If no findings were accepted, say that no reportable findings were confirmed.",
    `Reviewed findings:\n${list}`,
    clinicalContext ? `Clinical context: ${clinicalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
