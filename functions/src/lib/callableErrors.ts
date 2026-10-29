import { HttpsError } from "firebase-functions/v2/https";

import type { WrongStateError } from "../study/stateMachine";

/**
 * A study-state refusal as a callable error. `message` is shown to the
 * clinician; `details` lets the app see the stage and what is missing.
 */
export function wrongState(error: WrongStateError, message: string): HttpsError {
  return new HttpsError("failed-precondition", message, { error: "wrong_state", stage: error.stage, needs: error.needs });
}
