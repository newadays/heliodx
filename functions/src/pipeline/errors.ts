import type { StudyStatus } from "../study/stateMachine";

/** The status a pipeline step runs in; the full lifecycle is in `study/stateMachine.ts`. */
export type PipelineStatus = StudyStatus;

export type PipelineErrorCode =
  | "quality_rejected"
  | "model_refused"
  | "schema_invalid"
  | "timeout"
  | "model_unavailable"
  | "internal";

/** A pipeline failure with the code the app maps to copy, and the step it happened at. */
export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
    readonly at: PipelineStatus,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}
