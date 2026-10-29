/**
 * Reading SLAs by priority (minutes from when findings start to be drafted).
 * Shared by the coordinator's SLA sweep and the console's SLA label
 * (utils/caseTimeline.ts), so both agree. Routine has no SLA.
 */
export const SLA_MINUTES = { critical: 5, urgent: 30 } as const;

export type SlaPriority = keyof typeof SLA_MINUTES;

export function slaBudgetMs(priority: string | null | undefined): number | null {
  return priority === "critical" || priority === "urgent" ? SLA_MINUTES[priority] * 60_000 : null;
}
