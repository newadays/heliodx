/**
 * B13 · The coordinator's heartbeat: every 2 minutes, plan the queue with
 * Muse Wonder (or the rules fallback) and run the SLA sweep. The only
 * function bound to META_API_KEY. Workers still chain on Firestore triggers,
 * so no study waits for this tick to be analysed.
 */
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { META_API_KEY, REGION } from "../config";
import { coordinate } from "../coordinator/coordinate";

export const coordinatorTick = onSchedule(
  { schedule: "every 2 minutes", region: REGION, timeZone: "Etc/UTC", timeoutSeconds: 120, memory: "512MiB", retryCount: 0, secrets: [META_API_KEY] },
  async () => {
    // No key configured: the rules fallback still runs the SLA sweep.
    const hasKey = (() => {
      try {
        return !!META_API_KEY.value();
      } catch {
        return false;
      }
    })();
    await coordinate(getFirestore(), Date.now(), hasKey ? {} : { planner: null });
  },
);
