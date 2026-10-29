/**
 * Agent console · the run manifest (design/agent-console SPEC §3.2, §4): the
 * agents the pipeline runs and every tool or check they record in the trace,
 * keyed by the exact names `traceEvent` writes. Both console surfaces render
 * this list and count calls from the trace, so a tool added here (and traced)
 * appears without a UI change. test/consoleManifest.test.ts fails when a
 * traced name is missing from it.
 *
 * Pure (no Node or Firebase imports): the web app imports it directly.
 * Model calls (`glimmer.chat`, `mock.chat`) are not tools; they carry the
 * tokens and the agent time.
 */
export interface ConsoleAgent {
  id: "coordinator" | "intake" | "triage" | "prep" | "summary";
  name: string;
  models: string[];
  /** One sentence. */
  role: string;
  order: number;
  /** Trace stages this agent's work is recorded under. */
  stages: string[];
}

export interface ConsoleTool {
  name: string;
  params: string[];
  /** One or two lines. */
  description: string;
  /** "tool" acts (segments, renders); "check" measures or verifies, and passes or fails. */
  kind: "tool" | "check";
  owner: ConsoleAgent["id"] | "clinician" | "system";
}

export const CONSOLE_AGENTS: ConsoleAgent[] = [
  {
    id: "coordinator",
    name: "Coordinator",
    models: ["Muse Wonder"],
    role: "Plans each study's reading lane, requeues a failed run once and escalates overdue or stuck cases to the clinician. Sees only de-identified queue state.",
    order: 0,
    stages: ["coordination"],
  },
  {
    id: "intake",
    name: "Intake",
    models: ["Glimmer", "SAM 3.1"],
    role: "Checks image quality, confirms the study type and view, and segments the lungs.",
    order: 1,
    stages: ["received", "quality_check"],
  },
  {
    id: "triage",
    name: "Triage",
    models: ["Glimmer"],
    role: "Takes the five measurements from the masks and sets routine or urgent priority from them and the indication.",
    order: 2,
    stages: ["classifying"],
  },
  {
    id: "prep",
    name: "Prep",
    models: ["Glimmer"],
    role: "Proposes observations with evidence and a region on the film, then drafts the clinician report from the decisions.",
    order: 3,
    stages: ["detecting", "summarizing"],
  },
  {
    id: "summary",
    name: "Summary",
    models: ["Glimmer"],
    role: "Writes the patient note from the signed report only and checks every sentence against it.",
    order: 4,
    stages: ["patient_summary"],
  },
];

export const CONSOLE_TOOLS: ConsoleTool[] = [
  { name: "receive_upload", params: ["format", "removed_tags", "redactions"], description: "Records what the browser removed or redacted before the upload. No pixels or identifiers.", kind: "check", owner: "system" },
  { name: "wait_for_gpu", params: [], description: "Waits for the private GPU to start after a quiet spell (about 5 minutes cold).", kind: "check", owner: "intake" },
  { name: "segment_region", params: ["image", "label"], description: "One SAM 3.1 mask per label (left lung, right lung). Every measurement reads from these.", kind: "tool", owner: "intake" },
  { name: "measure_quality", params: ["image"], description: "Resolution, sharpness, exposure and contrast. Stops the run only for low resolution, blur or a non-medical image.", kind: "check", owner: "intake" },
  { name: "quality_override", params: ["issues"], description: "The clinician chose to analyze an image the quality check stopped.", kind: "check", owner: "clinician" },
  { name: "measure_ratio", params: ["masks"], description: "Cardiothoracic ratio from the gap between the lung borders, against its threshold.", kind: "check", owner: "triage" },
  { name: "compare_area", params: ["masks"], description: "Left and right lung area asymmetry, against its threshold.", kind: "check", owner: "triage" },
  { name: "measure_angle", params: ["mask", "side"], description: "Costophrenic angle blunting, left and right.", kind: "check", owner: "triage" },
  { name: "compare_density", params: ["image", "masks"], description: "Left/right mean density ratio of the lungs, against its threshold.", kind: "check", owner: "triage" },
  { name: "render_overlay", params: ["kind", "masks"], description: "Mask and measurement overlays for the viewer.", kind: "tool", owner: "triage" },
  { name: "set_priority", params: ["measurements", "context"], description: "Routine, urgent or critical; never below the floor the measurements set.", kind: "check", owner: "triage" },
  { name: "propose_observations", params: ["measurements"], description: "Observations with evidence and a region; drops any that name a condition or cite no evidence.", kind: "check", owner: "prep" },
  { name: "freeze_report", params: ["decisions"], description: "Freezes the signed report and records its hash.", kind: "check", owner: "clinician" },
  { name: "check_patient_summary", params: ["note", "signed_report"], description: "Fails when a sentence adds an instruction, test, urgency or condition the signed report lacks, or reads above grade 8.", kind: "check", owner: "summary" },
  { name: "map_next_steps", params: ["note", "signed_report"], description: "Maps each next step to the signed Recommendation sentence it rewrites.", kind: "check", owner: "summary" },
  { name: "share_gate", params: ["channel"], description: "The server's share gate: written from the signed report, checks still passing, channel allowed.", kind: "check", owner: "clinician" },
  { name: "render_pdf", params: ["note"], description: "Renders the patient-note PDF: the note, the attribution and the disclaimer only.", kind: "tool", owner: "clinician" },
  { name: "reset_sample", params: [], description: "Returns a sample study to its fresh draft.", kind: "check", owner: "clinician" },
  { name: "plan_study", params: ["studyId", "lane", "radiologistRead"], description: "Sets the reading lane (never below the study's priority) and recommends a radiologist read.", kind: "check", owner: "coordinator" },
  { name: "requeue_study", params: ["studyId"], description: "Puts a study whose model call failed back in the queue, once.", kind: "check", owner: "coordinator" },
  { name: "escalate_to_human", params: ["studyId", "reason"], description: "Flags the case for the clinician: overdue SLA, stalled run, retake needed or a failure that can't be retried.", kind: "check", owner: "coordinator" },
];

/** "Muse Wonder · Glimmer · SAM 3.1": every model the manifest's agents use, in order. */
export function manifestModels(agents: ConsoleAgent[] = CONSOLE_AGENTS): string[] {
  return [...new Set(agents.flatMap((a) => a.models))];
}

/** "Coordination on Muse Wonder; model steps on Glimmer; segmentation on SAM 3.1." from the agents' models. */
export function manifestModelsNote(agents: ConsoleAgent[] = CONSOLE_AGENTS): string {
  const coord = agents.find((a) => a.id === "coordinator")?.models[0];
  const workers = [...new Set(agents.filter((a) => a.id !== "coordinator").flatMap((a) => a.models))];
  const [main, ...seg] = workers;
  return [coord ? `Coordination on ${coord}` : null, main ? `model steps on ${main}` : null, seg.length ? `segmentation on ${seg.join(", ")}` : null]
    .filter(Boolean)
    .join("; ")
    .replace(/^./, (c) => c.toUpperCase()) + ".";
}

export const isModelCall = (name: string): boolean => name.endsWith(".chat");
